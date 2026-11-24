import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { semParcelamentoForaDoDreSql } from "../parcelamentos/parcelamento-dre.js";
import { hojeEmBrasilia } from "../monthly/revenue-coverage.service.js";
import { REVENUE_CHANNEL_SALON } from "../monthly/revenue-channels.js";
import { excludeAggregatorsSql } from "../purchases/purchase-aggregators.js";
import type { GrupoDeGasto } from "./planejamento-gastos.js";
import { MESES_HERDADOS } from "./planejamento-caixa.js";
import {
  coberturaDoPrazo,
  mesesMadurosParaPrazo,
  montarMix,
  montarPagoNoMes,
  prazoMedioDasCompras,
  type PagamentoPorDefasagem,
  type RealizadoDeCaixa,
  type TotaisPorForma
} from "./planejamento-realizado-caixa.js";
import { GRUPO_DO_DRE, mesesEncerradosDoAno } from "./planejamento-realizado.js";

// Consultas do realizado de caixa. Só leitura. As regras de quais compras contam (sem títulos de ciclo/cartão/reembolso,
// que repetem compras já lançadas) são as mesmas do DRE.

const semTituloDeAgregador = excludeAggregatorsSql("p");
const semParcelamentoForaDoDre = semParcelamentoForaDoDreSql("p");

type LinhaDeDefasagem = { grupo: string | null; defasagem: number | null; total: Prisma.Decimal | null };

const emMeses = (meses: readonly number[]) => Prisma.join(meses as number[]);

/** Meses entre a competência e o pagamento, como número de meses corridos (0 = no mesmo mês). */
/** Parcela ainda aberta num mês já maduro: conta como paga "depois" (≥ 2 meses), para não sumir do denominador. */
const AINDA_NAO_PAGO = Prisma.sql`99`;

const DEFASAGEM_DA_COMPRA = Prisma.sql`((EXTRACT(YEAR FROM pi."paidDate")::int * 12 + EXTRACT(MONTH FROM pi."paidDate")::int) - (p."competenceYear" * 12 + p."competenceMonth"))`;

async function pagamentosDeParcelas(ano: number, meses: readonly number[]): Promise<PagamentoPorDefasagem[]> {
  if (meses.length === 0) return [];
  // Nota SEM itens de produto (serviço, despesa fixa): é o que o DRE chama de Parte A e o que vira ocupação, tarifas e afins.
  const linhas = await prisma.$queryRaw<LinhaDeDefasagem[]>`
    SELECT dc."dreGroup" AS "grupo",
           CASE WHEN pi."paidDate" IS NULL THEN ${AINDA_NAO_PAGO} ELSE ${DEFASAGEM_DA_COMPRA} END AS "defasagem",
           SUM(COALESCE(pi."paidAmount", pi.amount, 0)) AS "total"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p.id = pi."purchaseId"
    LEFT JOIN "DRECategory" dc ON dc.id = pi."dreCategory"
    WHERE p.status = 'ACTIVE'
      AND pi.status NOT IN ('CANCELLED')
      AND pi."reversedAt" IS NULL
      AND ${semTituloDeAgregador}
      AND ${semParcelamentoForaDoDre}
      AND NOT EXISTS (SELECT 1 FROM "PurchaseItem" px WHERE px."purchaseId" = p.id)
      AND p."competenceYear" = ${ano}
      AND p."competenceMonth" IN (${emMeses(meses)})
    GROUP BY 1, 2
  `;
  return linhas.flatMap((l) => {
    const grupo = GRUPO_DO_DRE[l.grupo ?? "DESPESAS_OPERACIONAIS"];
    return grupo ? [{ grupo, defasagem: Number(l.defasagem ?? 0), total: Number(l.total ?? 0) }] : [];
  });
}

async function pagamentosDeTributos(ano: number, meses: readonly number[]): Promise<PagamentoPorDefasagem[]> {
  if (meses.length === 0) return [];
  const linhas = await prisma.$queryRaw<Array<{ defasagem: number | null; total: Prisma.Decimal | null }>>`
    SELECT CASE WHEN tp."paymentDate" IS NULL THEN ${AINDA_NAO_PAGO}
                ELSE ((EXTRACT(YEAR FROM tp."paymentDate")::int * 12 + EXTRACT(MONTH FROM tp."paymentDate")::int)
                    - (EXTRACT(YEAR FROM tp."competenceDate")::int * 12 + EXTRACT(MONTH FROM tp."competenceDate")::int)) END AS "defasagem",
           SUM(COALESCE(tp."paidAmount", tp.amount)) AS "total"
    FROM "TaxPayment" tp
    WHERE tp."deletedAt" IS NULL
      AND tp.status NOT IN ('CANCELED')
      AND tp."competenceDate" IS NOT NULL
      AND EXTRACT(YEAR FROM tp."competenceDate")::int = ${ano}
      AND EXTRACT(MONTH FROM tp."competenceDate")::int IN (${emMeses(meses)})
    GROUP BY 1
  `;
  return linhas.map((l) => ({ grupo: "TRIBUTOS" as GrupoDeGasto, defasagem: Number(l.defasagem ?? 0), total: Number(l.total ?? 0) }));
}

