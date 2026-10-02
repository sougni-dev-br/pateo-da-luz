// Rateio da gorjeta pelo método da planilha de apuração (set/2026). Funções puras,
// sem banco: o serviço junta os dados e este arquivo faz a conta.
//
//   líquido = bruto − dedução (20%)
//   pontos apurados = pontos-base × (dias computados ÷ dias previstos)
//   pontos finais   = apurados + ajuste do mês (acréscimo ou desconto)
//
// Rescisões primeiro: quem saiu no período tem valor do ponto próprio, sobre o
// serviço arrecadado até a saída (ou o valor quitado, que não muda mais). Nos
// dois modos quem saiu recebe o mesmo; o que muda é o ponto de quem fica.
//
// Modo "fica com quem continua" (padrão): o que as rescisões levam — em reais e
// em pontos — sai da apuração do mês:
//
//   valor do ponto do mês = (líquido − cotas fixas − rescisões)
//                           ÷ (pontos de referência − pontos das rescisões)
//
// Assim o serviço gerado depois da saída fica com quem continua.
//
// Modo "vai para o livre" (sobraRescisaoParaSaldo): o ponto do mês ignora as
// rescisões, e o que quem saiu deixou de ganhar depois da saída fica no saldo:
//
//   valor do ponto do mês = (líquido − cotas fixas) ÷ pontos de referência
//
// Em ambos: rateio = pontos finais × valor do ponto do mês. O valor do ponto
// NÃO sobe quando alguém do mês perde pontos por falta: a diferença fica como
// saldo (retido pela casa). Saldo = líquido − distribuído.

import { valoresAdicionais } from "./hora-extra.js";
import { round2 } from "./vt-calc.js";

const DIA_MS = 24 * 60 * 60 * 1000;

export type RegrasPeriodo = {
  start: Date;
  end: Date;
  diasPadrao: number;
  descontaFalta: boolean;
  descontaAtestado: boolean;
  descontaFerias: boolean;
  descontaOutros: boolean;
  // Admitido no meio do período recebe proporcional aos dias (padrão). Desligado
  // já é proporcional pelo valor do ponto próprio (serviço até a saída).
  proporcionalEntrada: boolean;
  // Parte de quem saiu depois da saída: false = sobe o ponto de quem fica (padrão);
  // true = o ponto do mês não desconta as rescisões e a sobra vai para o livre.
  sobraRescisaoParaSaldo?: boolean;
  pointsTotal: number;
  deductionPercent: number;
  netPool: number;
  // Competência do salário de quem não tem registro: o mês civil (setembro = 01 a 30/09),
  // não o ciclo da gorjeta (26/08–25/09). O mês anterior já foi pago até o dia 31.
  // Ausente = usa o próprio período (compatível com o que havia antes).
  mesSalario?: { start: Date; end: Date };
  // Adiantamento salarial de quem não tem registro (PayrollSettings): % do salário base,
  // pago no dia do mês do salário. Ausente = ninguém recebeu adiantamento.
  adiantamentoPercent?: number;
  adiantamentoDia?: number;
};

export type ValeEntrada = { type: string; amount: number };

