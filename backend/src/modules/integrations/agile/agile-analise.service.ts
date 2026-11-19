import type { Prisma } from "@prisma/client";
import { carregarCustosDeReferencia, custoDaFichaPelaReferencia, type CustoDeReferencia } from "../../inventory/custo-de-referencia.js";
import { ehRecebida, SITUACAO_CANCELADA, SITUACAO_RECEBIDA } from "./agile-situacao.js";
import { montarCardapio, type LinhaAttach, type LinhaProduto } from "./agile-analise-cardapio.report.js";
import { montarDemanda } from "./agile-analise-demanda.report.js";
import { CATEGORIAS_ALCOOL, CATEGORIAS_BEBIDA, CATEGORIA_SOBREMESA, PADRAO_GRUPO_SOBREMESA, PADRAO_NOME_BUFFET, PADRAO_NOME_CAFE } from "./agile-categorias.js";
import { descontarHoje, hojeEmSaoPaulo } from "./agile-analise-hoje.js";
import { montarPerdas } from "./agile-analise-perdas.report.js";
import { montarMargemBebidas, type VinculoDeBebida } from "./agile-analise-margem-bebidas.report.js";
import { montarMargemBuffet } from "./agile-analise-margem-buffet.report.js";
import { montarMargem, type ProdutoVendido } from "./agile-analise-margem.report.js";
import { custoDoVinculo, unidadeConverte } from "./agile-bebidas-custo.js";
import { DIAS_DA_JANELA_DE_RITMO, limitesDoMes, montarMetas, type IndicadorDeMeta, type MesDoHistorico } from "./agile-analise-metas.report.js";
import { montarResumo } from "./agile-analise-resumo.js";
import { calcularIndicadores, periodoAnteriorDe, type VendaVisao } from "./agile-analise-visao.report.js";
import { prisma } from "../../../config/database.js";
import { carregarPratosDoSalaoComCusto, MENU_DO_SALAO, UNIDADES_DE_PORCAO } from "../../dishes/dish-custo-salao.js";
import { conversoesDaFicha, separarItensPorCardapio } from "../../dishes/dish-detail.js";
import { MAX_NIVEIS_DE_FICHA, montarConsumoTeorico, type FichaDoPrato, type ItemDeFicha, type VinculoDeInsumo } from "./agile-analise-consumo.report.js";
import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";
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
    valor: n(l.valor)
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

// ---------------------------------------------------------------------------
// Metas mensais: o que foi definido e como o mes esta indo (ver agile-analise-metas.report.ts).
// ---------------------------------------------------------------------------

const MESES_DE_HISTORICO = 6;

export async function obterMetas(ano: number, mes: number, hoje: string = hojeEmSaoPaulo()) {
  const { inicio, fim } = limitesDoMes(ano, mes);
  const de = new Date(`${inicio}T00:00:00.000Z`);
  const ate = new Date(new Date(`${fim}T00:00:00.000Z`).getTime() + UM_DIA_MS);
  const hojeData = new Date(`${hoje}T00:00:00.000Z`);
  const deRitmo = new Date(hojeData.getTime() - DIAS_DA_JANELA_DE_RITMO * UM_DIA_MS);
  const deHistorico = new Date(Date.UTC(ano, mes - 1 - MESES_DE_HISTORICO, 1));
  // O historico so tem meses FECHADOS (o mes de hoje esta incompleto) e os itens cancelados, como as
  // vendas, so contam ate ontem: item de hoje com a venda de hoje de fora inflaria a perda.
  const inicioDoMesDeHoje = new Date(`${hoje.slice(0, 7)}-01T00:00:00.000Z`);
  const ateHistorico = inicioDoMesDeHoje < de ? inicioDoMesDeHoje : de;
  const ateItens = hojeData < ate ? hojeData : ate;
  const mesEncerrado = hoje > fim;

  const [vendasMes, vendasRitmo, vendasHistorico, itens, linhasMeta] = await Promise.all([
    carregarVendas(de, ate),
    // Mes encerrado projeta o proprio realizado: nao precisa do ritmo.
    mesEncerrado ? Promise.resolve<VendaVisao[]>([]) : carregarVendas(deRitmo, hojeData),
    carregarVendas(deHistorico, ateHistorico),
    valorDeItensCancelados(de, de, ateItens),
    prisma.agileSalaoMeta.findMany({ where: { ano, mes }, select: { indicador: true, valor: true } })
  ]);

  const porMes = new Map<string, VendaVisao[]>();
  for (const v of vendasHistorico) {
    const chave = toCalendarDateKey(v.movementDate).slice(0, 7);
    const doMes = porMes.get(chave);
    if (doMes) doMes.push(v);
    else porMes.set(chave, [v]);
  }
  const historico: MesDoHistorico[] = [...porMes.entries()].map(([chave, vendas]) => ({
    ano: Number(chave.slice(0, 4)),
    mes: Number(chave.slice(5, 7)),
    indicadores: calcularIndicadores(vendas, 0)
  }));

  const metas: Partial<Record<IndicadorDeMeta, number>> = {};
  for (const l of linhasMeta) metas[l.indicador as IndicadorDeMeta] = Number(l.valor);

  return montarMetas({ ano, mes, hoje, vendasMes, vendasRitmo, itensCanceladosMes: itens.atual, historico, metas });
}

