// Apuração do ponto pelas regras da CLT. Funções puras: recebem as batidas do dia
// e devolvem o que importa para o fechamento da folha.
//
//   tolerância      até 10 min de diferença no dia não contam (art. 58 §1º); acima disso conta tudo
//   extra           trabalhado acima do previsto; em dia sem jornada prevista (folga, domingo,
//                   feriado) todo o trabalhado é extra
//   atraso          trabalhado abaixo do previsto, com batida no dia → vai para o banco de horas
//   falta           dia previsto sem nenhuma batida e sem abono → desconto em folha
//   noturno         minutos de relógio entre 22h e 5h (a hora reduzida de 52,5 min é aplicada
//                   no valor, em hora-extra.ts)
//
// Domingo trabalhado conta como dia comum (decisão do Eli); extraDescansoMin segue no contrato, mas fica
// sempre zero. FERIADO trabalhado não é pago: a empresa compensa com folga, então todo o trabalhado vira
// crédito no banco de horas (creditoFeriadoMin), sem atraso nem extra a pagar.
//
// MARCAÇÃO ÍMPAR (3 ou mais batidas): como o RHiD, valem só os pares completos e a última batida
// é ignorada, com aviso. Uma batida isolada continua pendente.
//
// DIA PENDENTE: uma batida só, turno impossível (mais de 16h), batidas fora de
// ordem ou horário ilegível NÃO lançam extra, atraso nem falta. Batida faltando não prova que a
// pessoa trabalhou a menos ou a mais; lançar dívida ou crédito aí seria inventar horas. O dia
// aparece como pendente, com o motivo, até alguém corrigir as batidas.

export const TOLERANCIA_DIA_MIN = 10;
export const LIMITE_EXTRA_DIA_MIN = 120;
const INTERVALO_MINIMO_MIN = 60;
const JORNADA_EXIGE_INTERVALO_MIN = 360;
const MIN_DIA = 24 * 60;
const NOTURNO_ATE = 5 * 60;
const NOTURNO_DESDE = 22 * 60;
const TURNO_MAXIMO_MIN = 16 * 60;
const DIA_LONGO_MIN = 12 * 60;

export interface DiaPontoEntrada {
  data: string; // AAAA-MM-DD
  marcacoes: string[]; // HH:mm em ordem: entrada, saída, entrada, saída…
  previstoMin: number; // 0 = folga/descanso
  feriado?: boolean;
  abonado?: boolean; // atestado ou justificativa aceita
  /** O dia tem batida que contradiz a escala (férias, folga do banco, falta…): sem extra nem atraso até resolver. */
  semApuracao?: boolean;
}

export interface DiaPontoApurado {
  data: string;
  trabalhadoMin: number;
  noturnoMin: number;
  extraMin: number;
  extraDescansoMin: number;
  /** Feriado trabalhado: o dia inteiro vira crédito no banco (folga compensatória), não extra a pagar. */
  creditoFeriadoMin: number;
  atrasoMin: number;
  falta: boolean;
  /** Batida pendente ou contradição com a escala: nada foi lançado em extra, atraso ou falta. */
  pendente: boolean;
  avisos: string[];
}

export interface PeriodoPontoApurado {
  dias: DiaPontoApurado[];
  trabalhadoMin: number;
  noturnoMin: number;
  extraMin: number;
  extraDescansoMin: number;
  creditoFeriadoMin: number;
  atrasoMin: number;
  faltas: number;
  diasPendentes: number;
}

function paraMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

interface Intervalo {
  inicio: number;
  fim: number; // pode passar de 1440 quando vira a meia-noite
}

function sobreposicao(a: Intervalo, deIni: number, deFim: number): number {
  return Math.max(0, Math.min(a.fim, deFim) - Math.max(a.inicio, deIni));
}

function minutosNoturnos(i: Intervalo): number {
  return sobreposicao(i, 0, NOTURNO_ATE) + sobreposicao(i, NOTURNO_DESDE, MIN_DIA + NOTURNO_ATE);
}

const viraMeiaNoite = (i: Intervalo) => Math.floor((i.fim - 1) / MIN_DIA) > Math.floor(i.inicio / MIN_DIA);

interface Leitura {
  intervalos: Intervalo[];
  pendente: boolean;
}

function lerIntervalos(marcacoes: string[], avisos: string[]): Leitura {
  let pendente = false;
  const lidas: number[] = [];
  for (const texto of marcacoes) {
    const min = paraMinutos(texto);
    if (min == null) {
      avisos.push(`Horário inválido: "${texto}".`);
      pendente = true;
    } else lidas.push(min);
  }
  // Duas batidas no mesmo minuto são um toque duplo no relógio: vale uma só.
  const horas = lidas.filter((h, i) => i === 0 || h !== lidas[i - 1]);
  if (horas.length < lidas.length) avisos.push("Batida repetida no mesmo minuto.");
  if (horas.length % 2 === 1) {
    if (horas.length === 1) {
      avisos.push("Marcação ímpar: falta uma batida.");
      pendente = true;
    } else {
      // Como o RHiD: só valem os pares completos; a batida sobrando é ignorada, sem travar o dia.
      avisos.push("Marcação ímpar: a última batida foi ignorada, como no RHiD. Corrija se faltar uma.");
      horas.pop();
    }
  }

  const intervalos: Intervalo[] = [];
  let deslocamento = 0; // dias já virados, em minutos
  for (let i = 0; i + 1 < horas.length; i += 2) {
    let inicio = horas[i] + deslocamento;
    const anterior = intervalos[intervalos.length - 1];
    if (anterior && inicio < anterior.fim) {
      // Só faz sentido recomeçar "no dia seguinte" se o turno anterior atravessou a meia-noite.
      if (!viraMeiaNoite(anterior)) {
        avisos.push("Batidas fora de ordem: confira os horários.");
        pendente = true;
      }
      deslocamento += MIN_DIA;
      inicio += MIN_DIA;
    }
    let fim = horas[i + 1] + deslocamento;
    if (fim <= inicio) {
      deslocamento += MIN_DIA;
      fim += MIN_DIA;
    }
    if (fim - inicio > TURNO_MAXIMO_MIN) {
      avisos.push("Turno de mais de 16h: confira as batidas.");
      pendente = true;
      continue;
    }
    intervalos.push({ inicio, fim });
  }
  return { intervalos, pendente };
}

