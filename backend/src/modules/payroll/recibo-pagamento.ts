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
// (dias, horas, %, data do pagamento) e o valor com sinal (positivo = vencimento, negativo = desconto).
export type LinhaRecibo = { codigo: number; descricao: string; referencia: string | null; valor: number };

// Códigos fixos dos itens (só para leitura do recibo; não são os da contabilidade).
export const CODIGO = {
  DIAS: 1, QUINZENA: 10, ADIANTAMENTO: 20, HORA_EXTRA: 201, NOTURNO: 202, GORJETA: 203, DSR: 250, CREDITO: 300,
  DESC_ADIANTAMENTO: 981, DESC_QUINZENA: 982, COMPL_ADIANTAMENTO: 983, COMPL_QUINZENA: 984, VALE: 990, AJUSTE: 999,
} as const;

export type ValeDoRecibo = { type: string; amount: number; date: string | null; notes: string | null };

export type ParticipanteDoRecibo = ParticipanteDaLista & {
  horaExtra: string | null; adicionalNoturno: string | null; vales: ValeDoRecibo[]; baseSalary?: number | null;
  /** Saiu no período e ainda falta o valor da rescisão (só com a apuração aberta). */
  rescisaoPendente?: boolean;
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
  /** Recebe por quinzena: o acerto vence no fim do próprio mês (os outros, no mês seguinte). */
  pagamentoQuinzenal: boolean;
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

const diferente = (a: number, b: number) => Math.abs(a - b) >= 0.005;
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);
const diaIso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const numero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

/** Quem tem recibo do mês: os mesmos do acerto (sem registro na lista, fora da rescisão, com a receber),
 *  menos quem saiu e ainda não tem o valor da rescisão. */
export const recebeReciboDoMes = (p: ParticipanteDaLista & { rescisaoPendente?: boolean }) => recebeAcerto(p) && !p.rescisaoPendente;

/** Valor que a pessoa recebeu (ou vai receber) por um título: o pago, se já baixado. */
export const valorDoTitulo = (t: { amount: number; paidAmount: number | null; paymentDate: Date | null }) =>
  round2(t.paymentDate ? t.paidAmount ?? t.amount : t.amount);

// Saldo dos vales e créditos da gorjeta (crédito soma, o resto desconta).
const saldoDosVales = (vales: ValeDoRecibo[]) =>
  round2(vales.reduce((a, v) => a + (v.type === "CREDITO" ? v.amount : -v.amount), 0));

/**
 * A discriminação do pagamento do mês. A soma das linhas é o A pagar da lista; o que sobrar
 * (fechamento antigo, vale mudado depois de fechar) vira linha de ajuste, e o acerto lançado
 * com outro valor vira outra — o total do recibo é sempre o que a pessoa recebe.
 */
// Títulos do adiantamento (ou da 1ª quinzena) do mês, somados: valor dos títulos, quanto já foi pago,
// a data da última baixa, quantos são e se algum ainda está sem baixa.
export type PagoAntesResumo = { titulo: number; pago: number; data: Date | null; titulos: number; algumAberto: boolean };
export type PagosAntesDoMes = { adiantamento?: PagoAntesResumo; quinzena?: PagoAntesResumo };

export type TituloDoMes = { employeeId: string; amount: number; paidAmount: number | null; paymentDate: Date | null; details: unknown };

/** Soma os títulos ADIANTAMENTO do sem registro por pessoa e tipo (quinzena × adiantamento), como a apuração. */
export function resumirPagosAntes(titulos: TituloDoMes[]): Map<string, PagosAntesDoMes> {
  const porPessoa = new Map<string, PagosAntesDoMes>();
  for (const t of titulos) {
    const chave = ehPrimeiraQuinzena(t.details) ? "quinzena" : "adiantamento";
    const atual = porPessoa.get(t.employeeId) ?? {};
    const r = atual[chave] ?? { titulo: 0, pago: 0, data: null, titulos: 0, algumAberto: false };
    const pago = t.paymentDate != null;
    porPessoa.set(t.employeeId, {
      ...atual,
      [chave]: {
        titulo: round2(r.titulo + t.amount),
        pago: round2(r.pago + (pago ? t.paidAmount ?? t.amount : 0)),
        data: pago && (!r.data || t.paymentDate! > r.data) ? t.paymentDate : r.data,
        titulos: r.titulos + 1,
        algumAberto: r.algumAberto || !pago,
      },
    });
  }
  return porPessoa;
}

// Desconto do que foi pago antes (adiantamento ou 1ª quinzena): o valor que a lista descontou.
// Só um título, baixado com valor diferente dele, e a lista descontando exatamente o pago: o recibo
// desconta o título inteiro e mostra a diferença (complemento ou pago a maior). Fora disso — mais de
// um título, algum sem baixa, ou a lista limitada ao valor do mês — só o desconto da lista.
function descontoPagoAntes(
  descontoDaLista: number, r: PagoAntesResumo | undefined,
  d: { codigo: number; descricao: string; codigoDif: number; complemento: string; aMaior: string },
): LinhaRecibo[] {
  if (descontoDaLista <= 0) return [];
  const referencia = dataBr(diaIso(r?.data)) ?? numero(descontoDaLista);
  const explica = r != null && r.titulos === 1 && !r.algumAberto && diferente(r.titulo, r.pago) && !diferente(descontoDaLista, r.pago);
  if (!explica) return [{ codigo: d.codigo, descricao: d.descricao, referencia, valor: -descontoDaLista }];
  const dif = round2(r.titulo - r.pago);
  return [
    { codigo: d.codigo, descricao: d.descricao, referencia, valor: -round2(r.titulo) },
    { codigo: d.codigoDif, descricao: dif > 0 ? d.complemento : d.aMaior, referencia: null, valor: dif },
  ];
}

