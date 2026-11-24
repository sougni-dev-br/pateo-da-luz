import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { cmvPurchasePredicate, getCmvPurchaseTotalsByPurchaseDateRange } from "../cmv-real/cmv-purchase-base.service.js";
import { hojeEmSaoPaulo } from "../payroll/extras-comum.js";
import { arredondar, classificarMeta, metaVigente, percentualDe, projetarMes, razaoParaPercentual, validarPercentuais, type MetaVigencia, type Projecao, type StatusMeta } from "./cmv-metas.logic.js";

// Metas de CMV % (compras ÷ faturamento). Só LÊ compras, pedidos e faturamento que já existem;
// a única escrita é na tabela CmvMeta. Segue a visão contábil do CMV (mesma base do CMV Real).

const VISAO = "accounting" as const;
// Pedido ainda não recebido que já foi para revisão/aprovação/envio: dinheiro comprometido, mas fora de Compras.
// Rascunho não conta (ainda não é compromisso) e RECEBIDO_PARCIAL fica de fora para não dobrar com a nota já lançada.
const STATUS_PEDIDO_COMPROMETIDO = ["EM_REVISAO", "APROVADO", "ENVIADO"];

export class MetaInvalidaError extends Error {}

const num = (v: Prisma.Decimal | bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const primeiroDiaDoMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}-01`;
const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

type LinhaMeta = Awaited<ReturnType<typeof prisma.cmvMeta.findMany>>[number];
const paraVigencia = (m: LinhaMeta): MetaVigencia => ({
  id: m.id,
  escopo: m.escopo === "SETOR" ? "SETOR" : "GERAL",
  sectorId: m.sectorId,
  alvoPercentual: num(m.alvoPercentual),
  alertaPercentual: num(m.alertaPercentual),
  vigenciaInicio: isoDia(m.vigenciaInicio),
  vigenciaFim: m.vigenciaFim ? isoDia(m.vigenciaFim) : null,
});

// ─── Metas (cadastro) ──────────────────────────────────────────────────────────

export async function listarMetas() {
  const [metas, setores] = await Promise.all([
    prisma.cmvMeta.findMany({ orderBy: [{ escopo: "asc" }, { vigenciaInicio: "desc" }] }),
    prisma.inventorySector.findMany({ where: { isActive: true }, orderBy: [{ countOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const nomes = new Map(setores.map((s) => [s.id, s.name]));
  return {
    setores,
    metas: metas.map((m) => ({ ...paraVigencia(m), setorNome: m.sectorId ? nomes.get(m.sectorId) ?? null : null, observacao: m.observacao })),
  };
}

export type EntradaMeta = {
  escopo: "GERAL" | "SETOR";
  sectorId: string | null;
  alvoPercentual: number;
  alertaPercentual: number;
  /** yyyy-mm — a vigência sempre começa no dia 1 do mês, como a competência do CMV. */
  inicio: string;
  observacao: string | null;
  userId: string;
};

const diaAnterior = (iso: string) => isoDia(new Date(paraData(iso).getTime() - 86_400_000));

/** Grava uma vigência nova. A anterior é encerrada na véspera; a seguinte (se existir) limita o fim desta. */
export async function salvarMeta(entrada: EntradaMeta) {
  const erro = validarPercentuais(entrada.alvoPercentual, entrada.alertaPercentual);
  if (erro) throw new MetaInvalidaError(erro);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entrada.inicio)) throw new MetaInvalidaError("Informe o mês de início da meta.");
  if (entrada.escopo === "SETOR") {
    if (!entrada.sectorId) throw new MetaInvalidaError("Escolha o setor da meta.");
    const setor = await prisma.inventorySector.findUnique({ where: { id: entrada.sectorId }, select: { id: true } });
    if (!setor) throw new MetaInvalidaError("Setor não encontrado.");
  } else if (entrada.sectorId) {
    throw new MetaInvalidaError("Meta geral não tem setor.");
  }

  const inicio = `${entrada.inicio}-01`;
  const sectorId = entrada.escopo === "SETOR" ? entrada.sectorId : null;
  const mesmoEscopo = { escopo: entrada.escopo, sectorId };

  return prisma.$transaction(async (tx) => {
    const igual = await tx.cmvMeta.findFirst({ where: { ...mesmoEscopo, vigenciaInicio: paraData(inicio) } });
    const dados = {
      alvoPercentual: entrada.alvoPercentual,
      alertaPercentual: entrada.alertaPercentual,
      observacao: entrada.observacao,
    };
    if (igual) {
      return tx.cmvMeta.update({ where: { id: igual.id }, data: dados });
    }
    // Encerra a vigência que estava valendo na véspera do novo início.
    await tx.cmvMeta.updateMany({
      where: { ...mesmoEscopo, vigenciaInicio: { lt: paraData(inicio) }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: paraData(inicio) } }] },
      data: { vigenciaFim: paraData(diaAnterior(inicio)) },
    });
    const seguinte = await tx.cmvMeta.findFirst({ where: { ...mesmoEscopo, vigenciaInicio: { gt: paraData(inicio) } }, orderBy: { vigenciaInicio: "asc" } });
    return tx.cmvMeta.create({
      data: {
        escopo: entrada.escopo,
        sectorId,
        ...dados,
        vigenciaInicio: paraData(inicio),
        vigenciaFim: seguinte ? paraData(diaAnterior(isoDia(seguinte.vigenciaInicio))) : null,
        createdById: entrada.userId,
      },
    });
  });
}

/** Apaga uma vigência. A anterior continua encerrada em sua data: o buraco aparece como "sem meta" no painel. */
export async function removerMeta(id: string) {
  const existente = await prisma.cmvMeta.findUnique({ where: { id } });
  if (!existente) return null;
  await prisma.cmvMeta.delete({ where: { id } });
  return existente;
}

// ─── Números do mês ────────────────────────────────────────────────────────────

async function faturamentoLiquido(inicio: Date, fim: Date) {
  const [row] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM("netAmount"), 0) AS "total"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= CAST(${inicio} AS timestamp)
      AND "date" <= CAST(${fim} AS timestamp)
  `;
  return num(row?.total);
}

