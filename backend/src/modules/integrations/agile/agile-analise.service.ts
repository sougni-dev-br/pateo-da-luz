import { ehRecebida, SITUACAO_CANCELADA, SITUACAO_RECEBIDA } from "./agile-situacao.js";
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

export async function obterVendasPorPessoa(periodo: Periodo) {
  const { de, ate } = intervaloDoPeriodo(periodo);
  // So venda RECEBIDA: item de venda cancelada nao e venda de ninguem.
  const linhas = await prisma.agileSaleItem.findMany({
    where: { movementDate: { gte: de, lt: ate }, saleStatus: SITUACAO_RECEBIDA },
    select: { saleId: true, launchedBy: true, productGroup: true, quantity: true, totalAmount: true }
  });
  const itens: ItemAnalise[] = linhas.map((l) => ({
    ...l,
    quantity: Number(l.quantity),
    totalAmount: Number(l.totalAmount)
  }));
  return montarVendasPorPessoa(itens, periodo);
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
