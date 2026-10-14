import { ehRecebida, SITUACAO_CANCELADA, SITUACAO_RECEBIDA } from "./agile-situacao.js";
import { montarCardapio, type LinhaAttach, type LinhaProduto } from "./agile-analise-cardapio.report.js";
import { montarDemanda } from "./agile-analise-demanda.report.js";
import { CATEGORIAS_ALCOOL, CATEGORIAS_BEBIDA, CATEGORIA_SOBREMESA, PADRAO_GRUPO_SOBREMESA, PADRAO_NOME_CAFE } from "./agile-categorias.js";
import { descontarHoje, hojeEmSaoPaulo } from "./agile-analise-hoje.js";
import { montarPerdas } from "./agile-analise-perdas.report.js";
import { montarResumo } from "./agile-analise-resumo.js";
import { periodoAnteriorDe, type VendaVisao } from "./agile-analise-visao.report.js";
import { prisma } from "../../../config/database.js";
import {
  montarCancelamentos,
  montarDescontos,
  montarItensCancelados,
  montarVendasPorPessoa,
  type ItemAnalise,
  type ItemCanceladoAnalise,
  type Periodo,
  type VendaAnalise,
  type VendaDescontoAnalise
} from "./agile-analise.report.js";

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const LOTE_VENDAS = 2000;

// "Do dia inicial ate o fim do dia final", como intervalo [de, ate). As linhas sao
// gravadas as 12:00 UTC, mas o intervalo nao pode depender disso: igualdade de
// horario ja fez uma busca ficar cega neste modulo.
function intervaloDoPeriodo({ inicio, fim }: Periodo) {
  const de = new Date(`${inicio}T00:00:00.000Z`);
  const ate = new Date(new Date(`${fim}T00:00:00.000Z`).getTime() + UM_DIA_MS);
  return { de, ate };
}

export async function obterCancelamentos(periodo: Periodo) {
  const { de, ate } = intervaloDoPeriodo(periodo);
  const linhas = await prisma.agileSale.findMany({
    where: { movementDate: { gte: de, lt: ate } },
    select: {
      saleId: true, movementDate: true, shift: true, saleStatus: true, saleHour: true,
      people: true, totalAmount: true, cancelledBy: true, cancelReason: true
    }
  });
  const vendas: VendaAnalise[] = linhas.map((l) => ({ ...l, totalAmount: Number(l.totalAmount) }));
  return montarCancelamentos(vendas, periodo);
}

export async function obterVendasPorPessoa(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  // So venda RECEBIDA: item de venda cancelada nao e venda de ninguem.
  const linhas = vazio
    ? []
    : await prisma.agileSaleItem.findMany({
        where: { movementDate: { gte: de, lt: ate }, saleStatus: SITUACAO_RECEBIDA },
        select: { saleId: true, launchedBy: true, productGroup: true, quantity: true, totalAmount: true }
      });
  const itens: ItemAnalise[] = linhas.map((l) => ({
    ...l,
    quantity: Number(l.quantity),
    totalAmount: Number(l.totalAmount)
  }));
  return { ...montarVendasPorPessoa(itens, periodo), hojeFicouDeFora };
}

