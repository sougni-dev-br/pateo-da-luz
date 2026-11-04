// Formatação e entrada de horários da tela de Ponto. Funções puras.

/** Minutos → "h:mm" (ex.: 90 → "1:30"); negativos ganham sinal (devendo). */
export function fmtMin(min: number): string {
  const sinal = min < 0 ? "−" : "";
  const abs = Math.abs(Math.round(min));
  return `${sinal}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Motivos de abono de horas, na ordem em que aparecem na tela (o texto vai para o RH). */
export const MOTIVOS_DE_ABONO: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ATESTADO_HORAS", label: "Atestado médico (horas)" },
  { value: "MEDICO_TRABALHO", label: "Médico do trabalho" },
  { value: "ACOMPANHAR_FAMILIAR", label: "Acompanhar familiar" },
  { value: "OUTRO", label: "Outro (com observação)" },
];
export const ROTULO_DO_ABONO = (motivo: string | null | undefined) => MOTIVOS_DE_ABONO.find((m) => m.value === motivo)?.label ?? "abono";

/** "3:01", "301" ou "3h01" → 181 minutos; vazio ou ilegível → null. */
export function minutosDoHorario(texto: string): number | null {
  const pronto = normalizarHorario(texto);
  if (!pronto) return null;
  return Number(pronto.slice(0, 2)) * 60 + Number(pronto.slice(3, 5));
}

const TURNO_LONGO_JORNADA_MIN = 8 * 60;

/** Jornada do dia pelas batidas: turno de 2h de intervalo (intervalo de 1:30 ou mais, ou só entrada e saída com 10h ou mais) = 8:00. Mesmo critério do servidor (ponto-jornada.ts). */
export function jornadaDoDiaMin(jornadaCadastroMin: number, batidas: string[]): number {
  if (jornadaCadastroMin >= TURNO_LONGO_JORNADA_MIN || batidas.length < 2 || batidas.length % 2 !== 0) return jornadaCadastroMin;
  const horas: number[] = [];
  let deslocamento = 0;
  for (const b of batidas) {
    const h = normalizarHorario(b);
    if (h === null) return jornadaCadastroMin;
    let t = Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) + deslocamento;
    if (horas.length > 0 && t < horas[horas.length - 1]) {
      deslocamento += MIN_DIA;
      t += MIN_DIA;
    }
    horas.push(t);
  }
  let maiorIntervalo = 0;
  for (let i = 1; i + 1 < horas.length; i += 2) maiorIntervalo = Math.max(maiorIntervalo, horas[i + 1] - horas[i]);
  const longo = maiorIntervalo >= 90 || (batidas.length === 2 && horas[1] - horas[0] >= 10 * 60);
  return longo ? TURNO_LONGO_JORNADA_MIN : jornadaCadastroMin;
}

/** Aceita "800", "8:00", "8h30", "8" e "0830" e devolve "HH:mm"; vazio ou ilegível → null. */
export function normalizarHorario(texto: string): string | null {
  const s = texto.trim().toLowerCase().replace("h", ":").replace(/:$/, "");
  if (!s) return null;
  let h: number;
  let m: number;
  const comDoisPontos = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (comDoisPontos) {
    h = Number(comDoisPontos[1]);
    m = Number(comDoisPontos[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2));
    m = Number(s.slice(-2));
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Os quatro campos do dia → batidas em ordem, sem os vazios. `null` se algum for ilegível. */
export function batidasDosCampos(campos: string[]): string[] | null {
  const batidas: string[] = [];
  for (const c of campos) {
    if (!c.trim()) continue;
    const h = normalizarHorario(c);
    if (h === null) return null;
    batidas.push(h);
  }
  return batidas;
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "2026-10-05" → "seg 05/10". */
export function rotuloDoDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return `${SEMANA[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function diasDoMes(year: number, month: number): string[] {
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Mesmo texto que o backend usa para o dia sem lançamento na escala (aviso só informativo). */
export const AVISO_SEM_ESCALA = "Dia sem lançamento na escala.";

const MIN_DIA = 24 * 60;
const TURNO_MAXIMO_MIN = 16 * 60;

export interface ResumoDoDia {
  trabalhadoMin: number;
  avisos: string[];
  /** A saída é no dia seguinte (turno que passa da meia-noite). */
  viraNoite: boolean;
}

/**
 * A mesma conta do servidor para o dia (pares entrada/saída, virada de meia-noite, toque duplo),
 * só para ela conferir o que digitou. O número oficial é o do Fechamento.
 */
export function resumoDoDia(batidas: string[]): ResumoDoDia {
  const lidas = batidas.map(normalizarHorario).filter((h): h is string => h !== null).map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
  const horas = lidas.filter((h, i) => i === 0 || h !== lidas[i - 1]);
  const avisos: string[] = [];
  if (horas.length % 2 === 1) avisos.push("Falta uma batida.");

  let trabalhadoMin = 0;
  let deslocamento = 0;
  let fimAnterior = -1;
  let viraNoite = false;
  for (let i = 0; i + 1 < horas.length; i += 2) {
    let inicio = horas[i] + deslocamento;
    if (inicio < fimAnterior) {
      deslocamento += MIN_DIA;
      inicio += MIN_DIA;
    }
    let fim = horas[i + 1] + deslocamento;
    if (fim <= inicio) {
      deslocamento += MIN_DIA;
      fim += MIN_DIA;
    }
    if (fim - inicio > TURNO_MAXIMO_MIN) {
      avisos.push("Mais de 16h seguidas: confira os horários.");
      continue;
    }
    trabalhadoMin += fim - inicio;
    fimAnterior = fim;
    if (fim >= MIN_DIA) viraNoite = true;
  }
  return { trabalhadoMin, avisos, viraNoite };
}

/** Como o tipo do dia na escala aparece na grade do papel. */
export const ROTULO_ESCALA: Record<string, string> = {
  FOLGA: "folga",
  FOLGA_FERIADO: "folga de feriado",
  FOLGA_BANCO_HORAS: "folga do banco",
  FERIAS: "férias",
  FALTA: "falta",
  ATESTADO: "atestado",
  AFASTAMENTO: "afastamento",
};

/** Dias em que dá para usar o banco de horas: turno, evento ou sem lançamento na escala. */
export const PODE_USAR_BANCO = (tipo: string | undefined) => tipo === undefined || tipo === "TURNO" || tipo === "EVENTO";

/** "09:00–18:00" → "09–18" (minutos zerados saem), para caber na linha da grade. */
export function turnoCurto(turno: string | null): string {
  return turno ? turno.replace(/:00/g, "") : "";
}
