import { prisma } from "../../config/database.js";
import { PADRAO_NOME_BUFFET } from "../integrations/agile/agile-categorias.js";
import { SITUACAO_RECEBIDA } from "../integrations/agile/agile-situacao.js";
import { analisarBuffet, type Analise, type PdvDoDia, type PratoAnalisado } from "./buffet-analysis.js";
import { custosDosPratos } from "./buffet-costs.service.js";

export const KINDS = ["BUFFET", "COFFEE_BREAK", "EVENTO"] as const;
export type Kind = (typeof KINDS)[number];

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const MAX_PESAGENS = 50_000;

export type PratoComNome = PratoAnalisado & { name: string; category: string | null };
export type AnaliseCompleta = Omit<Analise, "items"> & {
  from: string;
  to: string;
  kind: Kind;
  costVisible: boolean;
  items: PratoComNome[];
};

/**
 * Pessoas e receita do buffet por dia, do PDV (as comandas que têm produto "BUFFET…"). Só o buffet do dia tem PDV:
 * coffee break e evento são vendidos de outro jeito e ficam sem pessoas nem receita.
 */
async function pdvDoBuffet(from: string, to: string): Promise<PdvDoDia[]> {
  const de = new Date(`${from}T00:00:00.000Z`);
  const ate = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + UM_DIA_MS);
  const linhas = await prisma.$queryRaw<Array<{ dia: string; pessoas: number | bigint | null; receita: unknown }>>`
    WITH b AS (
      SELECT i."saleId" AS venda, SUM(i."totalAmount") AS valor
      FROM "AgileSaleItem" i
      WHERE i."saleStatus" = ${SITUACAO_RECEBIDA} AND i."movementDate" >= ${de} AND i."movementDate" < ${ate}
        AND i."productName" ~* ${PADRAO_NOME_BUFFET}
      GROUP BY i."saleId")
    -- Receita só das comandas com pessoas informadas: comanda com 0 pessoas inflaria a receita por pessoa (mesma regra da margem do salão).
    SELECT to_char(s."movementDate", 'YYYY-MM-DD') AS dia, COALESCE(SUM(s.people), 0)::int AS pessoas,
           COALESCE(SUM(b.valor) FILTER (WHERE s.people > 0), 0) AS receita
    FROM b JOIN "AgileSale" s ON s."saleId" = b.venda AND s."saleStatus" = ${SITUACAO_RECEBIDA}
    GROUP BY 1`;
  return linhas.map((l) => ({ date: String(l.dia), people: Number(l.pessoas ?? 0), revenue: Number(l.receita ?? 0) }));
}

/** Sem a permissão de custos nenhum valor em R$ sai (nem custo, nem receita, nem margem): só quilos, pessoas e sobra. */
function semDinheiro(a: AnaliseCompleta): AnaliseCompleta {
  return {
    ...a,
    costVisible: false,
    days: a.days.map((d) => ({ ...d, revenue: null, producedCost: null, leftoverCost: null, consumedCost: null, costPerPerson: null, revenuePerPerson: null, marginPerPerson: null })),
    items: a.items.map((i) => ({ ...i, costPerKg: null, leftoverCost: null, consumedCost: null, costPerPerson: null })),
    summary: { ...a.summary, producedCost: null, leftoverCost: null, consumedCost: null, revenue: null, costPerPerson: null, revenuePerPerson: null, marginPerPerson: null },
  };
}

export async function analiseDoBuffet(from: string, to: string, kind: Kind, verCusto: boolean): Promise<AnaliseCompleta> {
  const rows = await prisma.buffetWeighing.findMany({
    where: { kind, servedOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { servedOn: true, itemId: true, phase: true, netG: true },
    // Se passar do teto, o corte pega os dias mais antigos (os recentes importam mais).
    orderBy: { servedOn: "desc" },
    take: MAX_PESAGENS,
  });
  const pesagens = rows.map((r) => ({ date: r.servedOn.toISOString().slice(0, 10), itemId: r.itemId, phase: (r.phase === "SOBRA" ? "SOBRA" : "PRODUCAO") as "SOBRA" | "PRODUCAO", netG: r.netG }));
  // Pratos mais produzidos primeiro: se algum dia passar do limite de fichas calculadas, os que ficam sem custo são os menores.
  const produzido = new Map<string, number>();
  for (const p of pesagens) if (p.phase === "PRODUCAO") produzido.set(p.itemId, (produzido.get(p.itemId) ?? 0) + p.netG);
  const itemIds = [...new Set(pesagens.map((p) => p.itemId))].sort((a, b) => (produzido.get(b) ?? 0) - (produzido.get(a) ?? 0));

  const [pdv, custos, itens] = await Promise.all([
    kind === "BUFFET" && pesagens.length ? pdvDoBuffet(from, to) : Promise.resolve<PdvDoDia[]>([]),
    // Sem a permissão de custos nada de R$ sai: não vale gastar as consultas de ficha à toa.
    verCusto ? custosDosPratos(itemIds) : Promise.resolve(new Map<string, { costPerKg: number | null }>()),
    itemIds.length ? prisma.buffetPlateItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, namePt: true, category: true } }) : Promise.resolve([]),
  ]);
  const porKg = new Map([...custos].map(([id, c]) => [id, c.costPerKg] as const));
  const analise = analisarBuffet(pesagens, pdv, porKg);
  const dados = new Map(itens.map((i) => [i.id, i]));

  const completa: AnaliseCompleta = {
    from, to, kind, costVisible: true, days: analise.days, summary: analise.summary, lastDayItemIds: analise.lastDayItemIds,
    items: analise.items.map((i) => ({ ...i, name: dados.get(i.itemId)?.namePt ?? "Prato removido", category: dados.get(i.itemId)?.category ?? null })),
  };
  return verCusto ? completa : semDinheiro(completa);
}
