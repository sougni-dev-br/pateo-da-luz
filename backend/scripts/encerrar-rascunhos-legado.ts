// Encerra como "Encerrado (legado)" os pedidos de compra que ficaram em rascunho antes do vínculo com a nota.
// Não é cancelamento nem recebimento: sai da lista de abertos, fica no histórico e não recebe nota.
//
// Uso (sempre TZ=UTC):
//   TZ=UTC npx tsx scripts/encerrar-rascunhos-legado.ts --ate=2026-10-15            # simulação: só mostra
//   TZ=UTC npx tsx scripts/encerrar-rascunhos-legado.ts --ate=2026-10-15 --aplicar  # grava (com autorização)
//
// `--ate` é obrigatório: só entram rascunhos criados até essa data (inclusive), para nunca pegar um pedido novo.
// Rascunho que já tem nota ligada fica de fora (o vínculo já cuida do status dele).
import { prisma } from "../src/config/database.js";
import { auditLog } from "../src/modules/security/security-utils.js";
import { STATUS_ENCERRADO_LEGADO } from "../src/modules/purchase-orders/vinculo-nota.js";

function lerData(argumentos: string[]): Date {
  const valor = argumentos.find((a) => a.startsWith("--ate="))?.slice("--ate=".length) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error("Informe --ate=AAAA-MM-DD (último dia de criação a encerrar).");
  const fim = new Date(`${valor}T23:59:59.999Z`);
  if (Number.isNaN(fim.getTime())) throw new Error("Data de --ate inválida.");
  return fim;
}

async function main() {
  const argumentos = process.argv.slice(2);
  const aplicar = argumentos.includes("--aplicar");
  const ate = lerData(argumentos);

  const candidatos = await prisma.purchaseOrder.findMany({
    where: {
      status: "RASCUNHO",
      createdAt: { lte: ate },
      items: { none: { notaLinks: { some: {} } } }
    },
    select: { id: true, code: true, supplierNameSnapshot: true, createdAt: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "asc" }
  });

  console.log(`${aplicar ? "APLICANDO" : "SIMULAÇÃO"}: ${candidatos.length} rascunho(s) criados até ${ate.toISOString().slice(0, 10)} virariam "Encerrado (legado)".`);
  const porFornecedor = new Map<string, number>();
  for (const c of candidatos) porFornecedor.set(c.supplierNameSnapshot, (porFornecedor.get(c.supplierNameSnapshot) ?? 0) + 1);
  for (const [nome, quantidade] of [...porFornecedor].sort((a, b) => b[1] - a[1])) console.log(`  ${quantidade} · ${nome}`);

  if (!aplicar) {
    console.log("Nada foi gravado. Rode com --aplicar para gravar.");
    return;
  }
  const ids = candidatos.map((c) => c.id);
  // Só muda quem ainda está em rascunho: se alguém avançou um deles enquanto o script rodava, ele fica como está.
  const { count } = await prisma.purchaseOrder.updateMany({
    where: { id: { in: ids }, status: "RASCUNHO" },
    data: { status: STATUS_ENCERRADO_LEGADO }
  });
  for (const c of candidatos) {
    await auditLog({
      userId: null,
      action: "PURCHASE_ORDER_CLOSE_LEGACY",
      entity: "PurchaseOrder",
      entityId: c.id,
      previousValue: { status: "RASCUNHO" },
      newValue: { status: STATUS_ENCERRADO_LEGADO, motivo: "rascunho anterior ao vinculo com a nota", itens: c._count.items }
    });
  }
  console.log(`${count} pedido(s) encerrado(s) como legado.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