export type ParticipanteEntrada = {
  kind: "FIXO" | "PONTOS";
  basePoints: number;
  ajuste: number;
  fixedAmount: number | null;
  admissao: Date | null;
  // Entra na gorjeta em (cadastro): a presença na gorjeta conta daqui, não da admissão.
  // O salário de quem não tem registro continua desde a admissão (os dias de teste são
  // pagos). Ausente ou null = desde a admissão.
  inicioGorjeta?: Date | null;
  desligamento: Date | null;
  faltas: number;
  atestados: number;
  ferias: number;
  outrosDias: number;
  diasPrevistosOverride: number | null;
  // Decisão de quem fecha, pessoa a pessoa. null = segue a regra do período.
  regras: {
    descontaFalta: boolean | null;
    descontaAtestado: boolean | null;
    descontaFerias: boolean | null;
    descontaOutros: boolean | null;
    proporcionalEntrada: boolean | null;
  };
  rescisaoServicoBruto: number | null;
  rescisaoValorFixo: number | null;
  semRegistro: boolean;
  salarioBase: number | null;
  // Salário base vigente no dia 15 (1ª quinzena) e no dia do adiantamento: o pagamento sai
  // com o salário daquele dia. Ausente = salarioBase (o do mês).
  salarioBaseQuinzena?: number | null;
  salarioBaseAdiantamento?: number | null;
  diasSalarioOverride: number | null;
  // Faltas dentro do mês do salário (as de 26 a 31 do mês anterior são daquele salário).
  // Ausente = usa as faltas do período.
  faltasSalario?: number;
  // Cadastro: recebe adiantamento salarial (só vale para quem não tem registro).
  recebeAdiantamento?: boolean;
  // Adiantamento do mês LANÇADO em Contas a Pagar (título ADIANTAMENTO da competência):
  // previsto = soma dos títulos; pago = soma do que foi baixado (valor pago), null se nenhum
  // foi baixado. Quando vem, é ele que a lista desconta — o que saiu de verdade, não os 40%.
  // Ausente = sem título no mês: vale a regra do cadastro (recebeAdiantamento × %).
  adiantamentoLancado?: { previsto: number; pago: number | null };
  // Cadastro: recebe por quinzena — metade do salário base no dia 15 (só sem registro).
  // Prevalece sobre recebeAdiantamento: as duas juntas não descontam duas vezes.
  pagamentoQuinzenal?: boolean;
  // Rescisão lançada em Contas a Pagar (Folha → rescisão). Sem registro: ela já
  // pagou salário e gorjeta até a saída, então a pessoa sai da lista do mês.
  rescisaoLancada: boolean;
  // A rescisão lançada é a da regra "tudo na rescisão" (details.tudoNaRescisao): só ela
  // paga o mês de quem saiu depois do ciclo. Ausente/false = a lista do mês paga.
  rescisaoTudoNaRescisao?: boolean;
  // Gorjeta real digitada no lugar da calculada (quem está no mês, por pontos).
  gorjetaReal?: number | null;
  // Hora extra e adicional noturno do período, em minutos. Só pagam a quem não tem
  // registro (o CLT recebe pela contabilidade). Ausente = nenhuma.
  horaExtraMin?: number;
  adicionalNoturnoMin?: number;
  // Sem registro que não participa da gorjeta: está na lista só pelo salário. Não entra
  // no rateio (pontos e gorjeta zero, fora do ponto do mês e das cotas); vales descontam.
  foraDaGorjeta?: boolean;
  vales: ValeEntrada[];
};

export type TipoCalculo = "MES" | "RESCISAO" | "RESCISAO_QUITADA" | "FORA_DO_PERIODO";

export type ParticipanteCalculado = {
  tipoCalculo: TipoCalculo;
  // Não participa da gorjeta (só salário): rateio e pontos zero.
  foraDaGorjeta: boolean;
  diasElegiveis: number;
  diasPrevistos: number;
  // Base da proporção: 26 no mês cheio; menos para quem saiu (até a saída).
  diasReferencia: number;
  diasComputados: number;
  fatorPresenca: number;
  pontosApurados: number;
  pontosFinais: number;
  // Rescisão quitada: os pontos a que tinha direito × os que a gorjeta paga vale.
  pontosDireito: number;
  pontosDevolvidos: number;
  extraRescisao: number;
  justificativaExtra: string | null;
  // Quitada com serviço até a saída: o que o direito valia pelo ponto da saída. É esse
  // valor que sai do líquido antes do ponto do mês, como numa rescisão calculada; a
  // diferença para o que foi pago volta ao saldo (ou sai dele, se pagou a mais).
  valorDireito: number | null;
  // O que o sistema calculou antes de qualquer valor real digitado.
  gorjetaCalculada: number;
  // A gorjeta real digitada entrou no cálculo (só vale no mês, por pontos).
  gorjetaRealAplicada: boolean;
  valorPonto: number;
  rateio: number;
  descontos: number;
  creditos: number;
  comissaoLiquida: number;
  diasSalario: number;
  salarioProporcional: number;
  // Sem registro: o que já recebeu de adiantamento salarial no mês do salário (0 = não recebeu).
  adiantamentoSalarial: number;
  // Sem registro que recebe por quinzena: a 1ª quinzena já paga no dia 15 (0 = não recebeu).
  primeiraQuinzena: number;
  // Sem registro: hora extra (+50%) e adicional noturno pagos na lista. CLT = 0.
  valorHoraExtra: number;
  valorAdicionalNoturno: number;
  totalAPagar: number;
  rescisaoPendente: boolean;
  // CLT com gorjeta paga: a contabilidade já pagou na rescisão. Sem registro só
  // quando a rescisão está lançada em Contas a Pagar; sem ela, recebe na lista.
  pagoNaRescisao: boolean;
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const ptsTexto = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DIA_MS) + 1;
}

