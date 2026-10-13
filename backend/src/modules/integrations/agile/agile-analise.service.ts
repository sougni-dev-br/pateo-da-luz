import { prisma } from "../../../config/database.js";
import {
  montarCancelamentos,
  montarVendasPorPessoa,
  type ItemAnalise,
  type Periodo,
  type VendaAnalise
} from "./agile-analise.report.js";

const UM_DIA_MS = 24 * 60 * 60 * 1000;

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
    where: { movementDate: { gte: de, lt: ate }, saleStatus: "RECEBIDA" },
    select: { saleId: true, launchedBy: true, productGroup: true, quantity: true, totalAmount: true }
  });
  const itens: ItemAnalise[] = linhas.map((l) => ({
    ...l,
    quantity: Number(l.quantity),
    totalAmount: Number(l.totalAmount)
  }));
  return montarVendasPorPessoa(itens, periodo);
}
