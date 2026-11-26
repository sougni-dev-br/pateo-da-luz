import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { cmvPurchasePredicate } from "../cmv-real/cmv-purchase-base.service.js";
import { hojeEmSaoPaulo } from "../payroll/extras-comum.js";
import { arredondar, metaVigente } from "./cmv-metas.logic.js";
import { intervaloDoMes, paraVigencia } from "./cmv-metas.service.js";

// Visões extras da tela de Metas, no mesmo espírito do Dashboard: o ritmo do mês dia a dia contra o teto
// da meta, e onde foram as compras (categoria, fornecedor, produto) contra o mês anterior.
// Mesma base das metas: compras de CMV (visão contábil) pela data da compra, faturamento líquido pela data.

const VISAO = "accounting" as const;
const LIMITE_RANKING = 12;

const num = (v: Prisma.Decimal | bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const isoDia = (d: Date) => d.toISOString().slice(0, 10);

export type DiaRitmo = { dia: number; faturamento: number; compras: number };
export type LinhaRanking = { id: string | null; nome: string; compras: number; comprasAnterior: number };
export type Ranking = {
  linhas: LinhaRanking[];
  /** O que ficou fora das primeiras linhas, somado. */
  outros: { quantidade: number; compras: number; comprasAnterior: number };
  total: number;
  totalAnterior: number;
};
export type DimensaoRanking = "categoria" | "subcategoria" | "fornecedor" | "produto";

export type VisoesMetaCmv = {
  mes: string;
  mesAnterior: string;
  ateODia: string;
  mesCorrente: boolean;
  diasNoMes: number;
  diasNoMesAnterior: number;
  /** Até que dia do mês anterior a comparação da distribuição vai (mesmo trecho, no mês em andamento). */
  comparacaoAteODia: number;
  meta: { alvoPercentual: number; alertaPercentual: number } | null;
  faturamento: number;
  faturamentoAnterior: number;
  ritmo: { atual: DiaRitmo[]; anterior: DiaRitmo[] };
  distribuicao: Record<DimensaoRanking, Ranking>;
};

/** Dias 1..n do mês, com zero onde não houve movimento. */
export function preencherDias(diasNoMes: number, faturamento: Map<number, number>, compras: Map<number, number>): DiaRitmo[] {
  return Array.from({ length: diasNoMes }, (_, i) => ({
    dia: i + 1,
    faturamento: arredondar(faturamento.get(i + 1) ?? 0),
    compras: arredondar(compras.get(i + 1) ?? 0),
  }));
}

/** Ordena pelo mês atual, guarda as primeiras linhas e soma o resto em "outros". */
export function montarRanking(linhas: LinhaRanking[], limite = LIMITE_RANKING): Ranking {
  const ordenadas = [...linhas]
    .filter((l) => l.compras > 0 || l.comprasAnterior > 0)
    .sort((a, b) => b.compras - a.compras || b.comprasAnterior - a.comprasAnterior || a.nome.localeCompare(b.nome, "pt-BR"));
  const topo = ordenadas.slice(0, limite);
  const resto = ordenadas.slice(limite);
  const soma = (ls: LinhaRanking[], campo: "compras" | "comprasAnterior") => arredondar(ls.reduce((s, l) => s + l[campo], 0));
  return {
    linhas: topo.map((l) => ({ ...l, compras: arredondar(l.compras), comprasAnterior: arredondar(l.comprasAnterior) })),
    outros: { quantidade: resto.length, compras: soma(resto, "compras"), comprasAnterior: soma(resto, "comprasAnterior") },
    total: soma(ordenadas, "compras"),
    totalAnterior: soma(ordenadas, "comprasAnterior"),
  };
}

const AGRUPAMENTO: Record<DimensaoRanking, { id: Prisma.Sql; nome: Prisma.Sql; junta: Prisma.Sql }> = {
  categoria: {
    id: Prisma.sql`c."id"`,
    nome: Prisma.sql`COALESCE(c."name", 'Sem categoria')`,
    junta: Prisma.sql`LEFT JOIN "Category" c ON c."id" = pr."categoryId"`,
  },
  subcategoria: {
    id: Prisma.sql`sc."id"`,
    nome: Prisma.sql`COALESCE(sc."name", 'Sem subcategoria')`,
    junta: Prisma.sql`LEFT JOIN "Subcategory" sc ON sc."id" = pr."subcategoryId"`,
  },
  fornecedor: {
    id: Prisma.sql`s."id"`,
    nome: Prisma.sql`s."name"`,
    junta: Prisma.sql`JOIN "Supplier" s ON s."id" = p."supplierId"`,
  },
  produto: {
    id: Prisma.sql`pr."id"`,
    nome: Prisma.sql`pr."name"`,
    junta: Prisma.sql``,
  },
};

type Trecho = { inicio: Date; fim: Date };

async function comprasAgrupadas(dimensao: DimensaoRanking, atual: Trecho, anterior: Trecho): Promise<Ranking> {
  const g = AGRUPAMENTO[dimensao];
  const rows = await prisma.$queryRaw<Array<{ id: string | null; nome: string; atual: Prisma.Decimal | null; anterior: Prisma.Decimal | null }>>`
    SELECT ${g.id} AS "id", ${g.nome} AS "nome",
      COALESCE(SUM(pi."totalPrice") FILTER (WHERE p."purchaseDate" >= ${atual.inicio} AND p."purchaseDate" <= ${atual.fim}), 0) AS "atual",
      COALESCE(SUM(pi."totalPrice") FILTER (WHERE p."purchaseDate" >= ${anterior.inicio} AND p."purchaseDate" <= ${anterior.fim}), 0) AS "anterior"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    ${g.junta}
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(VISAO)}
      AND ((p."purchaseDate" >= ${atual.inicio} AND p."purchaseDate" <= ${atual.fim})
        OR (p."purchaseDate" >= ${anterior.inicio} AND p."purchaseDate" <= ${anterior.fim}))
    GROUP BY 1, 2
  `;
  return montarRanking(rows.map((r) => ({ id: r.id, nome: r.nome, compras: num(r.atual), comprasAnterior: num(r.anterior) })));
}

async function porDia(inicio: Date, fim: Date) {
  const [faturamento, compras] = await Promise.all([
    prisma.$queryRaw<Array<{ dia: Date; total: Prisma.Decimal | null }>>`
      SELECT CAST(date_trunc('day', "date") AS date) AS "dia", COALESCE(SUM("netAmount"), 0) AS "total"
      FROM "RevenueEntry"
      WHERE "status" <> 'CANCELLED' AND "date" >= CAST(${inicio} AS timestamp) AND "date" <= CAST(${fim} AS timestamp)
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ dia: Date; total: Prisma.Decimal | null }>>`
      SELECT CAST(date_trunc('day', p."purchaseDate") AS date) AS "dia", COALESCE(SUM(pi."totalPrice"), 0) AS "total"
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" = 'ACTIVE'
        AND ${cmvPurchasePredicate(VISAO)}
        AND p."purchaseDate" >= ${inicio} AND p."purchaseDate" <= ${fim}
      GROUP BY 1
    `,
  ]);
  // Chave aaaa-mm-dd: o mesmo pedido serve para os dois meses.
  const mapa = (rows: Array<{ dia: Date; total: Prisma.Decimal | null }>) => new Map(rows.map((r) => [isoDia(new Date(r.dia)), num(r.total)]));
  return { faturamento: mapa(faturamento), compras: mapa(compras) };
}

/** Recorta os dias de um mês (aaaa-mm) de um mapa por data. */
function doMes(mapa: Map<string, number>, mes: string) {
  const saida = new Map<number, number>();
  for (const [dia, valor] of mapa) if (dia.startsWith(mes)) saida.set(Number(dia.slice(8, 10)), valor);
  return saida;
}

const fimDoDia = (iso: string) => new Date(`${iso}T23:59:59.999Z`);

export async function montarVisoes(ano: number, mes: number): Promise<VisoesMetaCmv> {
  const hoje = hojeEmSaoPaulo();
  const iv = intervaloDoMes(ano, mes, hoje);
  const ant = new Date(Date.UTC(ano, mes - 2, 1));
  const ivAnt = intervaloDoMes(ant.getUTCFullYear(), ant.getUTCMonth() + 1, hoje);
  const mesAtual = iv.inicioIso.slice(0, 7);
  const mesAnterior = ivAnt.inicioIso.slice(0, 7);

  // Mês em andamento compara com o mesmo trecho do anterior (1 até o dia de hoje), como o Dashboard faz.
  // Mês fechado compara com o anterior inteiro (junho com maio todo, não 1–30 de maio).
  const comparacaoAteODia = iv.mesCorrente ? Math.min(iv.diasDecorridos, ivAnt.diasNoMes) : ivAnt.diasNoMes;
  const trechoAnterior: Trecho = { inicio: ivAnt.inicio, fim: fimDoDia(`${mesAnterior}-${String(comparacaoAteODia).padStart(2, "0")}`) };
  const trechoAtual: Trecho = { inicio: iv.inicio, fim: iv.fim };

  const [metas, dias, categoria, subcategoria, fornecedor, produto] = await Promise.all([
    prisma.cmvMeta.findMany({ where: { escopo: "GERAL" } }),
    porDia(ivAnt.inicio, iv.fim),
    comprasAgrupadas("categoria", trechoAtual, trechoAnterior),
    comprasAgrupadas("subcategoria", trechoAtual, trechoAnterior),
    comprasAgrupadas("fornecedor", trechoAtual, trechoAnterior),
    comprasAgrupadas("produto", trechoAtual, trechoAnterior),
  ]);
  const meta = metaVigente(metas.map(paraVigencia), "GERAL", null, iv.ateODia);

  const atual = preencherDias(iv.diasNoMes, doMes(dias.faturamento, mesAtual), doMes(dias.compras, mesAtual));
  const anterior = preencherDias(ivAnt.diasNoMes, doMes(dias.faturamento, mesAnterior), doMes(dias.compras, mesAnterior));
  const somaFat = (ds: DiaRitmo[], ate: number) => arredondar(ds.filter((d) => d.dia <= ate).reduce((s, d) => s + d.faturamento, 0));

  return {
    mes: mesAtual,
    mesAnterior,
    ateODia: iv.ateODia,
    mesCorrente: iv.mesCorrente,
    diasNoMes: iv.diasNoMes,
    diasNoMesAnterior: ivAnt.diasNoMes,
    comparacaoAteODia,
    meta: meta ? { alvoPercentual: meta.alvoPercentual, alertaPercentual: meta.alertaPercentual } : null,
    faturamento: somaFat(atual, iv.diasDecorridos),
    faturamentoAnterior: somaFat(anterior, comparacaoAteODia),
    // No mês em andamento os dias depois de hoje ficam de fora: a linha para em hoje.
    ritmo: { atual: atual.filter((d) => d.dia <= iv.diasDecorridos), anterior },
    distribuicao: { categoria, subcategoria, fornecedor, produto },
  };
}