// Dias corridos do vínculo dentro do período (admissão e desligamento inclusive).
export function diasElegiveis(regras: Pick<RegrasPeriodo, "start" | "end">, admissao: Date | null, desligamento: Date | null): number {
  const inicio = admissao && admissao > regras.start ? admissao : regras.start;
  const fim = desligamento && desligamento < regras.end ? desligamento : regras.end;
  return fim < inicio ? 0 : diasEntre(inicio, fim);
}

// Participa da gorjeta no cadastro, mas ainda não entrou neste período: sem a data de
// entrada (em teste) ou com ela depois do fim do ciclo. Sem registro em teste fica no
// período só pelo salário (foraDaGorjeta); CLT em teste fica fora do rateio.
export function emTesteNaGorjeta(e: { participaGorjeta: boolean; inicioGorjeta: Date | null }, fimDoCiclo: Date): boolean {
  if (!e.participaGorjeta) return false;
  return e.inicioGorjeta == null || e.inicioGorjeta > fimDoCiclo;
}

// Início do vínculo com a gorjeta: o mais tarde entre a admissão e a entrada na gorjeta.
function inicioNaGorjeta(p: ParticipanteEntrada): Date | null {
  if (!p.inicioGorjeta) return p.admissao;
  return p.admissao && p.admissao > p.inicioGorjeta ? p.admissao : p.inicioGorjeta;
}

// Valor do ponto de quem fica: o líquido e os pontos que sobram depois das rescisões.
export function valorPontoMes(
  regras: RegrasPeriodo, totalCotasFixas: number, rescisoes: { valor: number; pontos: number } = { valor: 0, pontos: 0 },
): number {
  const pontos = regras.pointsTotal - rescisoes.pontos;
  if (pontos <= 0) return 0;
  return Math.max(0, regras.netPool - totalCotasFixas - rescisoes.valor) / pontos;
}

export function valorPontoRescisao(regras: RegrasPeriodo, servicoBruto: number): number {
  if (regras.pointsTotal <= 0) return 0;
  return (servicoBruto * (1 - regras.deductionPercent / 100)) / regras.pointsTotal;
}

// Regra efetiva de uma pessoa: a dela, se quem fecha decidiu; senão, a do período.
export function regraEfetiva(regras: RegrasPeriodo, p: ParticipanteEntrada) {
  return {
    descontaFalta: p.regras.descontaFalta ?? regras.descontaFalta,
    descontaAtestado: p.regras.descontaAtestado ?? regras.descontaAtestado,
    descontaFerias: p.regras.descontaFerias ?? regras.descontaFerias,
    descontaOutros: p.regras.descontaOutros ?? regras.descontaOutros,
    proporcionalEntrada: p.regras.proporcionalEntrada ?? regras.proporcionalEntrada,
  };
}

// Presença:
//   previstos  = dias padrão × (dias no vínculo ÷ dias corridos) — o que a pessoa deveria trabalhar
//   computados = previstos − ocorrências que descontam
//   referência = base da proporção. Mês cheio = 26. Admitido no meio conta desde o
//                início do período (recebe proporcional); desligado conta só até a
//                saída, porque o valor do ponto dele já é proporcional ao serviço
//                até ali. Sem proporcional de entrada, referência = previstos.
//   fator      = computados ÷ referência
function presenca(regras: RegrasPeriodo, p: ParticipanteEntrada) {
  const r = regraEfetiva(regras, p);
  const corridos = diasEntre(regras.start, regras.end);
  const proporcao = (dias: number) => (corridos > 0 ? Math.round(regras.diasPadrao * (dias / corridos)) : 0);
  const elegiveis = diasElegiveis(regras, inicioNaGorjeta(p), p.desligamento);
  const previstos = p.diasPrevistosOverride ?? proporcao(elegiveis);
  const ateSaida = elegiveis > 0 ? diasElegiveis(regras, null, p.desligamento) : 0;
  const referencia = p.diasPrevistosOverride != null || !r.proporcionalEntrada
    ? previstos
    : Math.max(previstos, proporcao(ateSaida));
  const descontados =
    (r.descontaFalta ? p.faltas : 0) +
    (r.descontaAtestado ? p.atestados : 0) +
    (r.descontaFerias ? p.ferias : 0) +
    (r.descontaOutros ? p.outrosDias : 0);
  const computados = Math.max(0, previstos - descontados);
  const fator = referencia > 0 ? Math.min(1, computados / referencia) : 0;
  return { elegiveis, previstos, referencia, computados, fator };
}