// Itens cancelados DENTRO de venda paga. O item guarda o status proprio (saleStatus), mas
// nao a situacao da venda: por isso cruza com AgileSale. Item de venda inteira cancelada
// ja aparece em "Cancelamentos" (contaria duas vezes) e item cuja venda nao foi gravada
// fica de fora, em vez de entrar com hora inventada.
export async function obterItensCancelados(periodo: Periodo) {
  const { de, ate } = intervaloDoPeriodo(periodo);
  const [canceladas, recebidos] = await Promise.all([
    prisma.agileSaleItem.findMany({
      where: { movementDate: { gte: de, lt: ate }, saleStatus: SITUACAO_CANCELADA },
      select: {
        saleId: true, movementDate: true, productName: true, productGroup: true, quantity: true,
        totalAmount: true, launchedBy: true, cancelledBy: true, cancelReason: true
      }
    }),
    prisma.agileSaleItem.aggregate({
      where: { movementDate: { gte: de, lt: ate }, saleStatus: SITUACAO_RECEBIDA },
      _sum: { totalAmount: true }
    })
  ]);

  const valorItensRecebidos = Number(recebidos._sum.totalAmount ?? 0);
  if (canceladas.length === 0) return montarItensCancelados([], valorItensRecebidos, periodo);

  const ids = [...new Set(canceladas.map((i) => i.saleId))];
  const horaDaVenda = new Map<string, string | null>();
  const vendasGravadas = new Set<string>();
  for (let i = 0; i < ids.length; i += LOTE_VENDAS) {
    const vendas = await prisma.agileSale.findMany({
      where: { saleId: { in: ids.slice(i, i + LOTE_VENDAS) } },
      select: { saleId: true, saleStatus: true, saleHour: true }
    });
    for (const v of vendas) {
      vendasGravadas.add(v.saleId);
      if (ehRecebida(v.saleStatus)) horaDaVenda.set(v.saleId, v.saleHour);
    }
  }

  const itens: ItemCanceladoAnalise[] = canceladas
    .filter((i) => horaDaVenda.has(i.saleId))
    .map((i) => ({
      ...i,
      saleHour: horaDaVenda.get(i.saleId) ?? null,
      quantity: Number(i.quantity),
      totalAmount: Number(i.totalAmount)
    }));
  // Item de venda inteira cancelada e outro relatorio; so o item cuja venda NAO foi gravada
  // e que fica de fora sem explicacao, e por isso e contado e avisado na tela.
  const itensSemVenda = canceladas.filter((i) => !vendasGravadas.has(i.saleId)).length;
  return montarItensCancelados(itens, valorItensRecebidos, periodo, itensSemVenda);
}

// Descontos das vendas PAGAS. Decimal null (linha anterior ao agente novo) segue como null
// ate o relatorio: converter para 0 aqui apagaria a diferenca entre "sem desconto" e "sem dado".
export async function obterDescontos(periodo: Periodo) {
  const { de, ate } = intervaloDoPeriodo(periodo);
  const linhas = await prisma.agileSale.findMany({
    where: { movementDate: { gte: de, lt: ate }, saleStatus: SITUACAO_RECEBIDA },
    select: {
      saleId: true, movementDate: true, shift: true, saleHour: true, people: true, totalAmount: true,
      subtotalAmount: true, discountAmount: true, discountLabel: true, cancelledBy: true
    }
  });
  const vendas: VendaDescontoAnalise[] = linhas.map((l) => ({
    saleId: l.saleId,
    movementDate: l.movementDate,
    shift: l.shift,
    saleHour: l.saleHour,
    people: l.people,
    totalAmount: Number(l.totalAmount),
    subtotalAmount: l.subtotalAmount === null ? null : Number(l.subtotalAmount),
    discountAmount: l.discountAmount === null ? null : Number(l.discountAmount),
    discountLabel: l.discountLabel,
    registeredBy: l.cancelledBy
  }));
  return montarDescontos(vendas, periodo);
}

// ---------------------------------------------------------------------------
// Visao de decisao: resumo, demanda e perdas. Uma unica leitura de AgileSale por relatorio.
// ---------------------------------------------------------------------------

const CAMPOS_VENDA = {
  saleId: true, movementDate: true, shift: true, saleStatus: true, saleHour: true, people: true, totalAmount: true,
  subtotalAmount: true, discountAmount: true, discountLabel: true, cancelledBy: true, cancelReason: true
} as const;

async function carregarVendas(de: Date, ate: Date): Promise<VendaVisao[]> {
  const linhas = await prisma.agileSale.findMany({ where: { movementDate: { gte: de, lt: ate } }, select: CAMPOS_VENDA });
  return linhas.map((l) => ({
    ...l,
    totalAmount: Number(l.totalAmount),
    // Decimal null (linha anterior ao agente novo) segue como null: "sem dado" nao e zero.
    subtotalAmount: l.subtotalAmount === null ? null : Number(l.subtotalAmount),
    discountAmount: l.discountAmount === null ? null : Number(l.discountAmount)
  }));
}

