// Recibo de pagamento de quem não tem registro — regras puras. As rotas (recibo-pagamento.routes.ts)
// leem a apuração e o Contas a Pagar e devolvem isto para a tela imprimir.
//
// Três recibos:
//   - pagamento do mês: o acerto da lista de pagamento, discriminado como a lista calcula
//     (dias trabalhados − adiantamento − 1ª quinzena + gorjeta líquida de vales e créditos + hora extra
//     + noturno + DSR). O total é o A pagar da lista; se o acerto no Contas a Pagar tiver outro
//     valor, vale o do acerto e a diferença aparece como ajuste (nunca escondida);
//   - 1ª quinzena (dia 15) e adiantamento (dia 20): o título ADIANTAMENTO do sem registro.
// O impresso não leva empresa nem a palavra "salário": só a pessoa, os valores e a referência.
import type { ParticipanteDaLista } from "./acerto-lista.js";
import { competenciaTexto, recebeAcerto } from "./acerto-lista.js";
import { round2 } from "./vt-calc.js";

// Uma linha do recibo, como no holerite: código fixo do item, descrição (maiúsculas), referência
// (dias, horas, %, data do vale) e o valor com sinal (positivo = vencimento, negativo = desconto).
// vale: linha de um vale ou crédito da gorjeta (a impressão junta numa linha só se não couber).
export type LinhaRecibo = { codigo: number; descricao: string; referencia: string | null; valor: number; vale?: true };

// Códigos fixos dos itens (só para leitura do recibo; não são os da contabilidade).
export const CODIGO = {
  DIAS: 1, QUINZENA: 10, ADIANTAMENTO: 20, HORA_EXTRA: 201, NOTURNO: 202, GORJETA: 203, DSR: 250, CREDITO: 300,
  DESC_ADIANTAMENTO: 981, DESC_QUINZENA: 982, VALE: 990, AJUSTE: 999,
} as const;

export type ValeDoRecibo = { type: string; amount: number; date: string | null; notes: string | null };

export type ParticipanteDoRecibo = ParticipanteDaLista & {
  horaExtra: string | null; adicionalNoturno: string | null; vales: ValeDoRecibo[]; baseSalary?: number | null;
};

// Título "Acerto (lista de pagamento)" da pessoa na competência, como está no Contas a Pagar.
export type AcertoDoRecibo = { amount: number; paidAmount: number | null; paymentDate: Date | null };

// O que vem do cadastro. Nascimento só vira dia/mês (a linha de parabéns), nunca o ano.
export type PessoaDoRecibo = {
  nome: string; cpf: string | null; codigo?: string | null; funcao?: string | null;
  admissao?: Date | null; nascimento?: Date | null; valorMensal?: number | null;
};

type CabecalhoDaPessoa = {
  employeeId: string; nome: string; cpf: string | null; codigo: string | null; funcao: string | null;
  admissao: string | null; aniversario: string | null; valorMensal: number | null;
};

export type ReciboPagamentoMes = CabecalhoDaPessoa & {
  tipo: "PAGAMENTO_MES";
  competencia: string; referencia: string;
  linhas: LinhaRecibo[];
  totalLista: number;
  acerto: { valor: number; pago: boolean } | null;
  total: number;
  dataPagamento: string | null;
};

export type ReciboPagoAntes = CabecalhoDaPessoa & {
  tipo: "QUINZENA" | "ADIANTAMENTO";
  id: string;
  competencia: string; referencia: string;
  linhas: LinhaRecibo[];
  total: number;
  dataPagamento: string | null;
};

const NOME_DO_VALE: Record<string, string> = {
  ADIANTAMENTO: "VALE ADIANTAMENTO", RETIRADA_CAIXA: "VALE RETIRADA CAIXA", REFEICAO: "VALE REFEIÇÃO",
  VALE_CONSUMO: "VALE CONSUMO", OUTRO: "VALE DESCONTO", CREDITO: "CRÉDITO",
};

const diferente = (a: number, b: number) => Math.abs(a - b) >= 0.005;
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);
const diaIso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const numero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maiusculas = (t: string) => t.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");

