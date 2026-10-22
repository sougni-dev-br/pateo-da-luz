import { prisma } from "../../config/database.js";
import { hojeBrasilia } from "./tax-payment-rules.js";

// Painel da tela de Impostos: o que há a pagar e quão urgente é, quantas guias em cada situação
// e quais meses (por categoria do DRE) já têm guia lançada. É global — não segue os filtros da lista.

export type PanoramaImpostos = {
  hoje: string;
  situacoes: { todas: number; vencidas: number; aVencer: number; pagas: number; canceladas: number };
  aPagar: {
    vencido: { qtd: number; valor: number };
    ate7: { qtd: number; valor: number };
    ate30: { qtd: number; valor: number };
    depois: { qtd: number; valor: number };
  };
  meses: string[];
  cobertura: Array<{ mes: string; grupo: string; categoriaId: string | null; qtd: number; pagas: number; vencidas: number; valor: number }>;
  semCompetencia: number;
};

const MESES_NA_COBERTURA = 12;

// 12 competências terminando no mês de "hoje" (AAAA-MM), do mais antigo ao mais novo.
export function mesesDaCobertura(hoje: string, quantidade = MESES_NA_COBERTURA): string[] {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7)) - 1;
  return Array.from({ length: quantidade }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - (quantidade - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

type LinhaSituacao = {
  todas: number; canceladas: number; pagas: number; vencidas: number; a_vencer: number;
  v_qtd: number; v_valor: string; s7_qtd: number; s7_valor: string; s30_qtd: number; s30_valor: string; d_qtd: number; d_valor: string;
};

type LinhaCobertura = { mes: string; grupo: string; categoriaId: string | null; qtd: number; pagas: number; vencidas: number; valor: string };

export async function montarPanorama(agora: Date = new Date()): Promise<PanoramaImpostos> {
  // hoje e primeiroMes vêm de Intl/aritmética (só dígitos), por isso podem ser interpolados.
  const hoje = hojeBrasilia(agora);
  const meses = mesesDaCobertura(hoje);
  const primeiroMes = `${meses[0]}-01`;
  const T = `'${hoje}'::timestamp`;

  const [situacao, cobertura, semComp] = await Promise.all([
    prisma.$queryRawUnsafe<LinhaSituacao[]>(`
      SELECT
        COUNT(*)::int AS "todas",
        COUNT(*) FILTER (WHERE tp."status" = 'CANCELED')::int AS "canceladas",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NOT NULL)::int AS "pagas",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" < ${T})::int AS "vencidas",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T})::int AS "a_vencer",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" < ${T})::int AS "v_qtd",
        COALESCE(SUM(tp."amount") FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" < ${T}), 0)::text AS "v_valor",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} AND tp."dueDate" < ${T} + interval '8 days')::int AS "s7_qtd",
        COALESCE(SUM(tp."amount") FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} AND tp."dueDate" < ${T} + interval '8 days'), 0)::text AS "s7_valor",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} + interval '8 days' AND tp."dueDate" < ${T} + interval '31 days')::int AS "s30_qtd",
        COALESCE(SUM(tp."amount") FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} + interval '8 days' AND tp."dueDate" < ${T} + interval '31 days'), 0)::text AS "s30_valor",
        COUNT(*) FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} + interval '31 days')::int AS "d_qtd",
        COALESCE(SUM(tp."amount") FILTER (WHERE tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= ${T} + interval '31 days'), 0)::text AS "d_valor"
      FROM "TaxPayment" tp
      WHERE tp."deletedAt" IS NULL
    `),
    prisma.$queryRawUnsafe<LinhaCobertura[]>(`
      SELECT
        to_char(date_trunc('month', tp."competenceDate"), 'YYYY-MM') AS "mes",
        COALESCE(dc."name", 'Sem categoria') AS "grupo",
        tp."dreCategoryId" AS "categoriaId",
        COUNT(*)::int AS "qtd",
        COUNT(*) FILTER (WHERE tp."paymentDate" IS NOT NULL)::int AS "pagas",
        COUNT(*) FILTER (WHERE tp."paymentDate" IS NULL AND tp."dueDate" < ${T})::int AS "vencidas",
        COALESCE(SUM(tp."amount"), 0)::text AS "valor"
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc."id" = tp."dreCategoryId"
      WHERE tp."deletedAt" IS NULL AND tp."status" <> 'CANCELED'
        AND tp."competenceDate" >= '${primeiroMes}'::timestamp
        AND tp."competenceDate" < date_trunc('month', ${T}) + interval '1 month'
      GROUP BY 1, 2, 3
      ORDER BY 2, 1
    `),
    prisma.$queryRawUnsafe<Array<{ total: number }>>(`
      SELECT COUNT(*)::int AS "total" FROM "TaxPayment" tp
      WHERE tp."deletedAt" IS NULL AND tp."status" <> 'CANCELED' AND tp."competenceDate" IS NULL
    `),
  ]);

  const s = situacao[0];
  const par = (qtd: number | undefined, valor: string | undefined) => ({ qtd: qtd ?? 0, valor: Number(valor ?? 0) });

  return {
    hoje,
    situacoes: {
      todas: s?.todas ?? 0, vencidas: s?.vencidas ?? 0, aVencer: s?.a_vencer ?? 0, pagas: s?.pagas ?? 0, canceladas: s?.canceladas ?? 0,
    },
    aPagar: {
      vencido: par(s?.v_qtd, s?.v_valor),
      ate7: par(s?.s7_qtd, s?.s7_valor),
      ate30: par(s?.s30_qtd, s?.s30_valor),
      depois: par(s?.d_qtd, s?.d_valor),
    },
    meses,
    cobertura: cobertura.map((c) => ({ ...c, valor: Number(c.valor) })),
    semCompetencia: semComp[0]?.total ?? 0,
  };
}