async function pagamentosDeFolha(ano: number, meses: readonly number[]): Promise<PagamentoPorDefasagem[]> {
  if (meses.length === 0) return [];
  const linhas = await prisma.$queryRaw<Array<{ defasagem: number | null; total: Prisma.Decimal | null }>>`
    SELECT CASE WHEN pit."paymentDate" IS NULL THEN ${AINDA_NAO_PAGO}
                ELSE ((EXTRACT(YEAR FROM pit."paymentDate")::int * 12 + EXTRACT(MONTH FROM pit."paymentDate")::int)
                    - (pit."competenceYear" * 12 + pit."competenceMonth")) END AS "defasagem",
           SUM(COALESCE(pit."paidAmount", pit.amount)) AS "total"
    FROM "PayrollItem" pit
    WHERE pit."deletedAt" IS NULL
      AND pit.status NOT IN ('CANCELED')
      AND pit."competenceYear" = ${ano}
      AND pit."competenceMonth" IN (${emMeses(meses)})
    GROUP BY 1
  `;
  return linhas.map((l) => ({ grupo: "FOLHA" as GrupoDeGasto, defasagem: Number(l.defasagem ?? 0), total: Number(l.total ?? 0) }));
}

async function mixDeVendas(ano: number, meses: readonly number[]): Promise<TotaisPorForma> {
  const vazio: TotaisPorForma = { DINHEIRO: 0, PIX: 0, DEBITO: 0, CREDITO: 0, VOUCHER: 0 };
  if (meses.length === 0) return vazio;
  const [r] = await prisma.$queryRaw<Array<Record<string, Prisma.Decimal | null>>>`
    SELECT SUM(COALESCE("cashAmount", 0)) AS "dinheiro", SUM(COALESCE("pixAmount", 0)) AS "pix",
           SUM(COALESCE("debitAmount", 0)) AS "debito", SUM(COALESCE("creditAmount", 0)) AS "credito",
           SUM(COALESCE("voucherAmount", 0)) AS "voucher"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" = ${REVENUE_CHANNEL_SALON}
      AND "competenceYear" = ${ano}
      AND "competenceMonth" IN (${emMeses(meses)})
  `;
  if (!r) return vazio;
  return { DINHEIRO: Number(r.dinheiro ?? 0), PIX: Number(r.pix ?? 0), DEBITO: Number(r.debito ?? 0), CREDITO: Number(r.credito ?? 0), VOUCHER: Number(r.voucher ?? 0) };
}

