// Apuração de um mês inteiro de uma pessoa: percorre os dias do vínculo, cruza batidas,
// escala e feriados, e fecha o banco de horas. Função pura: quem lê do banco é o serviço.

import { apurarPeriodo, type PeriodoPontoApurado } from "./ponto-calc.js";
import { resumirFechamento, type ResumoFechamento } from "./ponto-banco.js";
import { AVISO_SEM_ESCALA, entradaDoDia, jornadaDiariaMin, type JornadaCadastro, type TipoDiaEscala } from "./ponto-jornada.js";

export interface MesPessoaParams {
  year: number;
  month: number;
  jornada: JornadaCadastro;
  batidasPorDia: ReadonlyMap<string, string[]>; // AAAA-MM-DD → marcações
  /** Horas abonadas por dia (AAAA-MM-DD → minutos): atestado de horas, médico do trabalho etc. */
  abonoPorDia?: ReadonlyMap<string, number>;
  escalaPorDia: ReadonlyMap<string, TipoDiaEscala>;
  feriados: ReadonlySet<string>; // MM-DD
  admissao: string | null; // AAAA-MM-DD
  desligamento: string | null;
  saldoInicialMin: number;
  /** Último dia a apurar (AAAA-MM-DD): dias futuros não geram falta nem atraso. */
  ate?: string;
  /** A pessoa monta escala (includeInSchedule). Fora dela, "sem marca" não quer dizer "trabalhou". */
  naEscala?: boolean;
  /** A Escala tem marca do mês que não foi o próprio Ponto que gravou. Sem isto, qualquer marca em `escalaPorDia` conta. */
  escalaMontada?: boolean;
}

export interface AvisoDia {
  data: string;
  avisos: string[];
}

export interface MesPessoa {
  semJornada: boolean;
  /** Escala montada, mas nenhuma batida lançada no mês (relógio ou papel): não dá para apurar, e nada vira falta. */
  semLancamento: boolean;
  /** Há escala montada para a pessoa neste mês (pelo menos uma marca): sem marca = dia trabalhado. */
  mesMontado: boolean;
  periodo: PeriodoPontoApurado;
  resumo: ResumoFechamento;
  debitoFolgaMin: number;
  avisosDia: AvisoDia[];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function diasDoMes(year: number, month: number): string[] {
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
}

export function apurarMesPessoa(p: MesPessoaParams): MesPessoa {
  const opcoes = { saldoInicialMin: p.saldoInicialMin, debitoFolgaMin: 0 };
  // Mesma regra da Escala: o mês só conta como montado para quem monta escala e já tem marca nele.
  const mesMontado = (p.naEscala ?? true) && (p.escalaMontada ?? p.escalaPorDia.size > 0);
  const vazio = apurarPeriodo([]);
  if (jornadaDiariaMin(p.jornada) == null) {
    return { semJornada: true, semLancamento: false, mesMontado, periodo: vazio, resumo: resumirFechamento(vazio, opcoes), debitoFolgaMin: 0, avisosDia: [] };
  }

  // Quem monta escala e não tem NENHUMA batida no mês é papel ainda não lançado, não 24 faltas: nada é apurado.
  if (mesMontado && p.batidasPorDia.size === 0) {
    return { semJornada: false, semLancamento: true, mesMontado, periodo: vazio, resumo: resumirFechamento(vazio, opcoes), debitoFolgaMin: 0, avisosDia: [] };
  }

  const dias = diasDoMes(p.year, p.month).filter(
    (d) => (!p.admissao || d >= p.admissao) && (!p.desligamento || d <= p.desligamento) && (!p.ate || d <= p.ate),
  );
  const montadas = dias.map((data) =>
    entradaDoDia({
      data,
      marcacoes: p.batidasPorDia.get(data) ?? [],
      abonoMin: p.abonoPorDia?.get(data) ?? 0,
      jornada: p.jornada,
      tipoEscala: p.escalaPorDia.get(data) ?? null,
      mesMontado,
      feriado: p.feriados.has(data.slice(5)),
    }),
  );

  const periodo = apurarPeriodo(montadas.flatMap((m) => (m.entrada ? [m.entrada] : [])));
  const debitoFolgaMin = montadas.reduce((s, m) => s + m.debitoBancoMin, 0);
  const avisosDia = periodo.dias
    .map((d, i) => ({ data: d.data, avisos: [...montadas[i].avisos, ...d.avisos] }))
    .filter((a) => a.avisos.length > 0);

  const resumo = { ...resumirFechamento(periodo, { saldoInicialMin: p.saldoInicialMin, debitoFolgaMin }), diasComAviso: avisosDia.filter((a) => a.avisos.some((x) => x !== AVISO_SEM_ESCALA)).length };
  return { semJornada: false, semLancamento: false, mesMontado, periodo, resumo, debitoFolgaMin, avisosDia };
}
