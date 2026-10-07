// Recibo de pagamento de quem não tem registro — regras puras. As rotas (recibo-pagamento.routes.ts)
// leem a apuração e o Contas a Pagar e devolvem isto para a tela imprimir.
//
// Três recibos:
//   - pagamento do mês: o acerto da lista de pagamento, discriminado como a lista calcula
//     (dias trabalhados − adiantamento − 1ª quinzena + gorjeta − vales + créditos + hora extra
//     + noturno + DSR). O total é o A pagar da lista; se o acerto no Contas a Pagar tiver outro
//     valor, vale o do acerto e a diferença aparece como ajuste (nunca escondida);
//   - 1ª quinzena (dia 15) e adiantamento (dia 20): o título ADIANTAMENTO do sem registro.
// O impresso não leva empresa nem a palavra "salário": só a pessoa, os valores e a referência.
import type { ParticipanteDaLista } from "./acerto-lista.js";
import { competenciaTexto, recebeAcerto } from "./acerto-lista.js";
import { round2 } from "./vt-calc.js";

// vale: linha de um vale ou crédito da gorjeta (a impressão junta numa linha só se não couber).
export type LinhaRecibo = { descricao: string; detalhe: string | null; valor: number; vale?: true };

export type ValeDoRecibo = { type: string; amount: number; date: string | null; notes: string | null };

export type ParticipanteDoRecibo = ParticipanteDaLista & {
  horaExtra: string | null; adicionalNoturno: string | null; vales: ValeDoRecibo[];
};

// Título "Acerto (lista de pagamento)" da pessoa na competência, como está no Contas a Pagar.
export type AcertoDoRecibo = { amount: number; paidAmount: number | null; paymentDate: Date | null };

export type ReciboPagamentoMes = {
  tipo: "PAGAMENTO_MES";
  employeeId: string; nome: string; cpf: string | null;
  competencia: string; referencia: string;
  linhas: LinhaRecibo[];
  totalLista: number;
  acerto: { valor: number; pago: boolean } | null;
  total: number;
  dataPagamento: string | null;
};

export type ReciboPagoAntes = {
  tipo: "QUINZENA" | "ADIANTAMENTO";
  id: string; employeeId: string; nome: string; cpf: string | null;
  competencia: string; referencia: string;
  linhas: LinhaRecibo[];
  total: number;
  dataPagamento: string | null;
};

const NOME_DO_VALE: Record<string, string> = {
  ADIANTAMENTO: "Vale adiantamento", RETIRADA_CAIXA: "Retirada de caixa", REFEICAO: "Refeição",
  VALE_CONSUMO: "Consumo", OUTRO: "Desconto", CREDITO: "Crédito",
};

const diferente = (a: number, b: number) => Math.abs(a - b) >= 0.005;
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);
const diaIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horas = (t: string | null) => (t && t.trim() && t.trim() !== "0:00" ? t.trim() : null);

/** Quem tem recibo do mês: os mesmos do acerto (sem registro na lista, fora da rescisão, com a receber). */
export const recebeReciboDoMes = (p: ParticipanteDaLista) => recebeAcerto(p);

/** Valor que a pessoa recebeu (ou vai receber) por um título: o pago, se já baixado. */
export const valorDoTitulo = (t: { amount: number; paidAmount: number | null; paymentDate: Date | null }) =>
  round2(t.paymentDate ? t.paidAmount ?? t.amount : t.amount);

function linhasDosVales(vales: ValeDoRecibo[]): LinhaRecibo[] {
  const ordenados = [...vales].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return ordenados.map((v) => {
    const credito = v.type === "CREDITO";
    const nome = NOME_DO_VALE[v.type] ?? "Desconto";
    return {
      descricao: v.notes?.trim() ? `${nome}: ${v.notes.trim()}` : nome,
      detalhe: dataBr(v.date),
      valor: round2(credito ? v.amount : -v.amount),
      vale: true,
    };
  });
}

/**
 * A discriminação do pagamento do mês. A soma das linhas é o A pagar da lista; o que sobrar
 * (fechamento antigo, vale mudado depois de fechar) vira linha de ajuste, e o acerto lançado
 * com outro valor vira outra — o total do recibo é sempre o que a pessoa recebe.
 */
