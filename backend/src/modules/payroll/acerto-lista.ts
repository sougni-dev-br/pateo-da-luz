// Acerto do mês (lista de pagamento) de quem não tem registro como título SALARIO no Contas a
// Pagar — regras puras. O serviço (acerto-lista.service.ts) lê a apuração e grava.
//
//   valor      = total a pagar da lista (salário − adiantamento − 1ª quinzena + gorjeta
//                líquida + hora extra + noturno + DSR)
//   vencimento = por quinzena: último dia do mês da competência ("dia 30");
//                os outros: 5º dia útil do mês seguinte (seg a sáb, sem os feriados de holidays.ts)
import { ehComplemento, excluidoAMao } from "./folha-duplicidade.js";
import { holidaysForYear } from "./holidays.js";

export const ROTULO_ACERTO = "Acerto (lista de pagamento)";
export const ORIGEM_ACERTO = "LISTA_PAGAMENTO";
const DIA_UTIL_DO_SALARIO = 5;

const pad = (n: number) => String(n).padStart(2, "0");
export const competenciaTexto = (ano: number, mes: number) => `${pad(mes)}/${ano}`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesmoValor = (a: number, b: number) => Math.abs(a - b) < 0.005;

// N-ésimo dia útil do mês: segunda a sábado (o sábado conta, regra do dono), fora os feriados (nacionais, SP e móveis).
export function quintoDiaUtil(ano: number, mes: number): Date {
  const feriados = holidaysForYear(ano);
  let uteis = 0;
  for (let dia = 1; ; dia += 1) {
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const semana = data.getUTCDay();
    if (semana === 0 || feriados.has(`${pad(mes)}-${pad(dia)}`)) continue;
    uteis += 1;
    if (uteis === DIA_UTIL_DO_SALARIO) return data;
  }
}

export function vencimentoDoAcerto(ano: number, mes: number, quinzenal: boolean): Date {
  if (quinzenal) return new Date(Date.UTC(ano, mes, 0));
  return mes === 12 ? quintoDiaUtil(ano + 1, 1) : quintoDiaUtil(ano, mes + 1);
}

// O que a lista traz de cada pessoa (participante da apuração, com os dados pessoais).
export type ParticipanteDaLista = {
  employeeId: string; employeeName: string; semRegistro: boolean; tipoCalculo: string; pagoNaRescisao: boolean;
  foraDaGorjeta: boolean; pagamentoQuinzenal: boolean;
  salarioProporcional: number; diasSalario: number; adiantamentoSalarial: number | null; primeiraQuinzena: number | null;
  rateioAmount: number; descontos: number; creditos: number; netCommission: number;
  valorHoraExtra: number | null; valorAdicionalNoturno: number | null; valorDsr?: number | null; totalAPagar: number;
};

// Quem recebe acerto: sem registro na lista do mês, que não recebeu na rescisão e tem a receber.
export function recebeAcerto(p: ParticipanteDaLista): boolean {
  return p.semRegistro && p.tipoCalculo !== "FORA_DO_PERIODO" && !p.pagoNaRescisao && p.totalAPagar > 0.005;
}

// A conta inteira da lista, guardada no título (dado sensível: a lista da Folha só mostra a origem).
// O DSR só aparece quando há: acertos lançados antes dele seguem iguais (não viram "mudança").
export function composicaoDoAcerto(p: ParticipanteDaLista, apuracao: string | null) {
  const dsr = p.valorDsr ?? 0;
  return {
    origem: ORIGEM_ACERTO, semRegistro: true, apuracao, pagamentoQuinzenal: p.pagamentoQuinzenal,
    salario: p.salarioProporcional, diasSalario: p.diasSalario,
    adiantamento: p.adiantamentoSalarial ?? 0, primeiraQuinzena: p.primeiraQuinzena ?? 0,
    gorjeta: p.foraDaGorjeta ? 0 : p.rateioAmount, vales: p.descontos, creditos: p.creditos, gorjetaLiquida: p.netCommission,
    horaExtra: p.valorHoraExtra ?? 0, adicionalNoturno: p.valorAdicionalNoturno ?? 0,
    ...(dsr > 0 ? { dsr } : {}),
    totalAPagar: p.totalAPagar,
  };
}
export type ComposicaoAcerto = ReturnType<typeof composicaoDoAcerto>;

// SALARIO da pessoa na competência, como está no banco (inclusive excluído).
export type SalarioExistente = {
  id: string; periodLabel: string; amount: unknown; paymentDate: Date | null; paidAmount: unknown;
  deletedAt: Date | null; deletedById: string | null; status: string; dueDate: Date; details: unknown;
};

export type DecisaoAcerto =
  | { acao: "CRIAR" }
  | { acao: "RESTAURAR"; id: string; antes: number }
  | { acao: "ATUALIZAR"; id: string; antes: number }
  | { acao: "MANTER" }
  | { acao: "PULAR"; aviso: string; avisoSemValor: string };

