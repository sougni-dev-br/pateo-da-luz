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
    return { semJornada: true, mesMontado, periodo: vazio, resumo: resumirFechamento(vazio, opcoes), debitoFolgaMin: 0, avisosDia: [] };
  }

  const dias = diasDoMes(p.year, p.month).filter(
    (d) => (!p.admissao || d >= p.admissao) && (!p.desligamento || d <= p.desligamento) && (!p.ate || d <= p.ate),
  );
  const montadas = dias.map((data) =>
    entradaDoDia({
      data,
      marcacoes: p.batidasPorDia.get(data) ?? [],
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
  return { semJornada: false, mesMontado, periodo, resumo, debitoFolgaMin, avisosDia };
}