export function discriminacaoDoMes(p: ParticipanteDoRecibo, acerto: AcertoDoRecibo | null, pagosAntes: PagosAntesDoMes = {}) {
  const linhas: LinhaRecibo[] = [];
  const dias = p.diasSalario;
  if (p.salarioProporcional !== 0 || dias > 0) {
    linhas.push({ codigo: CODIGO.DIAS, descricao: "DIAS TRABALHADOS", referencia: numero(dias), valor: round2(p.salarioProporcional) });
  }
  // Vales e créditos são da gorjeta (regra do dono, 07/10/2026): o recibo mostra só a gorjeta
  // líquida, sem listar cada vale. Vales acima da gorjeta viram uma linha de desconto. Quem está
  // fora da gorjeta tem só o saldo dos vales/créditos: "CRÉDITOS" ou "VALES", sem falar em gorjeta.
  const saldo = saldoDosVales(p.vales);
  if (p.foraDaGorjeta) {
    if (saldo !== 0) linhas.push(saldo > 0
      ? { codigo: CODIGO.CREDITO, descricao: "CRÉDITOS", referencia: null, valor: saldo }
      : { codigo: CODIGO.VALE, descricao: "VALES", referencia: null, valor: saldo });
  } else {
    const gorjetaLiquida = round2(p.rateioAmount + saldo);
    if (gorjetaLiquida !== 0) {
      linhas.push({ codigo: CODIGO.GORJETA, descricao: gorjetaLiquida > 0 ? "GORJETA" : "VALES ACIMA DA GORJETA", referencia: null, valor: gorjetaLiquida });
    }
  }
  if ((p.valorHoraExtra ?? 0) > 0) {
    linhas.push({ codigo: CODIGO.HORA_EXTRA, descricao: "HORA EXTRA 50%", referencia: horasDecimais(p.horaExtra), valor: round2(p.valorHoraExtra ?? 0) });
  }
  if ((p.valorAdicionalNoturno ?? 0) > 0) {
    linhas.push({ codigo: CODIGO.NOTURNO, descricao: "ADICIONAL NOTURNO", referencia: horasDecimais(p.adicionalNoturno), valor: round2(p.valorAdicionalNoturno ?? 0) });
  }
  if ((p.valorDsr ?? 0) > 0) linhas.push({ codigo: CODIGO.DSR, descricao: "DSR S/ EXTRAS", referencia: null, valor: round2(p.valorDsr ?? 0) });
  linhas.push(...descontoPagoAntes(round2(p.adiantamentoSalarial ?? 0), pagosAntes.adiantamento, {
    codigo: CODIGO.DESC_ADIANTAMENTO, descricao: "DESC. ADIANTAMENTO", codigoDif: CODIGO.COMPL_ADIANTAMENTO,
    complemento: "COMPLEMENTO DE ADIANTAMENTO", aMaior: "ADIANTAMENTO PAGO A MAIOR",
  }));
  linhas.push(...descontoPagoAntes(round2(p.primeiraQuinzena ?? 0), pagosAntes.quinzena, {
    codigo: CODIGO.DESC_QUINZENA, descricao: "DESC. 1ª QUINZENA", codigoDif: CODIGO.COMPL_QUINZENA,
    complemento: "COMPLEMENTO DA 1ª QUINZENA", aMaior: "1ª QUINZENA PAGA A MAIOR",
  }));

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
  pagosAntes: PagosAntesDoMes = {},
): ReciboPagamentoMes {
  const competencia = competenciaTexto(ano, mes);
  const d = discriminacaoDoMes(p, acerto, pagosAntes);
  return {
    tipo: "PAGAMENTO_MES", ...cabecalho(p.employeeId, pessoa, p.baseSalary ?? pessoa.valorMensal ?? null),
    pagamentoQuinzenal: p.pagamentoQuinzenal === true,
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
  const linhas: LinhaRecibo[] = [{
    codigo: quinzena ? CODIGO.QUINZENA : CODIGO.ADIANTAMENTO, descricao: quinzena ? "1ª QUINZENA" : "ADIANTAMENTO",
    referencia: baseDoPagoAntes(t.details, round2(t.amount)), valor: round2(t.amount),
  }];
  // Pago com valor diferente do título: o título fica com a base (40%, 50%) e a diferença vem numa
  // linha com o motivo da baixa — o líquido é o que a pessoa recebeu.
  const diferenca = round2(valor - t.amount);
  if (diferente(valor, t.amount)) {
    // O recibo diz onde a diferença é acertada: no pagamento do mês (complemento ou desconto).
    const descricao = diferenca < 0 ? "COMPLEMENTO A PAGAR NO PAGAMENTO DO MÊS" : "PAGO A MAIOR (DESCONTADO NO PAGAMENTO DO MÊS)";
    linhas.push({ codigo: CODIGO.AJUSTE, descricao, referencia: null, valor: diferenca });
  }
  return {
    tipo: quinzena ? "QUINZENA" : "ADIANTAMENTO",
    id: t.id, ...cabecalho(t.employeeId, pessoa, baseDe(t.details) ?? pessoa.valorMensal ?? null),
    competencia, referencia: quinzena ? `1ª quinzena de ${competencia}` : `adiantamento de ${competencia}`,
    linhas,
    total: valor,
    dataPagamento: diaIso(t.paymentDate),
  };
}