const CHAVES_COMPARADAS: Array<keyof ComposicaoAcerto> = [
  "salario", "diasSalario", "adiantamento", "primeiraQuinzena", "gorjeta", "vales", "creditos", "gorjetaLiquida",
  "horaExtra", "adicionalNoturno", "dsr", "totalAPagar", "pagamentoQuinzenal", "apuracao",
];
const mesmaComposicao = (gravada: unknown, nova: ComposicaoAcerto) => {
  const g = (gravada && typeof gravada === "object" ? gravada : {}) as Record<string, unknown>;
  return g.origem === ORIGEM_ACERTO && CHAVES_COMPARADAS.every((k) => JSON.stringify(g[k] ?? null) === JSON.stringify(nova[k] ?? null));
};

// Marcado pelo PATCH /payroll/:id ao mudar valor ou vencimento de um acerto da lista.
export function editadoAMao(details: unknown): boolean {
  return Boolean(details && typeof details === "object" && (details as Record<string, unknown>).editadoAMao === true);
}

// O que fazer com o acerto de uma pessoa, dados os SALARIO dela na competência.
// - Excluído à mão não volta; o excluído antigo (sem autor) volta.
// - Pago nunca muda (avisa se a lista mudou); sem baixa, atualiza o que mudou.
// - SALARIO da competência vindo de outra origem (folha gerada, extrato, manual): um pagamento
//   por pessoa e competência — não cria outro, avisa. Complemento não conta.
export function decidirAcerto(
  nome: string, ano: number, mes: number,
  novo: { valor: number; vencimento: Date; composicao: ComposicaoAcerto },
  salarios: SalarioExistente[],
): DecisaoAcerto {
  const mmaaaa = competenciaTexto(ano, mes);
  const proprio = salarios.find((s) => s.periodLabel === ROTULO_ACERTO);
  if (proprio && excluidoAMao(proprio)) {
    const texto = `${nome}: o acerto de ${mmaaaa} foi excluído à mão e não foi recriado; se precisar, restaure pela Folha.`;
    return { acao: "PULAR", aviso: texto, avisoSemValor: texto };
  }
  if (proprio && proprio.deletedAt == null) {
    const antes = Number(proprio.amount);
    if (proprio.status === "CANCELED") {
      const texto = `${nome}: o acerto de ${mmaaaa} está cancelado no Contas a Pagar; não foi mexido.`;
      return { acao: "PULAR", aviso: texto, avisoSemValor: texto };
    }
    if (proprio.paymentDate != null || proprio.status === "PAID") {
      if (mesmoValor(antes, novo.valor)) return { acao: "MANTER" };
      return {
        acao: "PULAR",
        aviso: `${nome}: o acerto de ${mmaaaa} já pago (${brl(antes)}) não muda; a lista agora dá ${brl(novo.valor)}. Confira a diferença.`,
        avisoSemValor: `${nome}: o acerto de ${mmaaaa} já pago não muda, e a lista agora dá outro valor. Confira a diferença.`,
      };
    }
    // Ajustado à mão pela Folha (PATCH grava details.editadoAMao): a lista não sobrescreve.
    if (editadoAMao(proprio.details)) {
      if (mesmoValor(antes, novo.valor)) return { acao: "MANTER" };
      return {
        acao: "PULAR",
        aviso: `${nome}: acerto ajustado à mão: não atualizado (lista diz ${brl(novo.valor)}).`,
        avisoSemValor: `${nome}: acerto ajustado à mão: não atualizado.`,
      };
    }
    const igual = mesmoValor(antes, novo.valor) && proprio.dueDate.getTime() === novo.vencimento.getTime()
      && mesmaComposicao(proprio.details, novo.composicao);
    return igual ? { acao: "MANTER" } : { acao: "ATUALIZAR", id: proprio.id, antes };
  }
  const outro = salarios.find((s) => s.periodLabel !== ROTULO_ACERTO && s.deletedAt == null && s.status !== "CANCELED"
    && !ehComplemento(s.details));
  if (outro) {
    const texto = `${nome}: salário de ${mmaaaa} já lançado como "${outro.periodLabel}" no Contas a Pagar; acerto não lançado (um salário por pessoa e competência). Confira qual vale.`;
    return { acao: "PULAR", aviso: texto, avisoSemValor: texto };
  }
  return proprio ? { acao: "RESTAURAR", id: proprio.id, antes: Number(proprio.amount) } : { acao: "CRIAR" };
}

// Acerto lançado de quem a lista não paga mais (rescisão lançada depois, total zerado): não
// apaga sozinho — quem cuida do Contas a Pagar decide.
export function avisoAcertoSemLista(nome: string, ano: number, mes: number, pago: boolean): string {
  return `${nome}: tem acerto de ${competenciaTexto(ano, mes)} lançado${pago ? " (já pago)" : ""}, mas na lista não tem mais nada a receber. Confira e, se for o caso, exclua o título no Contas a Pagar.`;
}
