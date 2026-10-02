// Rescisão de sem registro lançada DEPOIS do acerto da lista de pagamento (SALARIO com
// details.origem = "LISTA_PAGAMENTO") da competência da saída:
// - acerto ainda não pago: recusa (409). O salário sairia duas vezes — no acerto e na
//   rescisão. Exclua o acerto antes (a decisão fica com quem cuida do Contas a Pagar;
//   excluir por aqui, em silêncio, apagaria um título que alguém pode estar pagando).
// - acerto já pago: o salário (e a gorjeta da lista) já saíram. A apuração desconta
//   (vira "já pago na lista") e o lançamento exige justificativa, com aviso.
import type { Prisma } from "@prisma/client";
import { ORIGEM_ACERTO, competenciaTexto } from "./acerto-lista.js";
import { diaIso } from "./folha-duplicidade.js";
import { round2 } from "./vt-calc.js";

export type AcertoNaSaida = { id: string; valor: number; pago: boolean; valorPago: number; pagoEm: string | null; competencia: string };

type LinhaSalario = { id: string; amount: unknown; paidAmount: unknown; paymentDate: Date | null; status: string; details: unknown };

const daLista = (details: unknown) =>
  Boolean(details && typeof details === "object" && (details as Record<string, unknown>).origem === ORIGEM_ACERTO);

export function acertosDaLista(linhas: LinhaSalario[], competencia: string): AcertoNaSaida[] {
  return linhas.filter((l) => daLista(l.details) && l.status !== "CANCELED").map((l) => {
    const pago = l.paymentDate != null || l.status === "PAID";
    return {
      id: l.id, valor: round2(Number(l.amount)), pago,
      valorPago: pago ? round2(Number(l.paidAmount ?? l.amount)) : 0,
      pagoEm: l.paymentDate ? diaIso(l.paymentDate) : null, competencia,
    };
  });
}

// SALARIO vivo da competência (mês do calendário) da saída que veio do acerto da lista.
export async function acertosDaListaNaSaida(
  db: Pick<Prisma.TransactionClient, "payrollItem">, employeeId: string, saida: Date,
): Promise<AcertoNaSaida[]> {
  const ano = saida.getUTCFullYear();
  const mes = saida.getUTCMonth() + 1;
  const linhas = await db.payrollItem.findMany({
    where: { employeeId, type: "SALARIO", competenceYear: ano, competenceMonth: mes, deletedAt: null, status: { not: "CANCELED" } },
    select: { id: true, amount: true, paidAmount: true, paymentDate: true, status: true, details: true },
  });
  return acertosDaLista(linhas ?? [], competenciaTexto(ano, mes));
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string | null) => (iso ?? "").split("-").reverse().join("/");

export type DecisaoAcertoNaRescisao =
  | { ok: true; acertoPago: AcertoNaSaida | null; aviso: string | null }
  | { ok: false; status: number; message: string };

export function decidirAcertoNaRescisao(acertos: AcertoNaSaida[], justificativa: string, minimo: number): DecisaoAcertoNaRescisao {
  const aberto = acertos.find((a) => !a.pago);
  if (aberto) {
    return {
      ok: false, status: 409,
      message: `Já existe o acerto da lista de pagamento de ${aberto.competencia} (${brl(aberto.valor)}) sem baixa. ` +
        "Exclua o acerto na Folha antes de lançar a rescisão — senão o salário sai duas vezes.",
    };
  }
  const pago = acertos.find((a) => a.pago) ?? null;
  if (!pago) return { ok: true, acertoPago: null, aviso: null };
  const aviso = `O salário de ${pago.competencia} já foi pago no acerto da lista de pagamento (${brl(pago.valorPago)}` +
    `${pago.pagoEm ? ` em ${dataBr(pago.pagoEm)}` : ""}). A rescisão não deve pagá-lo de novo.`;
  if (justificativa.length < minimo) {
    return { ok: false, status: 400, message: `${aviso} Explique o lançamento (pelo menos ${minimo} letras).` };
  }
  return { ok: true, acertoPago: pago, aviso };
}