async function comprasPorSetor(inicio: Date, fim: Date) {
  const rows = await prisma.$queryRaw<Array<{ sectorId: string | null; total: Prisma.Decimal | null }>>`
    SELECT pr."inventorySectorId" AS "sectorId", COALESCE(SUM(pi."totalPrice"), 0) AS "total"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(VISAO)}
      AND p."purchaseDate" >= ${inicio}
      AND p."purchaseDate" <= ${fim}
    GROUP BY pr."inventorySectorId"
  `;
  return new Map(rows.map((r) => [r.sectorId, num(r.total)]));
}

async function pedidosAbertosPorSetor() {
  const rows = await prisma.$queryRaw<Array<{ sectorId: string | null; total: Prisma.Decimal | null }>>`
    SELECT pr."inventorySectorId" AS "sectorId", COALESCE(SUM(poi."totalEstimated"), 0) AS "total"
    FROM "PurchaseOrder" po
    JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
    JOIN "Product" pr ON pr."id" = poi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE po."status" IN (${Prisma.join(STATUS_PEDIDO_COMPROMETIDO)})
      AND ${cmvPurchasePredicate(VISAO)}
    GROUP BY pr."inventorySectorId"
  `;
  return new Map(rows.map((r) => [r.sectorId, num(r.total)]));
}

export type LinhaPainel = {
  escopo: "GERAL" | "SETOR";
  sectorId: string | null;
  nome: string;
  meta: { id: string; alvoPercentual: number; alertaPercentual: number } | null;
  compras: number;
  pedidosAbertos: number;
  realizadoPercentual: number | null;
  status: StatusMeta;
  projecao: Projecao | null;
};

export type HistoricoMes = { mes: string; faturamento: number; compras: number; realizadoPercentual: number | null; alvoPercentual: number | null; status: StatusMeta };

export type Painel = {
  mes: string;
  hoje: string;
  /** Dia até onde os números valem: hoje, se o mês é o corrente; senão o último dia do mês. */
  ateODia: string;
  mesCorrente: boolean;
  faturamento: number;
  cmvRealCiclo: { percentual: number; periodo: string; status: string } | null;
  linhas: LinhaPainel[];
  historico: HistoricoMes[];
};

function intervaloDoMes(ano: number, mes: number, hoje: string) {
  const inicioIso = primeiroDiaDoMes(ano, mes);
  const ultimo = ultimoDiaDoMes(ano, mes);
  const fimMesIso = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  const mesCorrente = hoje.slice(0, 7) === inicioIso.slice(0, 7);
  const ateODia = mesCorrente ? hoje : fimMesIso;
  const diasDecorridos = Number(ateODia.slice(8, 10));
  return {
    inicio: paraData(inicioIso),
    fim: new Date(`${ateODia}T23:59:59.999Z`),
    inicioIso,
    ateODia,
    mesCorrente,
    diasDecorridos: mesCorrente ? diasDecorridos : ultimo,
    diasNoMes: ultimo,
  };
}