// Valor dos itens cancelados DENTRO de venda paga, nas duas janelas de uma vez. O item de venda
// inteira cancelada ja esta no cancelamento da venda (contaria duas vezes).
async function valorDeItensCancelados(deAnterior: Date, de: Date, ate: Date) {
  const linhas = await prisma.$queryRaw<Array<{ atual: boolean; valor: unknown }>>`
    SELECT (i."movementDate" >= ${de}) AS atual, COALESCE(SUM(i."totalAmount"), 0) AS valor
    FROM "AgileSaleItem" i
    JOIN "AgileSale" s ON s."saleId" = i."saleId" AND s."saleStatus" = ${SITUACAO_RECEBIDA}
    WHERE i."saleStatus" = ${SITUACAO_CANCELADA} AND i."movementDate" >= ${deAnterior} AND i."movementDate" < ${ate}
    GROUP BY 1`;
  const soma = (atual: boolean) => linhas.filter((l) => l.atual === atual).reduce((t, l) => t + Number(l.valor), 0);
  return { atual: soma(true), anterior: soma(false) };
}

// O dia em andamento fica de fora (ver agile-analise-hoje.ts). `hoje` e injetavel so para teste.
export async function obterResumo(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const { de: deAnterior } = intervaloDoPeriodo(periodoAnteriorDe(periodo));
  const [vendas, itens] = vazio
    ? [[], { atual: 0, anterior: 0 }]
    : await Promise.all([carregarVendas(deAnterior, ate), valorDeItensCancelados(deAnterior, de, ate)]);
  return {
    ...montarResumo({
      periodo,
      vendasAtual: vendas.filter((v) => v.movementDate >= de),
      vendasAnterior: vendas.filter((v) => v.movementDate < de),
      itensCanceladosAtual: itens.atual,
      itensCanceladosAnterior: itens.anterior
    }),
    hojeFicouDeFora
  };
}

export async function obterDemanda(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  return { ...montarDemanda(vazio ? [] : await carregarVendas(de, ate), periodo), hojeFicouDeFora };
}

export async function obterPerdas(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const [vendas, itens] = vazio
    ? [[], montarItensCancelados([], 0, periodo)]
    : await Promise.all([carregarVendas(de, ate), obterItensCancelados(periodo)]);
  return {
    ...montarPerdas({
      periodo,
      vendas,
      cancelamentos: montarCancelamentos(vendas, periodo),
      itens,
      descontos: montarDescontos(
        vendas.filter((v) => ehRecebida(v.saleStatus)).map((v) => ({
          saleId: v.saleId,
          movementDate: v.movementDate,
          shift: v.shift,
          saleHour: v.saleHour,
          people: v.people,
          totalAmount: v.totalAmount,
          subtotalAmount: v.subtotalAmount,
          discountAmount: v.discountAmount,
          discountLabel: v.discountLabel ?? null,
          registeredBy: v.cancelledBy
        })),
        periodo
      )
    }),
    hojeFicouDeFora
  };
}

// ---------------------------------------------------------------------------
// Cardapio: agregados no banco (um produto por linha; uma linha por turno), nao milhares de itens.
// ---------------------------------------------------------------------------

type LinhaBruta = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

