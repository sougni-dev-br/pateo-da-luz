import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { custoExtrasSql } from "../payroll/extras-custo.js";
import { excludeAggregatorsSql } from "../purchases/purchase-aggregators.js";

// Grupos do DRE que o Resultado completo mostra em linha própria. Compra
// lançada com produto desses grupos (a nota do condomínio, por exemplo) já está
// em "Compras"; sai de lá para não contar duas vezes.
const GRUPOS_PESSOAL = ["PESSOAL", "VALE_TRANSPORTE"];
const GRUPO_IMPOSTOS = "IMPOSTOS";
// Ocupação = aluguel/condomínio (LOCACAO) + energia, água, gás e telefonia.
const GRUPOS_OCUPACAO = ["LOCACAO", "TARIFAS_PUBLICAS"];

export type ResultadoCompleto = {
  purchases: number;
  smallExpenses: number;
  payroll: number;
  taxes: number;
  occupancy: number;
  value: number;
  marginPercent: number | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const diaKey = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function montarResultadoCompleto(input: {
  net: number;
  purchasesTotal: number;
  smallExpenses: number;
  payrollPayments: number;
  // Guias por grupo do DRE (sem categoria = "SEM_GRUPO"). FGTS é cadastrado em
  // Pessoal; o restante, inclusive guia sem categoria, é imposto.
  taxPaymentsPorGrupo: Record<string, number>;
  porGrupoDeCompra: Record<string, number>;
}): ResultadoCompleto {
  const g = input.porGrupoDeCompra;
  let guiasDePessoal = 0;
  let guiasDeImposto = 0;
  for (const [grupo, total] of Object.entries(input.taxPaymentsPorGrupo)) {
    if (GRUPOS_PESSOAL.includes(grupo)) guiasDePessoal += total;
    else guiasDeImposto += total;
  }
  const pessoalEmCompras = GRUPOS_PESSOAL.reduce((s, k) => s + (g[k] ?? 0), 0);
  const impostosEmCompras = g[GRUPO_IMPOSTOS] ?? 0;
  const occupancy = GRUPOS_OCUPACAO.reduce((s, k) => s + (g[k] ?? 0), 0);

  const purchases = input.purchasesTotal - pessoalEmCompras - impostosEmCompras - occupancy;
  const payroll = input.payrollPayments + guiasDePessoal + pessoalEmCompras;
  const taxes = guiasDeImposto + impostosEmCompras;
  const value = input.net - purchases - input.smallExpenses - payroll - taxes - occupancy;

  return {
    purchases: round2(purchases),
    smallExpenses: round2(input.smallExpenses),
    payroll: round2(payroll),
    taxes: round2(taxes),
    occupancy: round2(occupancy),
    value: round2(value),
    marginPercent: input.net > 0 ? (value / input.net) * 100 : null,
  };
}

export async function calcularResultadoCompleto(
  year: number,
  month: number,
  base: { net: number; purchasesTotal: number; smallExpenses: number },
): Promise<ResultadoCompleto> {
  const primeiroDia = diaKey(year, month, 1);
  const ultimoDia = diaKey(year, month, new Date(year, month, 0).getDate());

  const [folhaRow, extrasRow, guiasPorGrupo, comprasPorGrupo] = await Promise.all([
    prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM "PayrollItem"
      WHERE "deletedAt" IS NULL
        AND status NOT IN ('CANCELED')
        AND "competenceYear" = ${year}
        AND "competenceMonth" = ${month}
    `,
    prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM(c.valor), 0) AS total
      FROM (${custoExtrasSql}) c
      WHERE c.dia >= ${primeiroDia}::date AND c.dia <= ${ultimoDia}::date
    `,
    prisma.$queryRaw<Array<{ grupo: string | null; total: unknown }>>`
      SELECT dc."dreGroup" AS grupo, COALESCE(SUM(tp.amount), 0) AS total
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
      WHERE tp."deletedAt" IS NULL
        AND tp.status NOT IN ('CANCELED')
        AND tp."competenceDate" IS NOT NULL
        AND tp."competenceDate" >= ${primeiroDia}::date
        AND tp."competenceDate" <= ${ultimoDia}::date
      GROUP BY dc."dreGroup"
    `,
    prisma.$queryRaw<Array<{ grupo: string; total: unknown }>>`
      SELECT dc."dreGroup" AS grupo, COALESCE(SUM(pi."totalPrice"), 0) AS total
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      JOIN "Product" prod ON prod.id = pi."productId"
      JOIN "DRECategory" dc ON dc.id = prod."dreCategoryId"
      WHERE p."competenceYear" = ${year}
        AND p."competenceMonth" = ${month}
        AND p.status = 'ACTIVE'
        AND (p."isSmallExpense" = false OR p."isSmallExpense" IS NULL)
        AND ${excludeAggregatorsSql("p")}
        AND dc."dreGroup" IN (${Prisma.join([...GRUPOS_PESSOAL, GRUPO_IMPOSTOS, ...GRUPOS_OCUPACAO])})
      GROUP BY dc."dreGroup"
    `,
  ]);

  const porGrupoDeCompra: Record<string, number> = {};
  for (const r of comprasPorGrupo) porGrupoDeCompra[r.grupo] = Number(r.total ?? 0);

  const taxPaymentsPorGrupo: Record<string, number> = {};
  for (const r of guiasPorGrupo) taxPaymentsPorGrupo[r.grupo ?? "SEM_GRUPO"] = Number(r.total ?? 0);

  return montarResultadoCompleto({
    net: base.net,
    purchasesTotal: base.purchasesTotal,
    smallExpenses: base.smallExpenses,
    payrollPayments: Number(folhaRow[0]?.total ?? 0) + Number(extrasRow[0]?.total ?? 0),
    taxPaymentsPorGrupo,
    porGrupoDeCompra,
  });
}