// Quem não tem registro recebe o salário junto da gorjeta, calculado como se
// fosse registrado: diária × dias do MÊS CIVIL da competência. Mês inteiro no vínculo
// conta 30 dias; entrada ou saída no meio conta os dias corridos. Faltas descontam.
function salarioSemRegistro(p: ParticipanteEntrada, regras: RegrasPeriodo): { dias: number; valor: number } {
  if (!p.semRegistro || !p.salarioBase) return { dias: 0, valor: 0 };
  const janela = regras.mesSalario ?? { start: regras.start, end: regras.end };
  const corridos = diasEntre(janela.start, janela.end);
  const elegiveis = diasElegiveis(janela, p.admissao, p.desligamento);
  const base = elegiveis >= corridos ? 30 : Math.min(30, elegiveis);
  const dias = p.diasSalarioOverride ?? Math.max(0, base - (p.faltasSalario ?? p.faltas));
  // Mês cheio paga o salário inteiro; proporcional é a diária arredondada × dias,
  // como o RH faz à mão (2.200 ÷ 30 = 73,33; 9 dias = 659,97, não 660,00).
  if (dias >= 30) return { dias, valor: round2(p.salarioBase) };
  return { dias, valor: round2(round2(p.salarioBase / 30) * dias) };
}

// Adiantamento salarial já pago a quem não tem registro, para descontar do salário:
//   valor = salário base × % do adiantamento, no dia do adiantamento do mês do salário.
// Não recebeu (0) quem entrou depois desse dia ou saiu ANTES dele — quem sai no
// próprio dia recebeu, porque o pagamento sai naquele dia. Nunca passa do salário
// proporcional: com poucos dias no mês, desconta até zerar o salário, não a gorjeta.
// Quem recebe por quinzena não recebe adiantamento: a quinzena prevalece (o cadastro já
// recusa as duas juntas; isto protege o histórico e quem gravou por fora da tela).
export function adiantamentoSemRegistro(p: ParticipanteEntrada, regras: RegrasPeriodo, salarioProporcional: number): number {
  const percent = regras.adiantamentoPercent ?? 0;
  const base = p.salarioBaseAdiantamento !== undefined ? p.salarioBaseAdiantamento : p.salarioBase;
  if (!p.semRegistro || p.pagamentoQuinzenal) return 0;
  // Título lançado: desconta o que foi pago (ou o previsto, se ainda sem baixa) — o valor real,
  // mesmo diferente dos 40% (pago a menor ou a maior no dia).
  if (p.adiantamentoLancado) {
    const valor = p.adiantamentoLancado.pago ?? p.adiantamentoLancado.previsto;
    return Math.max(0, Math.min(round2(salarioProporcional), round2(valor)));
  }
  if (!p.recebeAdiantamento || !base || percent <= 0 || !regras.adiantamentoDia) return 0;
  if (!vinculadoNoDia(p, regras, regras.adiantamentoDia)) return 0;
  return Math.max(0, Math.min(round2(salarioProporcional), round2((base * percent) / 100)));
}

// Dia do mês em que sai a 1ª quinzena de quem recebe por quinzena (a 2ª é o acerto do dia 30).
export const DIA_PRIMEIRA_QUINZENA = 15;

// 1ª quinzena já paga a quem não tem registro e recebe por quinzena, para descontar do acerto:
//   valor = metade do salário base vigente no dia 15, paga no dia 15.
// Mesma regra de datas do adiantamento: não recebeu quem entrou depois do dia 15 ou saiu
// ANTES dele (quem sai no dia 15 recebeu). Nunca passa do salário proporcional do mês.
export function primeiraQuinzenaSemRegistro(p: ParticipanteEntrada, regras: RegrasPeriodo, salarioProporcional: number): number {
  const base = p.salarioBaseQuinzena !== undefined ? p.salarioBaseQuinzena : p.salarioBase;
  if (!p.semRegistro || !p.pagamentoQuinzenal || !base) return 0;
  if (!vinculadoNoDia(p, regras, DIA_PRIMEIRA_QUINZENA)) return 0;
  return Math.max(0, Math.min(round2(salarioProporcional), round2(base / 2)));
}