/** "6:30" → "6,50" (horas decimais, como a referência do holerite); vazio ou zero → null. */
export function horasDecimais(t: string | null): string | null {
  const m = /^(\d+):(\d{1,2})$/.exec((t ?? "").trim());
  if (!m) return null;
  const total = Number(m[1]) + Number(m[2]) / 60;
  return total > 0 ? numero(total) : null;
}

/** Dia e mês do nascimento ("12/10"); o ano não sai do servidor. */
export const aniversarioDe = (d: Date | null | undefined) =>
  (d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);

const cpfOuNull = (cpf: string | null) => (cpf && cpf.replace(/\D/g, "").length > 0 ? cpf : null);

function cabecalho(employeeId: string, pessoa: PessoaDoRecibo, valorMensal: number | null): CabecalhoDaPessoa {
  return {
    employeeId, nome: pessoa.nome, cpf: cpfOuNull(pessoa.cpf), codigo: pessoa.codigo?.trim() || null,
    funcao: pessoa.funcao?.trim() || null, admissao: diaIso(pessoa.admissao), aniversario: aniversarioDe(pessoa.nascimento),
    valorMensal: valorMensal != null && valorMensal > 0 ? round2(valorMensal) : null,
  };
}

/** Quem tem recibo do mês: os mesmos do acerto (sem registro na lista, fora da rescisão, com a receber). */
export const recebeReciboDoMes = (p: ParticipanteDaLista) => recebeAcerto(p);

/** Valor que a pessoa recebeu (ou vai receber) por um título: o pago, se já baixado. */
export const valorDoTitulo = (t: { amount: number; paidAmount: number | null; paymentDate: Date | null }) =>
  round2(t.paymentDate ? t.paidAmount ?? t.amount : t.amount);

