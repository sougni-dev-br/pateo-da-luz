// Liga pedidos de compra em rascunho às notas que já os atenderam, a partir de uma lista CONFERIDA pelo Eli.
//
// Uso (sempre TZ=UTC):
//   TZ=UTC npx tsx scripts/vincular-rascunhos-a-notas.ts <arquivo.csv>            # simulação: só mostra
//   TZ=UTC npx tsx scripts/vincular-rascunhos-a-notas.ts <arquivo.csv> --aplicar  # grava (com autorização)
//
// O CSV (separador ;) tem as colunas `codigo` (PC-2026-0001) e `compras_confirmadas` (um ou mais CMP-2026-000001,
// separados por vírgula; pode ser a coluna `compras_candidatas` da lista gerada, depois de apagar o que estiver errado).
// Linhas sem compra confirmada são ignoradas: o pedido continua como está.
//
// Como reparte: para cada nota (da mais antiga para a mais nova), a quantidade de cada produto vai primeiro para o
// pedido confirmado mais antigo que ainda precisa dele. Item cuja unidade na nota difere da do pedido não é ligado
// (sai no relatório para ligar à mão), porque a quantidade não seria comparável.
import fs from "node:fs";
import { prisma } from "../src/config/database.js";
import { gravarVinculosDaCompra } from "../src/modules/purchase-orders/vinculo-nota.service.js";
import { mesmaUnidade, montarMapaDeUnidades, sugerirDivisao } from "../src/modules/purchase-orders/vinculo-nota.js";

const NOTA = /CMP-\d{4}-\d+/g;
const arredondar = (valor: number) => Math.round(valor * 1000) / 1000;

function lerCsv(arquivo: string): Array<{ codigo: string; compras: string[] }> {
  const linhas = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas[0].split(";").map((c) => c.trim());
  const iCodigo = cabecalho.indexOf("codigo");
  const iCompras = cabecalho.findIndex((c) => c === "compras_confirmadas" || c === "compras_candidatas");
  if (iCodigo < 0 || iCompras < 0) throw new Error("O CSV precisa das colunas codigo e compras_confirmadas.");
  return linhas.slice(1).map((l) => {
    const campos = l.split(";");
    return { codigo: campos[iCodigo].trim(), compras: campos[iCompras]?.match(NOTA) ?? [] };
  }).filter((l) => l.codigo && l.compras.length > 0);
}

async function main() {
  const [arquivo, ...flags] = process.argv.slice(2);
  if (!arquivo) throw new Error("Informe o arquivo CSV.");
  const aplicar = flags.includes("--aplicar");
  const linhas = lerCsv(arquivo);

  const pedidos = await prisma.purchaseOrder.findMany({
    where: { code: { in: linhas.map((l) => l.codigo) } },
    include: { items: { include: { notaLinks: { include: { purchase: { select: { workflowStatus: true } } } } } } }
  });
  const porCodigo = new Map(pedidos.map((p) => [p.code, p]));
  const numerosDasNotas = [...new Set(linhas.flatMap((l) => l.compras))];
  const notas = await prisma.purchase.findMany({
    where: { purchaseNumber: { in: numerosDasNotas } },
    include: { items: true, pedidoLinks: true },
    orderBy: { purchaseDate: "asc" }
  });

  // Quanto cada item de pedido ainda precisa, descontando vínculos que já existem (de notas não canceladas).
  const restante = new Map<string, number>();
  for (const p of pedidos) {
    for (const item of p.items) {
      const ja = item.notaLinks.filter((l) => l.purchase.workflowStatus !== "cancelled").reduce((s, l) => s + Number(l.quantity), 0);
      restante.set(item.id, arredondar(Math.max(Number(item.approvedQuantity ?? item.requestedQuantity) - ja, 0)));
    }
  }
  const pedidosDaNota = new Map<string, Set<string>>();
  for (const l of linhas) for (const n of l.compras) pedidosDaNota.set(n, (pedidosDaNota.get(n) ?? new Set()).add(l.codigo));

  const mapaDeUnidades = montarMapaDeUnidades(await prisma.unitMeasure.findMany({ select: { code: true, name: true } }));
  const relatorio: string[] = [];
  const porNota: Array<{ id: string; numero: string; links: Array<{ purchaseOrderItemId: string; quantity: number }> }> = [];
  for (const nota of notas) {
    const codigos = [...(pedidosDaNota.get(nota.purchaseNumber ?? "") ?? [])];
    const itensDosPedidos = codigos.flatMap((c) => porCodigo.get(c)?.items.map((i) => ({ ...i, orderCreatedAt: porCodigo.get(c)!.createdAt.toISOString(), orderCode: c })) ?? []);
    // Mantém o que a nota já tinha ligado a outros pedidos (a gravação troca todos os vínculos da nota).
    const links = nota.pedidoLinks.map((l) => ({ purchaseOrderItemId: l.purchaseOrderItemId, quantity: Number(l.quantity) }));
    const jaLigados = new Set(links.map((l) => l.purchaseOrderItemId));
    const produtos = [...new Set(nota.items.map((i) => i.productId))];
    for (const productId of produtos) {
      const doProduto = nota.items.filter((i) => i.productId === productId);
      const abertos = itensDosPedidos.filter((i) => i.productId === productId && !jaLigados.has(i.id));
      const unidadesIguais = abertos.filter((a) => doProduto.every((d) => mesmaUnidade(d.unit, a.unitSnapshot, mapaDeUnidades)));
      for (const a of abertos) if (!unidadesIguais.includes(a)) relatorio.push(`  ! ${a.orderCode} ${a.productNameSnapshot}: unidade diferente da nota ${nota.purchaseNumber}; ligar à mão`);
      const total = arredondar(doProduto.reduce((s, d) => s + Number(d.quantity), 0));
      const divisao = sugerirDivisao(total, unidadesIguais.map((a) => ({ purchaseOrderItemId: a.id, restante: restante.get(a.id) ?? 0, criadoEm: a.orderCreatedAt })));
      for (const d of divisao) {
        links.push(d);
        restante.set(d.purchaseOrderItemId, arredondar((restante.get(d.purchaseOrderItemId) ?? 0) - d.quantity));
      }
    }
    porNota.push({ id: nota.id, numero: nota.purchaseNumber ?? nota.id, links });
  }

  for (const n of numerosDasNotas) if (!notas.some((x) => x.purchaseNumber === n)) relatorio.push(`  ! nota ${n} não encontrada`);
  for (const l of linhas) if (!porCodigo.has(l.codigo)) relatorio.push(`  ! pedido ${l.codigo} não encontrado`);

  console.log(`${aplicar ? "APLICANDO" : "SIMULAÇÃO"}: ${linhas.length} pedidos, ${notas.length} notas`);
  for (const p of pedidos) {
    const faltam = p.items.filter((i) => (restante.get(i.id) ?? 0) > 0);
    console.log(`  ${p.code}: ${p.items.length - faltam.length}/${p.items.length} itens cobertos → ${faltam.length === 0 ? "RECEBIDO" : faltam.length < p.items.length ? "RECEBIDO_PARCIAL" : "sem mudança"}`);
  }
  relatorio.forEach((r) => console.log(r));

  if (!aplicar) {
    console.log("Nada foi gravado. Rode com --aplicar para gravar.");
    return;
  }
  for (const n of porNota) {
    const resultado = await gravarVinculosDaCompra(n.id, n.links, "script-vincular-rascunhos");
    console.log(`${n.numero}: ${resultado.ok ? `${resultado.pedidosAtualizados.length} pedido(s) atualizado(s)` : `RECUSADO (${resultado.message})`}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