// A pessoa estava no vínculo no dia X do mês do salário (o pagamento daquele dia saiu para ela)?
// Fora quem entrou depois do dia ou saiu ANTES dele — quem sai no próprio dia recebeu.
function vinculadoNoDia(p: ParticipanteEntrada, regras: RegrasPeriodo, diaDoMes: number): boolean {
  const janela = regras.mesSalario ?? { start: regras.start, end: regras.end };
  const ultimoDia = new Date(Date.UTC(janela.end.getUTCFullYear(), janela.end.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = new Date(Date.UTC(janela.end.getUTCFullYear(), janela.end.getUTCMonth(), Math.min(diaDoMes, ultimoDia)));
  if (dia < janela.start || dia > janela.end) return false;
  // Compara o dia civil (UTC), sem a hora gravada junto da data.
  const soDia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (p.admissao && soDia(p.admissao) > dia.getTime()) return false;
  if (p.desligamento && soDia(p.desligamento) < dia.getTime()) return false;
  return true;
}

// O que já saiu antes do acerto (adiantamento ou 1ª quinzena), somado, nunca passa do salário
// proporcional: com poucos dias no mês, desconta até zerar o salário, não a gorjeta.
function pagoAntesDoAcerto(p: ParticipanteEntrada, regras: RegrasPeriodo, salarioProporcional: number) {
  const adiantamentoSalarial = adiantamentoSemRegistro(p, regras, salarioProporcional);
  const primeiraQuinzena = Math.min(
    primeiraQuinzenaSemRegistro(p, regras, salarioProporcional),
    Math.max(0, round2(salarioProporcional - adiantamentoSalarial)),
  );
  return { adiantamentoSalarial, primeiraQuinzena };
}

// Período fechado não grava o adiantamento: ele é o que explica o total gravado
// (salário + gorjeta líquida + hora extra/noturno − 1ª quinzena − total a pagar). Fechamentos
// de antes do adiantamento dão zero. A hora extra e a 1ª quinzena vêm do retrato (ausente = zero).
export function adiantamentoDoFechado(g: {
  semRegistro: boolean; pagoNaRescisao: boolean; salarioProporcional: number; comissaoLiquida: number; totalAPagar: number;
  adicionais?: number; primeiraQuinzena?: number;
}): number {
  if (!g.semRegistro || g.pagoNaRescisao) return 0;
  return Math.max(0, round2(g.salarioProporcional + g.comissaoLiquida + (g.adicionais ?? 0) - (g.primeiraQuinzena ?? 0) - g.totalAPagar));
}

// Hora extra e adicional noturno a pagar na lista: só quem não tem registro.
function adicionaisSemRegistro(p: ParticipanteEntrada) {
  if (!p.semRegistro) return { valorHoraExtra: 0, valorAdicionalNoturno: 0 };
  return valoresAdicionais(p.salarioBase, p.horaExtraMin ?? 0, p.adicionalNoturnoMin ?? 0);
}

// Gorjeta real só substitui a calculada de quem está no mês, por pontos (e participa).
export function gorjetaRealVale(tipoCalculo: TipoCalculo, kind: "FIXO" | "PONTOS", foraDaGorjeta = false): boolean {
  return !foraDaGorjeta && tipoCalculo === "MES" && kind === "PONTOS";
}

// Por que uma gorjeta real gravada deixou de valer (null = vale). Vira aviso na apuração.
export function motivoGorjetaRealSemEfeito(tipoCalculo: TipoCalculo, kind: "FIXO" | "PONTOS", foraDaGorjeta = false): string | null {
  if (foraDaGorjeta) return "a pessoa não participa mais da gorjeta (só recebe o salário)";
  if (gorjetaRealVale(tipoCalculo, kind)) return null;
  if (tipoCalculo === "FORA_DO_PERIODO") return "ficou fora do período (admissão ou saída mudou)";
  if (tipoCalculo === "RESCISAO" || tipoCalculo === "RESCISAO_QUITADA") return "saiu no período e a gorjeta passou a vir da rescisão";
  return "passou a receber cota fixa";
}

// Sem registro que saiu DEPOIS do fim do ciclo, ainda dentro do mês do salário (ciclo até
// 25/09, saída em 29/09), com a rescisão lançada: decisão do Eli (01/10/2026), "tudo na
// rescisão". Ela paga o mês inteiro — salário, gorjeta do ciclo, vales, adiantamento,
// quinzena, hora extra — mais a gorjeta dos dias depois do ciclo (período seguinte). A
// lista do mês não paga nada; os valores seguem calculados porque a rescisão lê daqui.
export function saiuAposCicloNoMesDoSalario(p: ParticipanteEntrada, regras: RegrasPeriodo): boolean {
  if (!p.semRegistro || !p.rescisaoLancada || !p.rescisaoTudoNaRescisao || !p.desligamento || !regras.mesSalario) return false;
  return p.desligamento > regras.end && p.desligamento <= regras.mesSalario.end;
}

// Fora da gorjeta: nada de rateio nem de pontos. Está no período pelo vínculo no mês do
// salário (o ciclo da gorjeta não importa): sem vínculo no mês, fica fora do período.
// Salário, adiantamento, hora extra e vales seguem a regra de qualquer sem registro.
function calcularForaDaGorjeta(regras: RegrasPeriodo, p: ParticipanteEntrada): ParticipanteCalculado {
  const janela = regras.mesSalario ?? { start: regras.start, end: regras.end };
  const elegiveis = diasElegiveis(janela, p.admissao, p.desligamento);
  const tipoCalculo: TipoCalculo = elegiveis === 0 ? "FORA_DO_PERIODO" : "MES";
  const creditos = round2(p.vales.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0));
  const descontos = round2(p.vales.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0));
  const comissaoLiquida = round2(creditos - descontos);
  const salario = salarioSemRegistro(p, regras);
  const { adiantamentoSalarial, primeiraQuinzena } = pagoAntesDoAcerto(p, regras, salario.valor);
  const { valorHoraExtra, valorAdicionalNoturno } = adicionaisSemRegistro(p);
  // Saiu dentro do ciclo (ou depois dele, no mês do salário) com a rescisão lançada:
  // recebeu tudo lá, como os demais sem registro.
  const pagoNaRescisao = (p.semRegistro && p.rescisaoLancada && p.desligamento != null && p.desligamento <= regras.end)
    || (tipoCalculo === "MES" && saiuAposCicloNoMesDoSalario(p, regras));
  return {
    tipoCalculo, foraDaGorjeta: true,
    diasElegiveis: elegiveis, diasPrevistos: 0, diasReferencia: 0, diasComputados: 0, fatorPresenca: 0,
    pontosApurados: 0, pontosFinais: 0, pontosDireito: 0, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, valorDireito: null, gorjetaCalculada: 0, gorjetaRealAplicada: false,
    valorPonto: 0, rateio: 0, descontos, creditos, comissaoLiquida,
    diasSalario: salario.dias, salarioProporcional: salario.valor, adiantamentoSalarial, primeiraQuinzena,
    valorHoraExtra, valorAdicionalNoturno,
    totalAPagar: pagoNaRescisao ? 0
      : round2(salario.valor - adiantamentoSalarial - primeiraQuinzena + comissaoLiquida + valorHoraExtra + valorAdicionalNoturno),
    rescisaoPendente: false,
    pagoNaRescisao,
  };
}