function avisoIntervalo(intervalos: Intervalo[], trabalhadoMin: number): string | null {
  if (trabalhadoMin <= JORNADA_EXIGE_INTERVALO_MIN || intervalos.length < 2) return null;
  const folga = intervalos[1].inicio - intervalos[0].fim;
  return folga < INTERVALO_MINIMO_MIN ? "Intervalo menor que 1h em jornada acima de 6h." : null;
}

export function apurarDia(entrada: DiaPontoEntrada): DiaPontoApurado {
  const avisos: string[] = [];
  const { intervalos, pendente: pendentePorBatida } = lerIntervalos(entrada.marcacoes, avisos);
  const trabalhadoMin = intervalos.reduce((s, i) => s + (i.fim - i.inicio), 0);
  const noturnoMin = intervalos.reduce((s, i) => s + minutosNoturnos(i), 0);
  const temBatida = entrada.marcacoes.length > 0;
  const pendente = temBatida && (pendentePorBatida || entrada.semApuracao === true);
  const base = { data: entrada.data, trabalhadoMin, noturnoMin, avisos };

  const intervalo = avisoIntervalo(intervalos, trabalhadoMin);
  if (intervalo) avisos.push(intervalo);
  if (intervalos.length === 1 && trabalhadoMin > JORNADA_EXIGE_INTERVALO_MIN && !pendente) {
    avisos.push("Só duas batidas em jornada longa: o intervalo não foi descontado.");
  }
  if (trabalhadoMin > DIA_LONGO_MIN) avisos.push("Mais de 12h trabalhadas no dia: confira se falta uma batida.");

  if (pendente) {
    avisos.push("Sem apuração até corrigir as batidas.");
    return { ...base, extraMin: 0, extraDescansoMin: 0, creditoFeriadoMin: 0, atrasoMin: 0, falta: false, pendente: true };
  }

  // Feriado trabalhado: não é extra a pagar; o dia todo entra no banco como folga compensatória.
  if (entrada.feriado && temBatida) {
    return { ...base, extraMin: 0, extraDescansoMin: 0, creditoFeriadoMin: trabalhadoMin, atrasoMin: 0, falta: false, pendente: false };
  }

  if (entrada.previstoMin <= 0) {
    // Decisão do Eli: domingo e feriado trabalhados contam como dia comum (extra comum).
    return {
      ...base,
      extraMin: trabalhadoMin,
      extraDescansoMin: 0,
      creditoFeriadoMin: 0,
      atrasoMin: 0,
      falta: false,
      pendente: false,
    };
  }

  if (!temBatida) {
    return { ...base, extraMin: 0, extraDescansoMin: 0, creditoFeriadoMin: 0, atrasoMin: 0, falta: !entrada.abonado, pendente: false };
  }

  const diferenca = trabalhadoMin - entrada.previstoMin;
  const contaDiferenca = Math.abs(diferenca) > TOLERANCIA_DIA_MIN;
  const extraMin = contaDiferenca && diferenca > 0 ? diferenca : 0;
  const atrasoMin = contaDiferenca && diferenca < 0 && !entrada.abonado ? -diferenca : 0;
  if (extraMin > LIMITE_EXTRA_DIA_MIN) avisos.push("Mais de 2h extras no dia.");
  return { ...base, extraMin, extraDescansoMin: 0, creditoFeriadoMin: 0, atrasoMin, falta: false, pendente: false };
}

export function apurarPeriodo(entradas: DiaPontoEntrada[]): PeriodoPontoApurado {
  const dias = entradas.map(apurarDia);
  const soma = (campo: "trabalhadoMin" | "noturnoMin" | "extraMin" | "extraDescansoMin" | "creditoFeriadoMin" | "atrasoMin") =>
    dias.reduce((s, d) => s + d[campo], 0);
  return {
    dias,
    trabalhadoMin: soma("trabalhadoMin"),
    noturnoMin: soma("noturnoMin"),
    extraMin: soma("extraMin"),
    extraDescansoMin: soma("extraDescansoMin"),
    creditoFeriadoMin: soma("creditoFeriadoMin"),
    atrasoMin: soma("atrasoMin"),
    faltas: dias.filter((d) => d.falta).length,
    diasPendentes: dias.filter((d) => d.pendente).length,
  };
}
