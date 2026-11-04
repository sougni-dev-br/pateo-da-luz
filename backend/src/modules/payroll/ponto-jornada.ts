// Liga o cadastro do funcionário e a escala ao cálculo do ponto: define a jornada prevista
// de cada dia e se ele está abonado, de folga ou sem lançamento.
//
//   TURNO / EVENTO                        jornada do cadastro
//   FOLGA / FOLGA_FERIADO / FERIAS /
//   AFASTAMENTO                           sem jornada prevista
//   FOLGA_BANCO_HORAS                     sem jornada prevista; a jornada do dia sai do banco
//   FOLGA_FERIADO sem batida              idem (compensa o feriado trabalhado, que entrou no banco)
//   ATESTADO                              jornada prevista, dia abonado
//   FALTA                                 jornada prevista (sem batida vira falta)
//   sem lançamento                        jornada prevista, mas sem batida NÃO vira falta (aviso)

import type { DiaPontoEntrada } from "./ponto-calc.js";

export interface JornadaCadastro {
  jornadaInicio: string | null;
  jornadaFim: string | null;
  intervaloInicio: string | null;
  intervaloFim: string | null;
}

export type TipoDiaEscala =
  | "FOLGA"
  | "FOLGA_FERIADO"
  | "FOLGA_BANCO_HORAS"
  | "TURNO"
  | "EVENTO"
  | "FERIAS"
  | "FALTA"
  | "ATESTADO"
  | "AFASTAMENTO";

export const AVISO_SEM_ESCALA = "Dia sem lançamento na escala.";
export const AVISO_TRABALHOU_NA_FOLGA = (rotulo: string) => `Trabalhou em dia de ${rotulo} na Escala: confira se a Escala ou a batida está certa.`;
const MIN_DIA = 24 * 60;
const JORNADA_EXIGE_INTERVALO_MIN = 6 * 60;
const INTERVALO_PADRAO_MIN = 60;
// Turno de 10h ou mais (ex.: 12:00–22:00) é o de intervalo longo: 2h de pausa, jornada de 8h (decisão do Eli).
const TURNO_COM_INTERVALO_LONGO_MIN = 10 * 60;
const INTERVALO_LONGO_MIN = 2 * 60;