// valor null apaga a meta do indicador no mes.
export async function salvarMeta(ano: number, mes: number, indicador: IndicadorDeMeta, valor: number | null, usuarioId: string | null) {
  if (valor === null) {
    await prisma.agileSalaoMeta.deleteMany({ where: { ano, mes, indicador } });
    return;
  }
  await prisma.agileSalaoMeta.upsert({
    where: { ano_mes_indicador: { ano, mes, indicador } },
    create: { ano, mes, indicador, valor, updatedById: usuarioId },
    update: { valor, updatedById: usuarioId }
  });
}

// ---------------------------------------------------------------------------
// Margem por prato: venda do PDV x custo da ficha do salao, pelo vinculo produto <-> prato.
// ---------------------------------------------------------------------------

async function produtosVendidosDoPeriodo(de: Date, ate: Date): Promise<ProdutoVendido[]> {
  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT MAX(i."productCode") AS codigo, MAX(i."productName") AS nome, MAX(i."productCategory") AS categoria,
           COALESCE(SUM(i.quantity), 0) AS quantidade, COALESCE(SUM(i."totalAmount"), 0) AS valor,
           COALESCE(SUM(i.quantity) FILTER (WHERE i."totalAmount" > 0), 0) AS quantidade_paga
    FROM "AgileSaleItem" i
    WHERE i."saleStatus" = ${SITUACAO_RECEBIDA} AND i."movementDate" >= ${de} AND i."movementDate" < ${ate}
    GROUP BY COALESCE(i."productCode", i."productName")`;
  return linhas.map((l) => ({
    codigo: (l.codigo as string | null) ?? null,
    nome: String(l.nome),
    categoria: (l.categoria as string | null) ?? null,
    quantidade: n(l.quantidade),
    valor: n(l.valor),
    quantidadePaga: l.quantidade_paga == null ? undefined : n(l.quantidade_paga)
  }));
}

export async function obterMargem(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const [produtos, pratos, vinculos] = await Promise.all([
    vazio ? Promise.resolve<ProdutoVendido[]>([]) : produtosVendidosDoPeriodo(de, ate),
    carregarPratosDoSalaoComCusto(prisma),
    prisma.agileProdutoPrato.findMany({ select: { productCode: true, dishId: true } })
  ]);
  return {
    ...montarMargem({ periodo, produtos, pratos, vinculos: vinculos.map((v) => ({ codigo: v.productCode, pratoId: v.dishId })) }),
    hojeFicouDeFora
  };
}

// pratoId null desfaz o vinculo do produto. O prato tem que ser do cardapio do salao e estar ativo.
export async function vincularProdutoAoPrato(codigo: string, nome: string, pratoId: string | null, usuarioId: string | null): Promise<"ok" | "prato-invalido"> {
  if (pratoId === null) {
    await prisma.agileProdutoPrato.deleteMany({ where: { productCode: codigo } });
    return "ok";
  }
  const prato = await prisma.dish.findFirst({
    where: { id: pratoId, isActive: true, fichaDeProducao: false, OR: [{ menu: "CARDAPIO" }, { alsoMenu: "CARDAPIO" }] },
    select: { id: true }
  });
  if (!prato) return "prato-invalido";
  await prisma.agileProdutoPrato.upsert({
    where: { productCode: codigo },
    create: { productCode: codigo, productName: nome, dishId: pratoId, updatedById: usuarioId },
    update: { productName: nome, dishId: pratoId, updatedById: usuarioId }
  });
  return "ok";
}

// ---------------------------------------------------------------------------
// Margem das bebidas (revenda): preco de venda do PDV x custo de COMPRA do insumo vinculado.
// ---------------------------------------------------------------------------

export const UNIDADES_DE_CONSUMO = ["UN", "ML", "L", "G", "KG"] as const;
const LIMITE_DE_INSUMOS = 3000;

const SELECAO_DO_INSUMO = {
  name: true,
  isActive: true,
  unit: true,
  stockUnit: true,
  inventoryStock: { select: { averageCost: true } },
  conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
} as const;

export async function obterMargemBebidas(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const [produtos, ligacoes, insumos] = await Promise.all([
    vazio ? Promise.resolve<ProdutoVendido[]>([]) : produtosVendidosDoPeriodo(de, ate),
    prisma.agileProdutoInsumo.findMany({ select: { productCode: true, insumoId: true, quantity: true, unit: true, insumo: { select: SELECAO_DO_INSUMO } } }),
    // So insumos com custo medio conhecido: sem custo nao ha margem a calcular.
    prisma.product.findMany({
      where: { isActive: true, inventoryStock: { averageCost: { gt: 0 } } },
      select: { id: true, name: true, unit: true, stockUnit: true },
      orderBy: { name: "asc" },
      take: LIMITE_DE_INSUMOS + 1
    })
  ]);
  const insumosTruncados = insumos.length > LIMITE_DE_INSUMOS;

  const bebidas = produtos.filter((p) => (CATEGORIAS_BEBIDA as readonly string[]).includes(p.categoria ?? ""));
  const referencia = custoDaFichaPelaReferencia() ? await carregarCustosDeReferencia(ligacoes.map((l) => l.insumoId)) : new Map<string, CustoDeReferencia>();
  const vinculos: VinculoDeBebida[] = ligacoes.map((l) => {
    const quantidade = Number(l.quantity);
    const custo = custoDoVinculo(
      {
        name: l.insumo.name,
        unit: l.insumo.unit,
        stockUnit: l.insumo.stockUnit,
        averageCost: referencia.get(l.insumoId)?.valor ?? (l.insumo.inventoryStock?.averageCost == null ? null : Number(l.insumo.inventoryStock.averageCost)),
        conversions: l.insumo.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }))
      },
      quantidade,
      l.unit
    );
    // Insumo desativado depois do vínculo: o custo médio que sobrou no estoque não é confiável.
    if (!l.insumo.isActive) {
      return { codigo: l.productCode, insumoId: l.insumoId, insumo: l.insumo.name, quantidade, unidade: l.unit, custoPorVenda: null, custoCompleto: false, problema: "O insumo foi desativado no estoque." };
    }
    return { codigo: l.productCode, insumoId: l.insumoId, insumo: l.insumo.name, quantidade, unidade: l.unit, ...custo };
  });
  return {
    ...montarMargemBebidas({
      periodo,
      bebidas,
      vinculos,
      insumos: insumos.slice(0, LIMITE_DE_INSUMOS).map((i) => ({ id: i.id, nome: i.name, unidade: i.stockUnit || i.unit || "UN" }))
    }),
    insumosTruncados,
    hojeFicouDeFora
  };
}

// insumoId null desfaz o vinculo da bebida. O insumo tem que existir, estar ativo e ter custo medio.
export async function vincularBebidaAoInsumo(
  codigo: string, nome: string, insumoId: string | null, quantidade: number, unidade: string, usuarioId: string | null
): Promise<"ok" | "insumo-invalido" | "unidade-invalida"> {
  if (insumoId === null) {
    await prisma.agileProdutoInsumo.deleteMany({ where: { productCode: codigo } });
    return "ok";
  }
  const insumo = await prisma.product.findFirst({
    where: { id: insumoId, isActive: true, inventoryStock: { averageCost: { gt: 0 } } },
    select: { name: true, unit: true, stockUnit: true, conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } } }
  });
  if (!insumo) return "insumo-invalido";
  const conversions = insumo.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }));
  if (!unidadeConverte({ name: insumo.name, unit: insumo.unit, stockUnit: insumo.stockUnit, conversions }, unidade)) return "unidade-invalida";
  await prisma.agileProdutoInsumo.upsert({
    where: { productCode: codigo },
    create: { productCode: codigo, productName: nome, insumoId, quantity: quantidade, unit: unidade, updatedById: usuarioId },
    update: { productName: nome, insumoId, quantity: quantidade, unit: unidade, updatedById: usuarioId }
  });
  return "ok";
}

// ---------------------------------------------------------------------------
// Margem do buffet por pessoa: receita e pessoas do PDV x custo de comida por pessoa informado por mes.
// ---------------------------------------------------------------------------

const MESES_DE_HISTORICO_DE_CUSTO = 12;

function mesesDoPeriodo({ inicio, fim }: Periodo): Array<{ ano: number; mes: number }> {
  const out: Array<{ ano: number; mes: number }> = [];
  let ano = Number(inicio.slice(0, 4));
  let mes = Number(inicio.slice(5, 7));
  const anoFim = Number(fim.slice(0, 4));
  const mesFim = Number(fim.slice(5, 7));
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    out.push({ ano, mes });
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return out;
}

export async function obterMargemBuffet(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const meses = mesesDoPeriodo(periodo);

  const [faixas, porMes, total, custos, historico] = await Promise.all([
    vazio ? Promise.resolve<LinhaBruta[]>([]) : prisma.$queryRaw<LinhaBruta[]>`
      WITH b AS (
        SELECT i."saleId" AS venda, i."productName" AS produto, SUM(i."totalAmount") AS valor
        FROM "AgileSaleItem" i
        WHERE i."saleStatus" = ${SITUACAO_RECEBIDA} AND i."movementDate" >= ${de} AND i."movementDate" < ${ate}
          AND i."productName" ~* ${PADRAO_NOME_BUFFET}
        GROUP BY i."saleId", i."productName")
      -- Comanda com mais de um produto buffet: as pessoas dela são rateadas entre os produtos (pela receita; partes iguais se
      -- nenhum cobrou), para que a soma das faixas feche com o total e a pessoa não seja contada em cada faixa.
      , r AS (
        SELECT b.produto, b.valor, s.people,
               s.people * COALESCE(b.valor / NULLIF(SUM(b.valor) OVER (PARTITION BY b.venda), 0), 1.0 / COUNT(*) OVER (PARTITION BY b.venda)) AS rateio
        FROM b JOIN "AgileSale" s ON s."saleId" = b.venda AND s."saleStatus" = ${SITUACAO_RECEBIDA})
      SELECT produto, COUNT(*)::int AS comandas, COALESCE(ROUND(SUM(rateio)), 0)::int AS pessoas, SUM(valor) AS receita,
             COALESCE(SUM(valor) FILTER (WHERE people > 0), 0) AS receita_com_pessoas
      FROM r GROUP BY produto`,
    vazio ? Promise.resolve<LinhaBruta[]>([]) : prisma.$queryRaw<LinhaBruta[]>`
      WITH b AS (
        SELECT i."saleId" AS venda, SUM(i."totalAmount") AS valor
        FROM "AgileSaleItem" i
        WHERE i."saleStatus" = ${SITUACAO_RECEBIDA} AND i."movementDate" >= ${de} AND i."movementDate" < ${ate}
          AND i."productName" ~* ${PADRAO_NOME_BUFFET}
        GROUP BY i."saleId")
      SELECT EXTRACT(YEAR FROM s."movementDate")::int AS ano, EXTRACT(MONTH FROM s."movementDate")::int AS mes,
             COUNT(*)::int AS comandas, COALESCE(SUM(s.people), 0)::int AS pessoas, SUM(b.valor) AS receita,
             COALESCE(SUM(b.valor) FILTER (WHERE s.people > 0), 0) AS receita_com_pessoas
      FROM b JOIN "AgileSale" s ON s."saleId" = b.venda AND s."saleStatus" = ${SITUACAO_RECEBIDA}
      GROUP BY 1, 2`,
    vazio ? Promise.resolve({ _sum: { totalAmount: null } }) : prisma.agileSaleItem.aggregate({
      _sum: { totalAmount: true },
      where: { saleStatus: SITUACAO_RECEBIDA, movementDate: { gte: de, lt: ate } }
    }),
    prisma.agileBuffetCusto.findMany({ where: { OR: meses.map(({ ano, mes }) => ({ ano, mes })) }, select: { ano: true, mes: true, valor: true } }),
    prisma.agileBuffetCusto.findMany({ orderBy: [{ ano: "desc" }, { mes: "desc" }], take: MESES_DE_HISTORICO_DE_CUSTO, select: { ano: true, mes: true, valor: true } })
  ]);

  const numero = (v: unknown) => (v == null ? 0 : Number(v));
  return {
    ...montarMargemBuffet({
      periodo,
      faixas: faixas.map((l) => ({ produto: String(l.produto), comandas: numero(l.comandas), pessoas: numero(l.pessoas), receita: numero(l.receita), receitaComPessoas: numero(l.receita_com_pessoas) })),
      meses: porMes.map((l) => ({ ano: numero(l.ano), mes: numero(l.mes), comandas: numero(l.comandas), pessoas: numero(l.pessoas), receita: numero(l.receita), receitaComPessoas: numero(l.receita_com_pessoas) })),
      custos: custos.map((c) => ({ ano: c.ano, mes: c.mes, valor: Number(c.valor) })),
      historicoDeCustos: historico.map((c) => ({ ano: c.ano, mes: c.mes, valor: Number(c.valor) })),
      receitaTotalDoSalao: numero(total._sum.totalAmount)
    }),
    hojeFicouDeFora
  };
}

// valor null apaga o custo do mes.
export async function salvarCustoBuffet(ano: number, mes: number, valor: number | null, usuarioId: string | null) {
  if (valor === null) {
    await prisma.agileBuffetCusto.deleteMany({ where: { ano, mes } });
    return;
  }
  await prisma.agileBuffetCusto.upsert({
    where: { ano_mes: { ano, mes } },
    create: { ano, mes, valor, updatedById: usuarioId },
    update: { valor, updatedById: usuarioId }
  });
}

// ---------------------------------------------------------------------------
// Consumo teorico de insumos: venda do PDV x ficha do salao (pratos) e vinculo de revenda (bebidas).
// Referencia para a contagem; nao grava movimento de estoque.
// ---------------------------------------------------------------------------

const SELECAO_DO_ITEM_DE_FICHA = {
  menu: true,
  productId: true,
  componentDishId: true,
  quantity: true,
  unit: true,
  wasteFactor: true,
  product: { select: { name: true, unit: true, stockUnit: true, conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } } } }
} as const;

type ItemCarregado = Prisma.DishItemGetPayload<{ select: typeof SELECAO_DO_ITEM_DE_FICHA }>;

function itemDaFicha(item: ItemCarregado): ItemDeFicha | null {
  const quantidade = Number(item.quantity);
  const perda = Number(item.wasteFactor);
  if (item.componentDishId) return { componenteId: item.componentDishId, quantidade, unidade: item.unit, perda };
  if (!item.product || !item.productId) return null;
  return {
    insumoId: item.productId,
    insumo: item.product.name,
    quantidade,
    unidade: item.unit,
    perda,
    unidadeEstoque: item.product.stockUnit || item.product.unit,
    conversoes: conversoesDaFicha({ ...item.product, ehFicha: false })
  };
}

// Pratos vendidos no salao e, nivel a nivel, as fichas de producao que eles usam como ingrediente (a massa do nhoque).
// Mesma regra do custo: ficha de producao vale pelos itens do cardapio dela (dish-fichas-de-producao).
async function carregarFichasDoSalao(): Promise<FichaDoPrato[]> {
  const vendidos = await prisma.dish.findMany({
    where: { isActive: true, fichaDeProducao: false, OR: [{ menu: MENU_DO_SALAO }, { alsoMenu: MENU_DO_SALAO }] },
    select: { id: true, name: true, yieldQty: true, yieldUnit: true, items: { where: { menu: MENU_DO_SALAO }, select: SELECAO_DO_ITEM_DE_FICHA } }
  });
  const fichas: FichaDoPrato[] = vendidos.map((prato) => ({
    id: prato.id,
    nome: prato.name,
    rendimento: Number(prato.yieldQty),
    unidadeRendimento: prato.yieldUnit,
    rendimentoEmPorcao: UNIDADES_DE_PORCAO.has(String(prato.yieldUnit ?? "").trim().toUpperCase()),
    itens: prato.items.map(itemDaFicha).filter((i): i is ItemDeFicha => i !== null)
  }));

  const carregadas = new Set(fichas.map((f) => f.id));
  let fronteira = [...new Set(vendidos.flatMap((p) => p.items.map((i) => i.componentDishId)).filter((id): id is string => Boolean(id)))];
  for (let nivel = 0; nivel < MAX_NIVEIS_DE_FICHA + 1 && fronteira.length > 0; nivel++) {
    const novas = fronteira.filter((id) => !carregadas.has(id));
    if (novas.length === 0) break;
    const producao = await prisma.dish.findMany({
      where: { id: { in: novas } },
      select: { id: true, name: true, menu: true, yieldQty: true, yieldUnit: true, items: { select: SELECAO_DO_ITEM_DE_FICHA } }
    });
    for (const ficha of producao) {
      carregadas.add(ficha.id);
      fichas.push({
        id: ficha.id,
        nome: ficha.name,
        rendimento: Number(ficha.yieldQty),
        unidadeRendimento: ficha.yieldUnit,
        rendimentoEmPorcao: false,
        itens: separarItensPorCardapio({ menu: ficha.menu, alsoMenu: null, items: ficha.items }).principais
          .map(itemDaFicha)
          .filter((i): i is ItemDeFicha => i !== null)
      });
    }
    fronteira = [...new Set(producao.flatMap((f) => f.items.map((i) => i.componentDishId)).filter((id): id is string => Boolean(id)))];
  }
  return fichas;
}

export async function obterConsumo(pedido: Periodo, hoje: string = hojeEmSaoPaulo()) {
  const { periodo, hojeFicouDeFora, vazio } = descontarHoje(pedido, hoje);
  const { de, ate } = intervaloDoPeriodo(periodo);
  const [vendas, fichas, vinculosPrato, ligacoes] = await Promise.all([
    vazio ? Promise.resolve<ProdutoVendido[]>([]) : produtosVendidosDoPeriodo(de, ate),
    carregarFichasDoSalao(),
    prisma.agileProdutoPrato.findMany({ select: { productCode: true, dishId: true } }),
    prisma.agileProdutoInsumo.findMany({
      select: { productCode: true, insumoId: true, quantity: true, unit: true, insumo: { select: { name: true, isActive: true, unit: true, stockUnit: true, conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } } } } }
    })
  ]);
  const vinculosInsumo: VinculoDeInsumo[] = ligacoes
    // Insumo desativado depois do vinculo: o consumo dele nao e confiavel, e a venda cai em "sem vinculo".
    .filter((l) => l.insumo.isActive)
    .map((l) => ({
      codigo: l.productCode,
      insumoId: l.insumoId,
      insumo: l.insumo.name,
      quantidade: Number(l.quantity),
      unidade: l.unit,
      unidadeEstoque: l.insumo.stockUnit || l.insumo.unit,
      conversoes: conversoesDaFicha(l.insumo)
    }));
  return {
    ...montarConsumoTeorico({
      periodo,
      vendas: vendas.map((v) => ({ codigo: v.codigo, nome: v.nome, categoria: v.categoria, quantidade: v.quantidade, valor: v.valor })),
      fichas,
      vinculosPrato: vinculosPrato.map((v) => ({ codigo: v.productCode, pratoId: v.dishId })),
      vinculosInsumo
    }),
    hojeFicouDeFora
  };
}