export function calcularParticipante(regras: RegrasPeriodo, p: ParticipanteEntrada, valorPontoDoMes: number): ParticipanteCalculado {
  if (p.foraDaGorjeta) return calcularForaDaGorjeta(regras, p);
  const { elegiveis, previstos, referencia, computados, fator } = presenca(regras, p);

  const desligadoNoPeriodo = p.desligamento != null && p.desligamento <= regras.end;
  let tipoCalculo: TipoCalculo = "MES";
  if (elegiveis === 0) tipoCalculo = "FORA_DO_PERIODO";
  else if (desligadoNoPeriodo) tipoCalculo = p.rescisaoValorFixo != null ? "RESCISAO_QUITADA" : "RESCISAO";

  const pontosApurados = p.kind === "PONTOS" ? round2(p.basePoints * fator) : 0;
  const pontosFinais = p.kind === "PONTOS" && elegiveis > 0 ? Math.max(0, round2(pontosApurados + p.ajuste)) : 0;

  let valorPonto = valorPontoDoMes;
  let rateio = 0;
  let rescisaoPendente = false;
  let pontosConsumidos = pontosFinais;
  let extraRescisao = 0;
  let pontosDevolvidos = 0;
  let justificativaExtra: string | null = null;
  let valorDireito: number | null = null;
  if (tipoCalculo === "FORA_DO_PERIODO") {
    rateio = 0;
  } else if (p.kind === "FIXO") {
    rateio = round2(p.fixedAmount ?? 0);
  } else if (tipoCalculo === "RESCISAO_QUITADA") {
    // A gorjeta paga vale (pago ÷ valor do ponto) pontos: o ponto da saída, quando se
    // sabe o serviço até lá; senão, o do mês. Abaixo do direito, o resto volta ao
    // saldo; acima, a diferença é extra, com justificativa.
    rateio = round2(p.rescisaoValorFixo ?? 0);
    const pontoDaSaida = p.rescisaoServicoBruto != null ? valorPontoRescisao(regras, p.rescisaoServicoBruto) : null;
    const medida = pontoDaSaida ?? valorPontoDoMes;
    if (pontoDaSaida != null) {
      valorPonto = pontoDaSaida;
      valorDireito = round2(pontosFinais * pontoDaSaida);
    }
    if (medida > 0) {
      pontosConsumidos = round2(rateio / medida);
      extraRescisao = Math.max(0, round2(pontosConsumidos - pontosFinais));
      pontosDevolvidos = Math.max(0, round2(pontosFinais - pontosConsumidos));
      if (extraRescisao > 0) {
        justificativaExtra = `Gorjeta paga na rescisão (${reais(rateio)}) equivale a ${ptsTexto(pontosConsumidos)} pts; `
          + `o direito era ${ptsTexto(pontosFinais)} pts: +${ptsTexto(extraRescisao)} pts de extra.`;
      }
    }
  } else if (tipoCalculo === "RESCISAO") {
    if (p.rescisaoServicoBruto == null) {
      rescisaoPendente = true;
      valorPonto = 0;
    } else {
      valorPonto = valorPontoRescisao(regras, p.rescisaoServicoBruto);
      rateio = round2(pontosFinais * valorPonto);
    }
  } else {
    rateio = round2(pontosFinais * valorPontoDoMes);
  }
  const gorjetaCalculada = rateio;

  // Gorjeta real no lugar da calculada: os outros não mudam (o ponto do mês não depende
  // dela) e a diferença fica no livre para distribuir. Vira pontos pelo ponto do mês.
  const gorjetaRealAplicada = gorjetaRealVale(tipoCalculo, p.kind) && p.gorjetaReal != null;
  if (gorjetaRealAplicada) {
    rateio = round2(p.gorjetaReal ?? 0);
    if (valorPontoDoMes > 0) {
      pontosConsumidos = round2(rateio / valorPontoDoMes);
      extraRescisao = Math.max(0, round2(pontosConsumidos - pontosFinais));
      pontosDevolvidos = Math.max(0, round2(pontosFinais - pontosConsumidos));
      if (extraRescisao > 0) {
        justificativaExtra = `Gorjeta real (${reais(rateio)}) acima da calculada (${reais(gorjetaCalculada)}): +${ptsTexto(extraRescisao)} pts.`;
      }
    }
  }

  const creditos = round2(p.vales.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0));
  const descontos = round2(p.vales.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0));
  const comissaoLiquida = round2(rateio - descontos + creditos);
  const salario = salarioSemRegistro(p, regras);
  const { adiantamentoSalarial, primeiraQuinzena } = pagoAntesDoAcerto(p, regras, salario.valor);
  const { valorHoraExtra, valorAdicionalNoturno } = adicionaisSemRegistro(p);
  const saiuNoPeriodo = tipoCalculo === "RESCISAO" || tipoCalculo === "RESCISAO_QUITADA";
  // Saiu depois do fim do ciclo, antes da folha dele: o termo de rescisão importado neste
  // período já pagou a gorjeta do mês (com os vales descontados). Pontos e vales ficam;
  // a lista só não paga de novo.
  const termoPagouOMes = !p.semRegistro && tipoCalculo === "MES" && p.rescisaoValorFixo != null
    && p.desligamento != null && p.desligamento > regras.end;
  const pagoNaRescisao = p.semRegistro
    ? (saiuNoPeriodo && p.rescisaoLancada) || (tipoCalculo === "MES" && saiuAposCicloNoMesDoSalario(p, regras))
    : tipoCalculo === "RESCISAO_QUITADA" || termoPagouOMes;

  return {
    tipoCalculo,
    foraDaGorjeta: false,
    diasElegiveis: elegiveis,
    diasPrevistos: previstos,
    diasReferencia: referencia,
    diasComputados: computados,
    fatorPresenca: fator,
    pontosApurados,
    pontosFinais: pontosConsumidos,
    pontosDireito: pontosFinais,
    pontosDevolvidos,
    extraRescisao,
    justificativaExtra,
    valorDireito,
    gorjetaCalculada,
    gorjetaRealAplicada,
    valorPonto: round2(valorPonto),
    rateio,
    descontos,
    creditos,
    comissaoLiquida,
    diasSalario: salario.dias,
    salarioProporcional: salario.valor,
    adiantamentoSalarial,
    primeiraQuinzena,
    valorHoraExtra,
    valorAdicionalNoturno,
    // Quem foi pago na rescisão recebe a hora extra lá (apuração da rescisão).
    totalAPagar: pagoNaRescisao ? 0
      : round2(salario.valor - adiantamentoSalarial - primeiraQuinzena + comissaoLiquida + valorHoraExtra + valorAdicionalNoturno),
    rescisaoPendente,
    pagoNaRescisao,
  };
}