async function historicoGeral(ano: number, mes: number, metas: MetaVigencia[], hoje: string): Promise<HistoricoMes[]> {
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - (5 - i), 1));
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  });
  return Promise.all(
    meses.map(async (m) => {
      const iv = intervaloDoMes(m.ano, m.mes, hoje);
      const [fat, compras] = await Promise.all([
        faturamentoLiquido(iv.inicio, iv.fim),
        getCmvPurchaseTotalsByPurchaseDateRange(iv.inicio, iv.fim, VISAO),
      ]);
      const meta = metaVigente(metas, "GERAL", null, iv.inicioIso);
      const realizado = percentualDe(compras.total, fat);
      return {
        mes: iv.inicioIso.slice(0, 7),
        faturamento: arredondar(fat),
        compras: arredondar(compras.total),
        realizadoPercentual: realizado,
        alvoPercentual: meta?.alvoPercentual ?? null,
        status: meta ? classificarMeta(realizado, meta.alvoPercentual, meta.alertaPercentual) : "SEM_DADOS",
      };
    }),
  );
}

export async function montarPainel(ano: number, mes: number): Promise<Painel> {
  const hoje = hojeEmSaoPaulo();
  const iv = intervaloDoMes(ano, mes, hoje);
  const [linhasMeta, setores, fat, geral, porSetor, pedidos, ciclo] = await Promise.all([
    prisma.cmvMeta.findMany(),
    prisma.inventorySector.findMany({ where: { isActive: true }, orderBy: [{ countOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    faturamentoLiquido(iv.inicio, iv.fim),
    getCmvPurchaseTotalsByPurchaseDateRange(iv.inicio, iv.fim, VISAO),
    comprasPorSetor(iv.inicio, iv.fim),
    pedidosAbertosPorSetor(),
    prisma.cmvPeriod.findFirst({ where: { dataFinal: { gte: iv.inicio, lte: iv.fim } }, orderBy: { dataFinal: "desc" } }),
  ]);
  const metas = linhasMeta.map(paraVigencia);
  const pedidosTotal = [...pedidos.values()].reduce((a, b) => a + b, 0);

  const montar = (escopo: "GERAL" | "SETOR", sectorId: string | null, nome: string, compras: number, abertos: number): LinhaPainel => {
    const meta = metaVigente(metas, escopo, sectorId, iv.ateODia);
    const realizado = percentualDe(compras, fat);
    return {
      escopo,
      sectorId,
      nome,
      meta: meta ? { id: meta.id, alvoPercentual: meta.alvoPercentual, alertaPercentual: meta.alertaPercentual } : null,
      compras: arredondar(compras),
      pedidosAbertos: arredondar(abertos),
      realizadoPercentual: realizado,
      status: meta ? classificarMeta(realizado, meta.alvoPercentual, meta.alertaPercentual) : "SEM_DADOS",
      // Pedidos em aberto só entram na projeção do mês corrente: num mês passado já viraram nota ou foram esquecidos.
      projecao: meta && iv.mesCorrente
        ? projetarMes({ comprasAteHoje: compras, pedidosAbertos: abertos, faturamentoAteHoje: fat, diasDecorridos: iv.diasDecorridos, diasNoMes: iv.diasNoMes, alvoPercentual: meta.alvoPercentual })
        : null,
    };
  };

  const linhas: LinhaPainel[] = [montar("GERAL", null, "Geral", geral.total, pedidosTotal)];
  for (const setor of setores) {
    const compras = porSetor.get(setor.id) ?? 0;
    const abertos = pedidos.get(setor.id) ?? 0;
    // Setor só aparece se tem meta ou movimento: evita um painel cheio de linhas vazias.
    if (metaVigente(metas, "SETOR", setor.id, iv.ateODia) || compras > 0 || abertos > 0) linhas.push(montar("SETOR", setor.id, setor.name, compras, abertos));
  }

  return {
    mes: iv.inicioIso.slice(0, 7),
    hoje,
    ateODia: iv.ateODia,
    mesCorrente: iv.mesCorrente,
    faturamento: arredondar(fat),
    cmvRealCiclo: ciclo && ciclo.cmvPercentual != null ? { percentual: razaoParaPercentual(num(ciclo.cmvPercentual)), periodo: ciclo.name, status: ciclo.status } : null,
    linhas,
    historico: await historicoGeral(ano, mes, metas, hoje),
  };
}
