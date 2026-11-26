import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { cmvPurchasePredicate, getCmvPurchaseTotalsByPurchaseDateRange } from "../cmv-real/cmv-purchase-base.service.js";
import { hojeEmSaoPaulo } from "../payroll/extras-comum.js";
import { arredondar, classificarMeta, metaVigente, projetarMes, type Projecao, type StatusMeta } from "./cmv-metas.logic.js";
import { faturamentoLiquido, intervaloDoMes, paraVigencia, STATUS_PEDIDO_COMPROMETIDO } from "./cmv-metas.service.js";

// Aviso no pedido de compra: se este pedido entrar, as compras comprometidas do mês corrente cabem
// na meta geral de CMV? Só lê; quem chama já passou pela permissão do CMV Real (rota em /monthly/cmv-real).
// A conta é a mesma da projeção do painel: compras do mês + pedidos em andamento, contra o teto
// (faturamento projetado no ritmo atual × meta). Só os itens que entram no CMV contam.

const VISAO = "accounting" as const;
// Depois de enviado o pedido já não se decide nada: o aviso é para quem ainda pode mudar o pedido.
const STATUS_COM_DECISAO = ["RASCUNHO", "EM_REVISAO", "APROVADO"];

const num = (v: Prisma.Decimal | bigint | number | null | undefined) => (v == null ? 0 : Number(v));

export class PedidoNaoEncontradoError extends Error {}

type TotaisDoPedido = { status: string; total: number; totalCmv: number; itensSemPreco: number };

async function totaisDoPedido(id: string): Promise<TotaisDoPedido | null> {
  const pedido = await prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
  if (!pedido) return null;
  const [linha] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null; totalCmv: Prisma.Decimal | null; semPreco: bigint | number | null }>>`
    SELECT
      COALESCE(SUM(poi."totalEstimated"), 0) AS "total",
      COALESCE(SUM(poi."totalEstimated") FILTER (WHERE ${cmvPurchasePredicate(VISAO)}), 0) AS "totalCmv",
      COUNT(*) FILTER (WHERE poi."totalEstimated" IS NULL) AS "semPreco"
    FROM "PurchaseOrderItem" poi
    JOIN "Product" pr ON pr."id" = poi."productId"
    LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE poi."purchaseOrderId" = ${id}
  `;
  return { status: pedido.status, total: num(linha?.total), totalCmv: num(linha?.totalCmv), itensSemPreco: num(linha?.semPreco) };
}

/** Pedidos em andamento que entram no CMV, sem contar o pedido em análise (ele entra à parte). */
async function outrosPedidosComprometidos(excluirId: string) {
  const [linha] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM(poi."totalEstimated"), 0) AS "total"
    FROM "PurchaseOrder" po
    JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
    JOIN "Product" pr ON pr."id" = poi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE po."status" IN (${Prisma.join(STATUS_PEDIDO_COMPROMETIDO)})
      AND po."id" <> ${excluirId}
      AND ${cmvPurchasePredicate(VISAO)}
  `;
  return num(linha?.total);
}

export type ImpactoDoPedido =
  | { situacao: "SEM_DECISAO"; status: string }
  | { situacao: "SEM_META"; pedido: Omit<TotaisDoPedido, "status"> }
  | {
      situacao: "AVALIADO";
      mes: string;
      ateODia: string;
      meta: { alvoPercentual: number; alertaPercentual: number };
      pedido: Omit<TotaisDoPedido, "status">;
      antes: Projecao;
      depois: Projecao;
      statusAntes: StatusMeta;
      statusDepois: StatusMeta;
    };

export async function impactoDoPedido(id: string): Promise<ImpactoDoPedido> {
  const totais = await totaisDoPedido(id);
  if (!totais) throw new PedidoNaoEncontradoError("Pedido de compra não encontrado.");
  const { status, ...pedido } = totais;
  if (!STATUS_COM_DECISAO.includes(status)) return { situacao: "SEM_DECISAO", status };

  const hoje = hojeEmSaoPaulo();
  const [ano, mes] = hoje.split("-").map(Number);
  const iv = intervaloDoMes(ano, mes, hoje);
  const metas = (await prisma.cmvMeta.findMany({ where: { escopo: "GERAL" } })).map(paraVigencia);
  const meta = metaVigente(metas, "GERAL", null, iv.ateODia);
  if (!meta) return { situacao: "SEM_META", pedido };

  const [fat, compras, outros] = await Promise.all([
    faturamentoLiquido(iv.inicio, iv.fim),
    getCmvPurchaseTotalsByPurchaseDateRange(iv.inicio, iv.fim, VISAO),
    outrosPedidosComprometidos(id),
  ]);
  const base = { comprasAteHoje: compras.total, faturamentoAteHoje: fat, diasDecorridos: iv.diasDecorridos, diasNoMes: iv.diasNoMes, alvoPercentual: meta.alvoPercentual };
  const antes = projetarMes({ ...base, pedidosAbertos: outros });
  const depois = projetarMes({ ...base, pedidosAbertos: arredondar(outros + pedido.totalCmv) });
  return {
    situacao: "AVALIADO",
    mes: iv.inicioIso.slice(0, 7),
    ateODia: iv.ateODia,
    meta: { alvoPercentual: meta.alvoPercentual, alertaPercentual: meta.alertaPercentual },
    pedido,
    antes,
    depois,
    statusAntes: classificarMeta(antes.percentualProjetado, meta.alvoPercentual, meta.alertaPercentual),
    statusDepois: classificarMeta(depois.percentualProjetado, meta.alvoPercentual, meta.alertaPercentual),
  };
}