export type ResumoRateio = {
  valorPonto: number;
  /** Sem arredondar: é o que multiplica os pontos (e a reserva). */
  valorPontoBruto: number;
  rescisoes: { valor: number; pontos: number };
  pontosDisponiveis: number;
  totalCotasFixas: number;
  distribuido: number;
  saldo: number;
  pontosUsados: number;
  linhas: ParticipanteCalculado[];
};

export function calcularRateio(regras: RegrasPeriodo, participantes: ParticipanteEntrada[]): ResumoRateio {
  const totalCotasFixas = round2(
    participantes.filter((p) => p.kind === "FIXO" && !p.foraDaGorjeta).reduce((a, p) => a + (p.fixedAmount ?? 0), 0),
  );
  // 1ª passada: as rescisões pelo serviço até a saída não dependem do ponto do mês —
  // as calculadas e as quitadas medidas pela saída. As quitadas sem esse serviço ficam fora.
  const previa = participantes.map((p) => calcularParticipante(regras, p, 0));
  // Quitada medida pelo ponto da saída entra com o valor do direito, não com o pago.
  const pesoNaPrevia = (l: ParticipanteCalculado) =>
    l.tipoCalculo === "RESCISAO" ? { valor: l.rateio, pontos: l.pontosFinais }
      : l.valorDireito != null ? { valor: l.valorDireito, pontos: l.pontosDireito }
        : { valor: 0, pontos: 0 };
  const calculadas = {
    valor: round2(previa.reduce((a, l) => a + pesoNaPrevia(l).valor, 0)),
    pontos: round2(previa.reduce((a, l) => a + pesoNaPrevia(l).pontos, 0)),
  };
  // Modo "vai para o livre": as rescisões não saem da conta do ponto do mês.
  const paraSaldo = regras.sobraRescisaoParaSaldo === true;
  const valorPonto = valorPontoMes(regras, totalCotasFixas, paraSaldo ? { valor: 0, pontos: 0 } : calculadas);
  // 2ª passada: quem fica e as quitadas, com o valor do ponto que sobrou.
  const linhas = participantes.map((p) => calcularParticipante(regras, p, valorPonto));
  const ehRescisao = (t: string) => t === "RESCISAO" || t === "RESCISAO_QUITADA";
  const rescisoes = {
    valor: round2(linhas.reduce((a, l) => a + (ehRescisao(l.tipoCalculo) ? l.rateio : 0), 0)),
    // Os pontos que saem do total são os do direito quando medido pela saída.
    pontos: round2(linhas.reduce((a, l) => a + (!ehRescisao(l.tipoCalculo) ? 0 : l.valorDireito != null ? l.pontosDireito : l.pontosFinais), 0)),
  };
  const distribuido = round2(linhas.reduce((a, l) => a + l.rateio, 0));
  return {
    valorPonto: round2(valorPonto),
    valorPontoBruto: valorPonto,
    rescisoes,
    // É o divisor do ponto do mês: no modo "vai para o livre" os pontos das rescisões não saem.
    pontosDisponiveis: round2(paraSaldo ? regras.pointsTotal : regras.pointsTotal - rescisoes.pontos),
    totalCotasFixas,
    distribuido,
    saldo: round2(regras.netPool - distribuido),
    pontosUsados: round2(linhas.reduce((a, l) => a + l.pontosFinais, 0)),
    linhas,
  };
}