async function produtosPorJanela(deAnterior: Date, de: Date, ate: Date): Promise<LinhaProduto[]> {
  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT (i."movementDate" >= ${de}) AS atual, i."productName" AS produto, i."productGroup" AS grupo, i."productCategory" AS categoria,
           COALESCE(SUM(i.quantity), 0) AS quantidade, COALESCE(SUM(i."totalAmount"), 0) AS valor
    FROM "AgileSaleItem" i
    WHERE i."saleStatus" = ${SITUACAO_RECEBIDA} AND i."movementDate" >= ${deAnterior} AND i."movementDate" < ${ate}
    GROUP BY 1, 2, 3, 4`;
  return linhas.map((l) => ({
    janela: l.atual ? ("atual" as const) : ("anterior" as const),
    produto: String(l.produto),
    grupo: (l.grupo as string | null) ?? null,
    categoria: (l.categoria as string | null) ?? null,
    quantidade: n(l.quantidade),
    valor: n(l.valor),
    comandas: n(l.comandas)
  }));
}

// Por comanda RECEBIDA com pessoas informadas: quantas levaram bebida, alcool, cafe e sobremesa, e
// quanto cada um rendeu. O denominador (comandas e pessoas) vem da VENDA, nunca do item: juntar
// item com venda e somar pessoas depois duplicaria as pessoas de toda comanda com varios itens.
async function attachPorJanela(deAnterior: Date, de: Date, ate: Date): Promise<LinhaAttach[]> {
  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    WITH v AS (
      SELECT "saleId", TRIM(shift) AS turno, people, ("movementDate" >= ${de}) AS atual
      FROM "AgileSale"
      WHERE "saleStatus" = ${SITUACAO_RECEBIDA} AND people > 0 AND "movementDate" >= ${deAnterior} AND "movementDate" < ${ate}
    ),
    i AS (
      SELECT "saleId",
        SUM(quantity) FILTER (WHERE "productCategory" = ANY(${[...CATEGORIAS_BEBIDA]})) AS qtd_beb,
        SUM("totalAmount") FILTER (WHERE "productCategory" = ANY(${[...CATEGORIAS_BEBIDA]})) AS val_beb,
        SUM(quantity) FILTER (WHERE "productCategory" = ANY(${[...CATEGORIAS_ALCOOL]})) AS qtd_alc,
        SUM("totalAmount") FILTER (WHERE "productCategory" = ANY(${[...CATEGORIAS_ALCOOL]})) AS val_alc,
        SUM(quantity) FILTER (WHERE "productName" ~* ${PADRAO_NOME_CAFE}) AS qtd_cafe,
        SUM("totalAmount") FILTER (WHERE "productName" ~* ${PADRAO_NOME_CAFE}) AS val_cafe,
        SUM(quantity) FILTER (WHERE "productCategory" = ${CATEGORIA_SOBREMESA} OR "productGroup" ~* ${PADRAO_GRUPO_SOBREMESA}) AS qtd_sob,
        SUM("totalAmount") FILTER (WHERE "productCategory" = ${CATEGORIA_SOBREMESA} OR "productGroup" ~* ${PADRAO_GRUPO_SOBREMESA}) AS val_sob
      FROM "AgileSaleItem"
      WHERE "saleStatus" = ${SITUACAO_RECEBIDA} AND "movementDate" >= ${deAnterior} AND "movementDate" < ${ate}
      GROUP BY 1
    )
    SELECT v.atual, v.turno, COUNT(*) AS comandas, SUM(v.people) AS pessoas,
      COUNT(*) FILTER (WHERE COALESCE(i.qtd_beb, 0) > 0) AS com_beb, COUNT(*) FILTER (WHERE COALESCE(i.qtd_alc, 0) > 0) AS com_alc,
      COUNT(*) FILTER (WHERE COALESCE(i.qtd_cafe, 0) > 0) AS com_cafe, COUNT(*) FILTER (WHERE COALESCE(i.qtd_sob, 0) > 0) AS com_sob,
      COALESCE(SUM(i.qtd_beb), 0) AS qtd_beb, COALESCE(SUM(i.val_beb), 0) AS val_beb, COALESCE(SUM(i.qtd_alc), 0) AS qtd_alc, COALESCE(SUM(i.val_alc), 0) AS val_alc,
      COALESCE(SUM(i.qtd_cafe), 0) AS qtd_cafe, COALESCE(SUM(i.val_cafe), 0) AS val_cafe, COALESCE(SUM(i.qtd_sob), 0) AS qtd_sob, COALESCE(SUM(i.val_sob), 0) AS val_sob
    FROM v LEFT JOIN i USING ("saleId")
    GROUP BY 1, 2`;
  return linhas.map((l) => ({
    janela: l.atual ? ("atual" as const) : ("anterior" as const),
    turno: String(l.turno),
    comandas: n(l.comandas),
    pessoas: n(l.pessoas),
    comBebida: n(l.com_beb),
    comAlcool: n(l.com_alc),
    comCafe: n(l.com_cafe),
    comSobremesa: n(l.com_sob),
    qtdBebida: n(l.qtd_beb),
    valBebida: n(l.val_beb),
    qtdAlcool: n(l.qtd_alc),
    valAlcool: n(l.val_alc),
    qtdCafe: n(l.qtd_cafe),
    valCafe: n(l.val_cafe),
    qtdSobremesa: n(l.qtd_sob),
    valSobremesa: n(l.val_sob)
  }));
}

export async function obterCardapio(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const { de: deAnterior } = intervaloDoPeriodo(periodoAnteriorDe(periodo));
  const [produtos, attach] = vazio
    ? [[], []]
    : await Promise.all([produtosPorJanela(deAnterior, de, ate), attachPorJanela(deAnterior, de, ate)]);
  return { ...montarCardapio({ periodo, produtos, attach }), hojeFicouDeFora };
}