function paraMinutos(hhmm: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const duracao = (ini: number, fim: number): number => (fim > ini ? fim - ini : fim + MIN_DIA - ini);

/** Jornada diária em minutos; null se entrada e saída não estão cadastradas ou são iguais (turno inválido). */
export function jornadaDiariaMin(j: JornadaCadastro): number | null {
  const ini = paraMinutos(j.jornadaInicio);
  const fim = paraMinutos(j.jornadaFim);
  if (ini == null || fim == null || ini === fim) return null;
  const total = duracao(ini, fim);
  // Como no RHiD: o horário é turno menos a pausa. O intervalo do contrato não entra (a pausa não é fixa e
  // o trabalhado já vem das batidas); turno acima de 6h leva 1h (CLT, art. 71), o de 10h ou mais leva 2h. Jornada do restaurante: 07:20 (6x1).
  const intervalo = total >= TURNO_COM_INTERVALO_LONGO_MIN ? INTERVALO_LONGO_MIN : total > JORNADA_EXIGE_INTERVALO_MIN ? INTERVALO_PADRAO_MIN : 0;
  return Math.max(0, total - intervalo);
}

// ─── Jornada do dia ─────────────────────────────────────────────────────────────

const JORNADA_TURNO_LONGO_MIN = 8 * 60;
const INTERVALO_DO_TURNO_LONGO_MIN = 90;
const PRESENCA_DO_TURNO_LONGO_MIN = 10 * 60;

/**
 * A jornada de um dia pode ser maior que a do cadastro: quem faz o turno de 2h de intervalo (ex.: 12:00–22:00) tem jornada de 8:00.
 * O ERP reconhece esse turno pelas batidas do próprio dia: intervalo tirado de 1:30 ou mais, ou (sem batidas de intervalo)
 * presença de 10h ou mais. Nunca reduz a jornada do cadastro. Mesmo critério de jornadaDoDiaMin no frontend.
 */
export function jornadaDoDiaMin(jornadaCadastroMin: number, marcacoes: string[]): number {
  if (jornadaCadastroMin >= JORNADA_TURNO_LONGO_MIN || marcacoes.length < 2 || marcacoes.length % 2 !== 0) return jornadaCadastroMin;
  const horas: number[] = [];
  let deslocamento = 0;
  for (const marca of marcacoes) {
    const min = paraMinutos(marca);
    if (min == null) return jornadaCadastroMin;
    let t = min + deslocamento;
    if (horas.length > 0 && t < horas[horas.length - 1]) {
      deslocamento += MIN_DIA;
      t += MIN_DIA;
    }
    horas.push(t);
  }
  const presenca = horas[horas.length - 1] - horas[0];
  let maiorIntervalo = 0;
  for (let i = 1; i + 1 < horas.length; i += 2) maiorIntervalo = Math.max(maiorIntervalo, horas[i + 1] - horas[i]);
  const turnoLongo = maiorIntervalo >= INTERVALO_DO_TURNO_LONGO_MIN || (marcacoes.length === 2 && presenca >= PRESENCA_DO_TURNO_LONGO_MIN);
  return turnoLongo ? JORNADA_TURNO_LONGO_MIN : jornadaCadastroMin;
}

export interface EntradaDoDiaParams {
  data: string;
  marcacoes: string[];
  jornada: JornadaCadastro;
  tipoEscala: TipoDiaEscala | null;
  /** Horas do dia abonadas (atestado de horas etc.): só valem para o dia com batidas. */
  abonoMin?: number;
  /** O mês tem escala montada para a pessoa: dia sem marca vale como dia trabalhado (é assim que a Escala, a gorjeta e a folha leem). */
  mesMontado?: boolean;
  feriado?: boolean;
}

export interface EntradaDoDia {
  entrada: DiaPontoEntrada | null; // null = não dá para apurar (jornada não cadastrada)
  debitoBancoMin: number; // folga tirada contra o banco de horas
  avisos: string[];
}

const SEM_JORNADA: ReadonlySet<TipoDiaEscala> = new Set(["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "FERIAS", "AFASTAMENTO"]);

export function entradaDoDia(p: EntradaDoDiaParams): EntradaDoDia {
  const jornadaCadastroMin = jornadaDiariaMin(p.jornada);
  if (jornadaCadastroMin == null) return { entrada: null, debitoBancoMin: 0, avisos: ["Jornada não cadastrada."] };
  const jornadaMin = jornadaDoDiaMin(jornadaCadastroMin, p.marcacoes);

  const base = { data: p.data, marcacoes: p.marcacoes, ...(p.feriado ? { feriado: true } : {}), ...(p.abonoMin && p.marcacoes.length > 0 ? { abonoMin: p.abonoMin } : {}) };
  const tipo = p.tipoEscala;

  const temBatida = p.marcacoes.length > 0;
  if (tipo && SEM_JORNADA.has(tipo)) {
    // Batida em dia de folga do banco, férias ou afastamento contradiz a escala: não apura nem debita o banco.
    if (temBatida && (tipo === "FOLGA_BANCO_HORAS" || tipo === "FERIAS" || tipo === "AFASTAMENTO")) {
      const conselho = tipo === "FOLGA_BANCO_HORAS" ? "desfaça a folga ou apague as batidas" : "corrija a escala ou as batidas";
      return { entrada: { ...base, previstoMin: 0, semApuracao: true }, debitoBancoMin: 0, avisos: [`Há batida em dia de ${ROTULO_DO_TIPO[tipo]}: ${conselho}.`] };
    }
    // Folga do banco e folga de feriado (a compensação do feriado trabalhado, que entrou no banco) tiram a jornada do dia do saldo.
    // Com batida, a folga de feriado não foi tirada: o trabalhado segue como extra e nada sai do banco.
    const tiraDoBanco = tipo === "FOLGA_BANCO_HORAS" || (tipo === "FOLGA_FERIADO" && !temBatida);
    // A Escala é o que todos sabem: quem bateu ponto num dia em que ela diz folga precisa ser conferido (o trabalhado segue como extra).
    const trabalhouNaFolga = temBatida && (tipo === "FOLGA" || tipo === "FOLGA_FERIADO");
    return {
      entrada: { ...base, previstoMin: 0 },
      debitoBancoMin: tiraDoBanco ? jornadaMin : 0,
      avisos: trabalhouNaFolga ? [AVISO_TRABALHOU_NA_FOLGA(ROTULO_DO_TIPO[tipo])] : [],
    };
  }
  if (tipo === "FALTA" && temBatida) {
    return { entrada: { ...base, previstoMin: jornadaMin, semApuracao: true }, debitoBancoMin: 0, avisos: ["Dia marcado como falta na Escala, mas tem batida: corrija a escala ou as batidas."] };
  }
  if (tipo === "ATESTADO") {
    return { entrada: { ...base, previstoMin: jornadaMin, abonado: true }, debitoBancoMin: 0, avisos: [] };
  }
  if (tipo === null) {
    if (p.mesMontado) return { entrada: { ...base, previstoMin: jornadaMin }, debitoBancoMin: 0, avisos: [] };
    const semBatida = p.marcacoes.length === 0;
    return {
      entrada: { ...base, previstoMin: jornadaMin, ...(semBatida ? { abonado: true } : {}) },
      debitoBancoMin: 0,
      avisos: [AVISO_SEM_ESCALA],
    };
  }
  return { entrada: { ...base, previstoMin: jornadaMin }, debitoBancoMin: 0, avisos: [] };
}

// ─── Folga tirada contra o banco de horas ────────────────────────────────────────

const ROTULO_DO_TIPO: Record<TipoDiaEscala, string> = {
  FOLGA: "folga",
  FOLGA_FERIADO: "folga de feriado",
  FOLGA_BANCO_HORAS: "folga do banco de horas",
  TURNO: "turno",
  EVENTO: "evento",
  FERIAS: "férias",
  FALTA: "falta",
  ATESTADO: "atestado",
  AFASTAMENTO: "afastamento",
};

export type DecisaoFolgaBanco =
  | { acao: "marcar"; antes: TipoDiaEscala | null }
  | { acao: "desmarcar" }
  | { acao: "nada" }
  | { acao: "recusar"; motivo: string };

const PODE_VIRAR_FOLGA_DO_BANCO: ReadonlySet<TipoDiaEscala | null> = new Set([null, "TURNO", "EVENTO"]);

/** O que fazer com o dia quando se marca (ou desfaz) uma folga contra o banco de horas. */
export function decidirFolgaBanco(p: { ativo: boolean; tipoAtual: TipoDiaEscala | null; temBatidas: boolean }): DecisaoFolgaBanco {
  const jaEFolgaDoBanco = p.tipoAtual === "FOLGA_BANCO_HORAS";
  if (!p.ativo) return jaEFolgaDoBanco ? { acao: "desmarcar" } : { acao: "nada" };
  if (jaEFolgaDoBanco) return { acao: "nada" };
  if (p.temBatidas) return { acao: "recusar", motivo: "Esse dia tem batidas lançadas. Apague as batidas antes de usar o banco de horas." };
  if (!PODE_VIRAR_FOLGA_DO_BANCO.has(p.tipoAtual)) {
    return { acao: "recusar", motivo: `Esse dia já está como ${ROTULO_DO_TIPO[p.tipoAtual as TipoDiaEscala]} na escala.` };
  }
  return { acao: "marcar", antes: p.tipoAtual };
}

// ─── Turno da pessoa: o da Escala manda, o do contrato é reserva ─────────────────

export interface DadosDeTurno extends JornadaCadastro {
  /** Turno real da Escala (Employee.shiftStart/shiftEnd). */
  shiftStart: string | null;
  shiftEnd: string | null;
}

export interface JornadaDaPessoa {
  jornada: JornadaCadastro;
  fonte: "escala" | "contrato";
}

/**
 * Entrada e saída vêm do turno da Escala (a ficha de registro guarda a jornada do contrato só para
 * consulta). Sem turno na Escala, cai para o contrato. O intervalo só existe no contrato.
 */
export function jornadaDaPessoa(f: DadosDeTurno): JornadaDaPessoa {
  const turnoDaEscala = paraMinutos(f.shiftStart) != null && paraMinutos(f.shiftEnd) != null;
  return {
    fonte: turnoDaEscala ? "escala" : "contrato",
    jornada: {
      jornadaInicio: turnoDaEscala ? f.shiftStart : f.jornadaInicio,
      jornadaFim: turnoDaEscala ? f.shiftEnd : f.jornadaFim,
      intervaloInicio: f.intervaloInicio,
      intervaloFim: f.intervaloFim,
    },
  };
}

/** "08:00–17:00", ou null se a jornada não tem entrada e saída legíveis. */
export function rotuloTurno(j: JornadaCadastro): string | null {
  const [ini, fim] = [paraMinutos(j.jornadaInicio), paraMinutos(j.jornadaFim)];
  return ini == null || fim == null ? null : `${j.jornadaInicio}–${j.jornadaFim}`;
}