export function discriminacaoDoMes(p: ParticipanteDoRecibo, acerto: AcertoDoRecibo | null) {
  const linhas: LinhaRecibo[] = [];
  const dias = p.diasSalario;
  if (p.salarioProporcional !== 0 || dias > 0) {
    linhas.push({ descricao: "Dias trabalhados", detalhe: `${dias} ${dias === 1 ? "dia" : "dias"}`, valor: round2(p.salarioProporcional) });
  }
  if ((p.adiantamentoSalarial ?? 0) > 0) linhas.push({ descricao: "Adiantamento já pago", detalhe: null, valor: -round2(p.adiantamentoSalarial ?? 0) });
  if ((p.primeiraQuinzena ?? 0) > 0) linhas.push({ descricao: "1ª quinzena já paga", detalhe: null, valor: -round2(p.primeiraQuinzena ?? 0) });
  if (!p.foraDaGorjeta && p.rateioAmount !== 0) linhas.push({ descricao: "Gorjeta", detalhe: null, valor: round2(p.rateioAmount) });
  linhas.push(...linhasDosVales(p.vales));
  if ((p.valorHoraExtra ?? 0) > 0) linhas.push({ descricao: "Hora extra (50%)", detalhe: horas(p.horaExtra), valor: round2(p.valorHoraExtra ?? 0) });
  if ((p.valorAdicionalNoturno ?? 0) > 0) {
    linhas.push({ descricao: "Adicional noturno", detalhe: horas(p.adicionalNoturno), valor: round2(p.valorAdicionalNoturno ?? 0) });
  }
  if ((p.valorDsr ?? 0) > 0) linhas.push({ descricao: "DSR", detalhe: "sobre hora extra e noturno", valor: round2(p.valorDsr ?? 0) });

  const totalLista = round2(p.totalAPagar);
  const soma = round2(linhas.reduce((a, l) => a + l.valor, 0));
  if (diferente(soma, totalLista)) {
    linhas.push({ descricao: "Ajuste do fechamento da apuração", detalhe: null, valor: round2(totalLista - soma) });
  }
  if (!acerto) return { linhas, totalLista, acerto: null, total: totalLista };
  const valorAcerto = valorDoTitulo(acerto);
  if (diferente(valorAcerto, totalLista)) {
    linhas.push({
      descricao: "Ajuste no Contas a Pagar",
      detalhe: `acerto de ${reais(valorAcerto)}; lista de ${reais(totalLista)}`,
      valor: round2(valorAcerto - totalLista),
    });
  }
  return { linhas, totalLista, acerto: { valor: valorAcerto, pago: acerto.paymentDate != null }, total: valorAcerto };
}

export function reciboDoMes(
  p: ParticipanteDoRecibo, pessoa: { nome: string; cpf: string | null }, acerto: AcertoDoRecibo | null, ano: number, mes: number,
): ReciboPagamentoMes {
  const competencia = competenciaTexto(ano, mes);
  const d = discriminacaoDoMes(p, acerto);
  return {
    tipo: "PAGAMENTO_MES", employeeId: p.employeeId, nome: pessoa.nome, cpf: cpfOuNull(pessoa.cpf),
    competencia, referencia: `pagamento do mês de ${competencia}`,
    linhas: d.linhas, totalLista: d.totalLista, acerto: d.acerto, total: d.total,
    dataPagamento: acerto?.paymentDate ? diaIso(acerto.paymentDate) : null,
  };
}

const cpfOuNull = (cpf: string | null) => (cpf && cpf.replace(/\D/g, "").length > 0 ? cpf : null);

// Título ADIANTAMENTO do sem registro: a 1ª quinzena leva details.primeiraQuinzena.
export type TituloPagoAntes = {
  id: string; employeeId: string; competenceYear: number; competenceMonth: number;
  amount: number; paidAmount: number | null; paymentDate: Date | null; details: unknown;
};

export const ehPrimeiraQuinzena = (details: unknown) =>
  Boolean(details && typeof details === "object" && (details as Record<string, unknown>).primeiraQuinzena === true);

// A base só aparece quando explica o valor: 40% de R$ 2.600,00 = R$ 1.040,00; metade de R$ 2.600,00.
// Valor mudado à mão ou proporcional (entrada no meio do mês) sai sem a base.
export function baseDoPagoAntes(details: unknown, valor: number): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const base = Number(d.base);
  if (!Number.isFinite(base) || base <= 0) return null;
  if (ehPrimeiraQuinzena(d)) return diferente(round2(base / 2), valor) ? null : `metade do valor mensal de ${reais(base)}`;
  const percent = Number(d.percent);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  if (diferente(round2((base * percent) / 100), valor)) return null;
  return `${percent.toLocaleString("pt-BR")}% do valor mensal de ${reais(base)}`;
}

export function reciboPagoAntes(t: TituloPagoAntes, pessoa: { nome: string; cpf: string | null }): ReciboPagoAntes {
  const quinzena = ehPrimeiraQuinzena(t.details);
  const competencia = competenciaTexto(t.competenceYear, t.competenceMonth);
  const valor = valorDoTitulo(t);
  const referencia = quinzena ? `1ª quinzena de ${competencia}` : `adiantamento de ${competencia}`;
  const rotulo = quinzena ? `1ª quinzena de ${competencia}` : `Adiantamento de ${competencia}`;
  return {
    tipo: quinzena ? "QUINZENA" : "ADIANTAMENTO",
    id: t.id, employeeId: t.employeeId, nome: pessoa.nome, cpf: cpfOuNull(pessoa.cpf),
    competencia, referencia,
    linhas: [{ descricao: rotulo, detalhe: baseDoPagoAntes(t.details, valor), valor }],
    total: valor,
    dataPagamento: diaIso(t.paymentDate),
  };
}