function linhasDosVales(vales: ValeDoRecibo[]): LinhaRecibo[] {
  const ordenados = [...vales].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return ordenados.map((v) => {
    const credito = v.type === "CREDITO";
    const nome = NOME_DO_VALE[v.type] ?? "VALE DESCONTO";
    return {
      codigo: credito ? CODIGO.CREDITO : CODIGO.VALE,
      descricao: v.notes?.trim() ? `${nome} ${maiusculas(v.notes)}` : nome,
      referencia: dataBr(v.date),
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
    linhas.push({ codigo: CODIGO.DIAS, descricao: "DIAS TRABALHADOS", referencia: numero(dias), valor: round2(p.salarioProporcional) });
  }
  // Vales e créditos são da gorjeta (regra do dono, 07/10/2026): o recibo mostra só a gorjeta
  // líquida, sem listar cada vale. Vales acima da gorjeta viram uma linha de desconto.
  const rateio = p.foraDaGorjeta ? 0 : p.rateioAmount;
  const gorjetaLiquida = round2(rateio + linhasDosVales(p.vales).reduce((a, l) => a + l.valor, 0));
  if (gorjetaLiquida !== 0) {
    linhas.push({ codigo: CODIGO.GORJETA, descricao: gorjetaLiquida > 0 ? "GORJETA" : "VALES ACIMA DA GORJETA", referencia: null, valor: gorjetaLiquida });
  }
  if ((p.valorHoraExtra ?? 0) > 0) {
    linhas.push({ codigo: CODIGO.HORA_EXTRA, descricao: "HORA EXTRA 50%", referencia: horasDecimais(p.horaExtra), valor: round2(p.valorHoraExtra ?? 0) });
  }
  if ((p.valorAdicionalNoturno ?? 0) > 0) {
    linhas.push({ codigo: CODIGO.NOTURNO, descricao: "ADICIONAL NOTURNO", referencia: horasDecimais(p.adicionalNoturno), valor: round2(p.valorAdicionalNoturno ?? 0) });
  }
  if ((p.valorDsr ?? 0) > 0) linhas.push({ codigo: CODIGO.DSR, descricao: "DSR S/ EXTRAS", referencia: null, valor: round2(p.valorDsr ?? 0) });
  const adiantamento = round2(p.adiantamentoSalarial ?? 0);
  if (adiantamento > 0) linhas.push({ codigo: CODIGO.DESC_ADIANTAMENTO, descricao: "DESC. ADIANTAMENTO", referencia: numero(adiantamento), valor: -adiantamento });
  const quinzena = round2(p.primeiraQuinzena ?? 0);
  if (quinzena > 0) linhas.push({ codigo: CODIGO.DESC_QUINZENA, descricao: "DESC. 1ª QUINZENA", referencia: numero(quinzena), valor: -quinzena });

  const totalLista = round2(p.totalAPagar);
  const soma = round2(linhas.reduce((a, l) => a + l.valor, 0));
  if (diferente(soma, totalLista)) {
    linhas.push({ codigo: CODIGO.AJUSTE, descricao: "AJUSTE DO FECHAMENTO DA APURAÇÃO", referencia: null, valor: round2(totalLista - soma) });
  }
  if (!acerto) return { linhas, totalLista, acerto: null, total: totalLista };
  const valorAcerto = valorDoTitulo(acerto);
  if (diferente(valorAcerto, totalLista)) {
    linhas.push({
      codigo: CODIGO.AJUSTE, descricao: `AJUSTE CONTAS A PAGAR (LISTA ${numero(totalLista)})`,
      referencia: numero(valorAcerto), valor: round2(valorAcerto - totalLista),
    });
  }
  return { linhas, totalLista, acerto: { valor: valorAcerto, pago: acerto.paymentDate != null }, total: valorAcerto };
}

export function reciboDoMes(
  p: ParticipanteDoRecibo, pessoa: PessoaDoRecibo, acerto: AcertoDoRecibo | null, ano: number, mes: number,
): ReciboPagamentoMes {
  const competencia = competenciaTexto(ano, mes);
  const d = discriminacaoDoMes(p, acerto);
  return {
    tipo: "PAGAMENTO_MES", ...cabecalho(p.employeeId, pessoa, p.baseSalary ?? pessoa.valorMensal ?? null),
    competencia, referencia: `pagamento do mês de ${competencia}`,
    linhas: d.linhas, totalLista: d.totalLista, acerto: d.acerto, total: d.total,
    dataPagamento: acerto?.paymentDate ? diaIso(acerto.paymentDate) : null,
  };
}

// Título ADIANTAMENTO do sem registro: a 1ª quinzena leva details.primeiraQuinzena.
export type TituloPagoAntes = {
  id: string; employeeId: string; competenceYear: number; competenceMonth: number;
  amount: number; paidAmount: number | null; paymentDate: Date | null; details: unknown;
};

export const ehPrimeiraQuinzena = (details: unknown) =>
  Boolean(details && typeof details === "object" && (details as Record<string, unknown>).primeiraQuinzena === true);

const baseDe = (details: unknown) => {
  const base = Number((details as Record<string, unknown> | null)?.base);
  return Number.isFinite(base) && base > 0 ? base : null;
};

// A referência (% do valor mensal) só aparece quando explica o valor: 40% de 2.600,00 = 1.040,00;
// 50% (metade) na quinzena. Valor mudado à mão ou proporcional (entrada no meio do mês) sai sem ela.
export function baseDoPagoAntes(details: unknown, valor: number): string | null {
  if (!details || typeof details !== "object") return null;
  const base = baseDe(details);
  if (base == null) return null;
  if (ehPrimeiraQuinzena(details)) return diferente(round2(base / 2), valor) ? null : "50%";
  const percent = Number((details as Record<string, unknown>).percent);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  if (diferente(round2((base * percent) / 100), valor)) return null;
  return `${percent.toLocaleString("pt-BR")}%`;
}

export function reciboPagoAntes(t: TituloPagoAntes, pessoa: PessoaDoRecibo): ReciboPagoAntes {
  const quinzena = ehPrimeiraQuinzena(t.details);
  const competencia = competenciaTexto(t.competenceYear, t.competenceMonth);
  const valor = valorDoTitulo(t);
  return {
    tipo: quinzena ? "QUINZENA" : "ADIANTAMENTO",
    id: t.id, ...cabecalho(t.employeeId, pessoa, baseDe(t.details) ?? pessoa.valorMensal ?? null),
    competencia, referencia: quinzena ? `1ª quinzena de ${competencia}` : `adiantamento de ${competencia}`,
    linhas: [{
      codigo: quinzena ? CODIGO.QUINZENA : CODIGO.ADIANTAMENTO, descricao: quinzena ? "1ª QUINZENA" : "ADIANTAMENTO",
      referencia: baseDoPagoAntes(t.details, valor), valor,
    }],
    total: valor,
    dataPagamento: diaIso(t.paymentDate),
  };
}
