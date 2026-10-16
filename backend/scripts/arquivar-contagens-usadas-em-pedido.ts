// Arquiva as contagens de estoque concluídas que só serviram para preparar um pedido de compra e nunca geraram
// inventário. Arquivar não é cancelar: a contagem sai das listas do dia a dia, mas continua no histórico e
// em tudo que a usa (ciclos de estoque, medianas), e pode ser desarquivada na tela de Contagens.
//
// Uso (sempre TZ=UTC):
//   TZ=UTC npx tsx scripts/arquivar-contagens-usadas-em-pedido.ts --ate=2026-10-15            # simulação: só mostra
//   TZ=UTC npx tsx scripts/arquivar-contagens-usadas-em-pedido.ts --ate=2026-10-15 --aplicar  # grava (com autorização)
//
// `--ate` é obrigatório: só entram contagens com data de referência até esse dia (inclusive).
// Entram contagens do sistema, concluídas, sem inventário gerado, sem snapshot e que NÃO são base de nenhum
// período de CMV nem estão ligadas à agenda do estoquista; recontagem fica de fora.
import { prisma } from "../src/config/database.js";
import { auditLog } from "../src/modules/security/security-utils.js";
import { STATUS_CONTAGEM_ARQUIVADA } from "../src/modules/inventory/contagem-arquivada.js";

const MOTIVO = "Contagem usada para preparar pedido de compra; sem uso hoje (arquivada em lote).";

function lerData(argumentos: string[]): Date {
  const valor = argumentos.find((a) => a.startsWith("--ate="))?.slice("--ate=".length) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error("Informe --ate=AAAA-MM-DD (última data de referência a encerrar).");
  const fim = new Date(`${valor}T23:59:59.999Z`);
  if (Number.isNaN(fim.getTime())) throw new Error("Data de --ate inválida.");
  return fim;
}

async function main() {
  const argumentos = process.argv.slice(2);
  const aplicar = argumentos.includes("--aplicar");
  const ate = lerData(argumentos);

  const candidatas = await prisma.$queryRaw<Array<{ id: string; code: string; type: string; referenceDate: Date; sectorName: string | null; itens: number }>>`
    SELECT s."id", s."code", s."type"::text AS "type", s."referenceDate", s."sectorName",
           (SELECT COUNT(*)::int FROM "StockCountSessionItem" i WHERE i."stockCountSessionId" = s."id") AS "itens"
    FROM "StockCountSession" s
    WHERE s."status" = 'CONCLUIDA'
      AND s."generatedInventoryId" IS NULL
      AND s."linkedSnapshotId" IS NULL
      AND s."source" <> 'IMPORTACAO_PLANILHA'
      AND s."type" <> 'RECONTAGEM'
      AND s."inventoryAgendaItemId" IS NULL
      AND s."referenceDate" <= ${ate}
      AND NOT EXISTS (
        SELECT 1 FROM "CmvPeriod" p
        WHERE p."estoqueInicialSessionId" = s."id" OR p."estoqueFinalSessionId" = s."id"
      )
    ORDER BY s."referenceDate", s."code"
  `;

  console.log(`${aplicar ? "APLICANDO" : "SIMULAÇÃO"}: ${candidatas.length} contagem(ns) até ${ate.toISOString().slice(0, 10)} seriam arquivadas.`);
  for (const c of candidatas) {
    console.log(`  ${c.code} · ${c.type} · ${c.referenceDate.toISOString().slice(0, 10)} · ${c.sectorName ?? "-"} · ${c.itens} itens`);
  }
  if (!aplicar) {
    console.log("Nada foi gravado. Rode com --aplicar para gravar.");
    return;
  }

  let arquivadas = 0;
  for (const c of candidatas) {
    // Só arquiva quem continua concluída e sem inventário: se algo mudou desde a listagem, fica como está.
    const afetadas = await prisma.$executeRaw`
      UPDATE "StockCountSession"
      SET "status" = ${STATUS_CONTAGEM_ARQUIVADA}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${c.id} AND "status" = 'CONCLUIDA' AND "generatedInventoryId" IS NULL
    `;
    if (afetadas === 0) continue;
    arquivadas += 1;
    await auditLog({
      userId: null,
      action: "ARCHIVE_STOCK_COUNT_SESSION",
      entity: "StockCountSession",
      entityId: c.id,
      previousValue: { status: "CONCLUIDA", generatedInventoryId: null },
      newValue: { status: STATUS_CONTAGEM_ARQUIVADA, reason: MOTIVO, lote: true }
    });
  }
  console.log(`${arquivadas} contagem(ns) arquivada(s).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
