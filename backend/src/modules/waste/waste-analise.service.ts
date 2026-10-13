import { prisma } from "../../config/database.js";
import { analisarDesperdicio, periodoAnterior, type Analise, type EntradaAnalisada, type FaturamentoDoDia } from "./waste-analise.js";
import { todayInSaoPaulo } from "../buffet-plates/buffet-prints.routes.js";
import { INCLUDE_DA_LISTA, linhaDoResumo, nomesDosSetores } from "./waste.service.js";

const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function entradasDoPeriodo(from: string, to: string): Promise<EntradaAnalisada[]> {
  const entradas = await prisma.wasteEntry.findMany({
    where: { occurredOn: { gte: dia(from), lte: dia(to) }, cancelledAt: null },
    include: INCLUDE_DA_LISTA,
  });
  const setores = await nomesDosSetores(entradas.map((e) => e.sectorId));
  return entradas.map((e) => {
    const linha = linhaDoResumo(e, setores, true);
    return {
      dia: e.occurredOn.toISOString().slice(0, 10),
      itemKey: linha.itemId,
      itemName: linha.itemName,
      sector: linha.sector,
      reason: e.reason,
      totalCost: linha.totalCost,
      quantity: Number(e.quantity),
      unit: e.unit,
      registeredById: e.registeredById,
      createdAt: e.createdAt,
      hasPhoto: Boolean(e.photo),
    };
  });
}

/** Faturamento líquido e pessoas atendidas por dia: a mesma fonte do CMV Real (RevenueEntry, sem cancelados). */
async function faturamentoPorDia(from: string, to: string): Promise<FaturamentoDoDia[]> {
  const linhas = await prisma.$queryRaw<Array<{ dia: string; liquido: unknown; pessoas: unknown }>>`
    SELECT to_char("date", 'YYYY-MM-DD') AS dia,
           COALESCE(SUM("netAmount"), 0) AS liquido,
           COALESCE(SUM("peopleServed"), 0) AS pessoas
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= CAST(${dia(from)} AS timestamp)
      AND "date" < CAST(${dia(to)} AS timestamp) + INTERVAL '1 day'
    GROUP BY 1
  `;
  return linhas.map((l) => ({ dia: l.dia, liquido: Number(l.liquido), pessoas: Number(l.pessoas) }));
}

/**
 * Quanto de cada insumo foi comprado no período, na unidade do estoque. Mesma regra do custo: só vale compra
 * confirmada cuja quantidade está na unidade do estoque do item (senão somaria caixa com quilo).
 */
async function compradosNoPeriodo(unidadePorItem: Map<string, string>, from: string, to: string): Promise<Map<string, number>> {
  // A unidade é a gravada no lançamento (a mesma da conferência e do custo), que pode vir da unidade de medida do produto.
  const itens = [...unidadePorItem.entries()].filter(([id, unidade]) => !id.startsWith("dish:") && unidade);
  if (!itens.length) return new Map();
  const produtos = itens.map(([id]) => id);
  const unidades = itens.map(([, unidade]) => unidade);
  const linhas = await prisma.$queryRaw<Array<{ id: string; quantidade: unknown }>>`
    SELECT pi."productId" AS id, COALESCE(SUM(COALESCE(pi."convertedQuantity", pi."quantity")), 0) AS quantidade
    FROM "PurchaseItem" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    JOIN unnest(${produtos}::text[], ${unidades}::text[]) AS alvo(id, unidade) ON alvo.id = pi."productId"
    WHERE true
      AND p."status" = 'ACTIVE' AND p."workflowStatus" = 'confirmed'
      AND pi."conversionMissing" = false
      AND (
        (pi."convertedUnit" IS NOT NULL AND UPPER(pi."convertedUnit") = UPPER(alvo.unidade))
        OR (pi."convertedUnit" IS NULL AND (pi."unit" IS NULL OR UPPER(pi."unit") = UPPER(alvo.unidade)))
      )
      AND COALESCE(p."receivedAt", p."purchaseDate")::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1
  `;
  return new Map(linhas.map((l) => [l.id, Number(l.quantidade)]));
}

async function nomesDasPessoas(ids: string[]) {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map<string, string>();
  const usuarios = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(usuarios.map((u) => [u.id, u.name]));
}

/** A análise do período, com o período anterior de igual tamanho como régua. Custo e faturamento só para quem os vê. */
export async function analisePeriodo(from: string, to: string, comCusto: boolean): Promise<Analise> {
  const ant = periodoAnterior(from, to);
  const [atual, anterior, faturamento] = await Promise.all([
    entradasDoPeriodo(from, to),
    entradasDoPeriodo(ant.from, ant.to),
    comCusto ? faturamentoPorDia(ant.from, to) : Promise.resolve([]),
  ]);
  const [pessoas, comprados] = await Promise.all([
    nomesDasPessoas(atual.map((e) => e.registeredById)),
    comCusto ? compradosNoPeriodo(new Map(atual.map((e) => [e.itemKey, e.unit ?? ""])), from, to) : Promise.resolve(new Map<string, number>()),
  ]);
  return analisarDesperdicio({ from, to, atual, anterior, faturamento, comCusto, nomesDasPessoas: pessoas, comprados, hoje: todayInSaoPaulo() });
}