/** Prazo médio entre a data da compra e o pagamento, nas compras com itens de produto (insumos). */
async function prazoDeCompras(ano: number, meses: readonly number[]): Promise<{ prazo: number | null; cobertura: number | null }> {
  if (meses.length === 0) return { prazo: null, cobertura: null };
  const [totalDasCompras] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT SUM(p."totalAmount") AS "total"
    FROM "Purchase" p
    WHERE p.status = 'ACTIVE'
      AND ${semParcelamentoForaDoDre}
      AND EXISTS (SELECT 1 FROM "PurchaseItem" px WHERE px."purchaseId" = p.id)
      AND p."competenceYear" = ${ano}
      AND p."competenceMonth" IN (${emMeses(meses)})
  `;
  const [r] = await prisma.$queryRaw<Array<{ ponderado: Prisma.Decimal | null; total: Prisma.Decimal | null }>>`
    SELECT SUM(GREATEST(pi."paidDate"::date - p."purchaseDate"::date, 0) * COALESCE(pi."paidAmount", pi.amount, 0)) AS "ponderado",
           SUM(COALESCE(pi."paidAmount", pi.amount, 0)) AS "total"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p.id = pi."purchaseId"
    WHERE p.status = 'ACTIVE'
      AND pi.status NOT IN ('CANCELLED')
      AND pi."paidDate" IS NOT NULL
      AND pi."reversedAt" IS NULL
      AND ${semTituloDeAgregador}
      AND ${semParcelamentoForaDoDre}
      AND EXISTS (SELECT 1 FROM "PurchaseItem" px WHERE px."purchaseId" = p.id)
      AND p."competenceYear" = ${ano}
      AND p."competenceMonth" IN (${emMeses(meses)})
  `;
  const medido = Number(r?.total ?? 0);
  return { prazo: prazoMedioDasCompras(Number(r?.ponderado ?? 0), medido), cobertura: coberturaDoPrazo(medido, Number(totalDasCompras?.total ?? 0)) };
}

/**
 * Mês (1 a 3) em que um título aberto cai no caixa do cenário. O que venceu ANTES de 1º de janeiro e continua aberto
 * (atrasado) ainda vai ser pago/recebido: entra em janeiro, em vez de ficar de fora da conta.
 */
const mesHerdado = (coluna: string, inicio: Date) =>
  Prisma.sql`CASE WHEN ${Prisma.raw(coluna)} < ${inicio} THEN 1 ELSE EXTRACT(MONTH FROM ${Prisma.raw(coluna)})::int END`;

/** O que já está lançado e aberto com vencimento até março do ano do cenário (inclusive o atrasado, somado a janeiro). */
async function herdadoDoAno(anoDoCenario: number): Promise<{ entradas: number[]; saidas: number[] }> {
  const inicio = new Date(Date.UTC(anoDoCenario, 0, 1));
  const fim = new Date(Date.UTC(anoDoCenario, MESES_HERDADOS, 1));
  const [aPagar, folhaAPagar, tributosAPagar, aReceber] = await Promise.all([
    // Caixa NÃO exclui o título de ciclo/cartão/reembolso: ele é o registro que leva o valor ao Contas a Pagar.
    prisma.$queryRaw<Array<{ mes: number; total: Prisma.Decimal | null }>>`
      SELECT ${mesHerdado('pi."dueDate"', inicio)} AS "mes", SUM(COALESCE(pi.amount, 0)) AS "total"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      WHERE p.status = 'ACTIVE'
        AND pi.status NOT IN ('CANCELLED', 'PAID')
        AND pi."paidDate" IS NULL
        AND pi."reversedAt" IS NULL
        AND pi."dueDate" < ${fim}
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ mes: number; total: Prisma.Decimal | null }>>`
      SELECT ${mesHerdado('pit."dueDate"', inicio)} AS "mes", SUM(pit.amount) AS "total"
      FROM "PayrollItem" pit
      WHERE pit."deletedAt" IS NULL AND pit.status NOT IN ('CANCELED', 'PAID') AND pit."paymentDate" IS NULL
        AND pit."dueDate" < ${fim}
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ mes: number; total: Prisma.Decimal | null }>>`
      SELECT ${mesHerdado('tp."dueDate"', inicio)} AS "mes", SUM(tp.amount) AS "total"
      FROM "TaxPayment" tp
      WHERE tp."deletedAt" IS NULL AND tp.status NOT IN ('CANCELED', 'PAID') AND tp."paymentDate" IS NULL
        AND tp."dueDate" < ${fim}
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ mes: number; total: Prisma.Decimal | null }>>`
      SELECT ${mesHerdado('r."expectedDate"', inicio)} AS "mes", SUM(GREATEST(r."netAmount" - COALESCE(r."paidAmount", 0), 0)) AS "total"
      FROM "Receivable" r
      WHERE r.status IN ('OPEN', 'PARTIALLY_RECEIVED', 'LATE')
        AND r."cancelledAt" IS NULL
        AND r."sourceType" IN ('EVENT', 'DIRECT', 'OTHER')
        AND r."expectedDate" < ${fim}
      GROUP BY 1
    `
  ]);
  const porMes = (linhas: Array<{ mes: number; total: Prisma.Decimal | null }>) =>
    Array.from({ length: MESES_HERDADOS }, (_, i) => Math.round(Number(linhas.find((l) => l.mes === i + 1)?.total ?? 0) * 100) / 100);
  const saidas = [0, 1, 2].map((i) => Math.round((porMes(aPagar)[i] + porMes(folhaAPagar)[i] + porMes(tributosAPagar)[i]) * 100) / 100);
  return { entradas: porMes(aReceber), saidas };
}

/** Realizado de caixa do ano-base. `anoDoCenario` é o ano projetado (para o herdado de jan–mar). */
export async function carregarRealizadoDeCaixa(anoBase: number, anoDoCenario: number): Promise<RealizadoDeCaixa> {
  const hoje = hojeEmBrasilia();
  const mesesDeVenda = mesesEncerradosDoAno(anoBase, hoje);
  const mesesParaPrazo = mesesMadurosParaPrazo(anoBase, hoje);

  const [parcelas, tributos, folha, mix, compras, herdado] = await Promise.all([
    pagamentosDeParcelas(anoBase, mesesParaPrazo),
    pagamentosDeTributos(anoBase, mesesParaPrazo),
    pagamentosDeFolha(anoBase, mesesParaPrazo),
    mixDeVendas(anoBase, mesesDeVenda),
    prazoDeCompras(anoBase, mesesParaPrazo),
    herdadoDoAno(anoDoCenario)
  ]);

  const avisos: string[] = [];
  if (mesesParaPrazo.length === 0) avisos.push(`Em ${anoBase} ainda não há meses com pagamentos já realizados para medir o prazo.`);
  else if (mesesParaPrazo.length < 6) avisos.push(`Poucos meses medidos (${mesesParaPrazo.length}): o prazo pode oscilar.`);

  if (compras.cobertura !== null && compras.cobertura < 0.6) {
    avisos.push(`O prazo das compras mede só ${Math.round(compras.cobertura * 100)}% do valor das compras com itens: as pagas por ciclo de fornecedor ou fatura de cartão não entram. Confira antes de aplicar.`);
  }

  return {
    ano: anoBase,
    mesesParaPrazo,
    mix: montarMix(mix),
    comprasPrazoDias: compras.prazo,
    comprasCobertura: compras.cobertura,
    pagoNoMes: montarPagoNoMes([...parcelas, ...tributos, ...folha]),
    herdado,
    avisos
  };
}
