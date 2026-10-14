import { ehRecebida } from "./agile-situacao.js";
import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";
import type { Periodo } from "./agile-analise.report.js";
import type { VendaVisao } from "./agile-analise-visao.report.js";

// "Quando vendemos": média de pessoas e de faturamento por dia da semana, por turno e por hora.
// Tudo em MÉDIA POR DIA OBSERVADO (não em soma): um período com 5 sextas e 4 segundas somaria mais
// sexta só por ter mais sextas no calendário.

export type TurnoId = "ALMOCO" | "JANTAR" | "OUTRO";
export const ROTULO_TURNO: Record<TurnoId, string> = { ALMOCO: "Almoço", JANTAR: "Jantar", OUTRO: "Outro turno" };
export const ROTULO_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

// Quanto de um dia fraco a gente considera "alcançável" em relação ao melhor dia do mesmo turno.
// É uma hipótese de trabalho (a tela diz isso), não uma previsão.
export const META_RELATIVA_AO_MELHOR_DIA = 0.7;
export const SEMANAS_POR_MES = 4.33;
// Menos que isso e o dia da semana é tratado como amostra pequena (não entra na folga).
export const MIN_DIAS_PARA_COMPARAR = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

export function turnoDe(shift: string): TurnoId {
  const t = shift.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("almo")) return "ALMOCO";
  if (t.includes("jant")) return "JANTAR";
  return "OUTRO";
}

const diaDaSemana = (d: Date) => new Date(`${toCalendarDateKey(d)}T00:00:00.000Z`).getUTCDay();
const horaCheia = (h: string | null) => (h && /^\d{1,2}:\d{2}/.test(h) ? h.split(":")[0].padStart(2, "0") : null);

export type TurnoDoDia = {
  turno: "ALMOCO" | "JANTAR";
  rotulo: string;
  diasObservados: number;
  pessoasPorDia: number;
  faturamentoPorDia: number;
  ticketPessoa: number;
};

export type DiaDaSemana = {
  dow: number;
  rotulo: string;
  diasObservados: number;
  pessoasPorDia: number;
  faturamentoPorDia: number;
  ticketPessoa: number;
  turnos: TurnoDoDia[];
};

type Acumulado = { pessoas: number; faturamento: number; vendas: number; comPessoas: number; faturamentoComPessoas: number };
const vazio = (): Acumulado => ({ pessoas: 0, faturamento: 0, vendas: 0, comPessoas: 0, faturamentoComPessoas: 0 });
function somar(a: Acumulado, v: VendaVisao) {
  a.vendas += 1;
  a.faturamento += v.totalAmount;
  if (v.people > 0) {
    a.pessoas += v.people;
    a.comPessoas += 1;
    a.faturamentoComPessoas += v.totalAmount;
  }
}

export function montarDemanda(todas: VendaVisao[], periodo: Periodo) {
  const vendas = todas.filter((v) => ehRecebida(v.saleStatus));

  // Dias distintos em que houve venda: por dia da semana e por (dia da semana, turno).
  const datasPorDia = new Map<number, Set<string>>();
  const datasPorDiaTurno = new Map<string, Set<string>>();
  const acDia = new Map<number, Acumulado>();
  const acDiaTurno = new Map<string, Acumulado>();
  const acCelula = new Map<string, Acumulado>();
  const acTurno = new Map<TurnoId, Acumulado>();
  const acHora = new Map<string, Acumulado>();
  let semHora = 0;

  const pegar = <K>(mapa: Map<K, Acumulado>, k: K) => {
    const atual = mapa.get(k) ?? vazio();
    mapa.set(k, atual);
    return atual;
  };
  const guardarData = (mapa: Map<string, Set<string>>, k: string, data: string) => mapa.set(k, (mapa.get(k) ?? new Set()).add(data));

  for (const v of vendas) {
    const data = toCalendarDateKey(v.movementDate);
    const dow = diaDaSemana(v.movementDate);
    const turno = turnoDe(v.shift);
    datasPorDia.set(dow, (datasPorDia.get(dow) ?? new Set()).add(data));
    guardarData(datasPorDiaTurno, `${dow}|${turno}`, data);
    somar(pegar(acDia, dow), v);
    somar(pegar(acDiaTurno, `${dow}|${turno}`), v);
    somar(pegar(acTurno, turno), v);
    const hora = horaCheia(v.saleHour);
    if (hora === null) {
      semHora += 1;
      continue;
    }
    somar(pegar(acCelula, `${dow}|${hora}`), v);
    somar(pegar(acHora, hora), v);
  }

  const diasObservados = (dow: number) => datasPorDia.get(dow)?.size ?? 0;
  const media = (valor: number, dias: number) => (dias > 0 ? valor / dias : 0);

  const diasDaSemana: DiaDaSemana[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const dias = diasObservados(dow);
    const ac = acDia.get(dow) ?? vazio();
    const turnos: TurnoDoDia[] = (["ALMOCO", "JANTAR"] as const).map((turno) => {
      const diasTurno = datasPorDiaTurno.get(`${dow}|${turno}`)?.size ?? 0;
      const t = acDiaTurno.get(`${dow}|${turno}`) ?? vazio();
      return {
        turno,
        rotulo: ROTULO_TURNO[turno],
        diasObservados: diasTurno,
        pessoasPorDia: round1(media(t.pessoas, diasTurno)),
        faturamentoPorDia: round2(media(t.faturamento, diasTurno)),
        ticketPessoa: round2(razao(t.faturamentoComPessoas, t.pessoas))
      };
    });
    return {
      dow,
      rotulo: ROTULO_DIA[dow],
      diasObservados: dias,
      pessoasPorDia: round1(media(ac.pessoas, dias)),
      faturamentoPorDia: round2(media(ac.faturamento, dias)),
      ticketPessoa: round2(razao(ac.faturamentoComPessoas, ac.pessoas)),
      turnos
    };
  });

  const horas = [...acHora.keys()].sort();
  const celulas = [...acCelula.entries()].map(([chave, ac]) => {
    const [dowTexto, hora] = chave.split("|");
    const dow = Number(dowTexto);
    const dias = diasObservados(dow);
    return {
      dow,
      hora,
      pessoasPorDia: round1(media(ac.pessoas, dias)),
      faturamentoPorDia: round2(media(ac.faturamento, dias)),
      vendas: ac.vendas
    };
  });

  const faturamentoTotal = vendas.reduce((s, v) => s + v.totalAmount, 0);
  const turnos = (["ALMOCO", "JANTAR", "OUTRO"] as const)
    .filter((t) => acTurno.has(t))
    .map((turno) => {
      const ac = acTurno.get(turno) as Acumulado;
      return {
        turno,
        rotulo: ROTULO_TURNO[turno],
        pessoas: ac.pessoas,
        faturamento: round2(ac.faturamento),
        ticketPessoa: round2(razao(ac.faturamentoComPessoas, ac.pessoas)),
        participacao: round4(razao(ac.faturamento, faturamentoTotal))
      };
    });

  const porHora = horas.map((hora) => {
    const ac = acHora.get(hora) as Acumulado;
    return { hora, pessoas: ac.pessoas, faturamento: round2(ac.faturamento), participacao: round4(razao(ac.faturamento, faturamentoTotal)) };
  });

  return {
    periodo,
    cobertura: { vendas: vendas.length, vendasSemHora: semHora, diasComMovimento: new Set(vendas.map((v) => toCalendarDateKey(v.movementDate))).size },
    diasDaSemana,
    mapa: { horas, celulas },
    turnos,
    porHora,
    capacidade: calcularCapacidade(diasDaSemana)
  };
}

// Para cada turno, compara cada dia da semana com o MELHOR dia do mesmo turno. A folga é o que
// falta para o dia chegar a META_RELATIVA_AO_MELHOR_DIA do melhor; o potencial mensal é a folga
// vezes o ticket do próprio dia e as semanas do mês. É hipótese: a tela rotula assim.
function calcularCapacidade(dias: DiaDaSemana[]) {
  const comparaveis = (turno: "ALMOCO" | "JANTAR") =>
    dias
      .map((d) => {
        const t = d.turnos.find((x) => x.turno === turno) as TurnoDoDia;
        return { dow: d.dow, rotulo: d.rotulo, diasObservados: t.diasObservados, pessoasPorDia: t.pessoasPorDia, ticketPessoa: t.ticketPessoa };
      })
      .filter((d) => d.diasObservados >= MIN_DIAS_PARA_COMPARAR && d.pessoasPorDia > 0);

  const turnos = (["ALMOCO", "JANTAR"] as const).map((turno) => {
    const lista = comparaveis(turno);
    if (lista.length < 2) return { turno, rotulo: ROTULO_TURNO[turno], referencia: null, folgas: [] };
    const melhor = lista.reduce((a, b) => (b.pessoasPorDia > a.pessoasPorDia ? b : a));
    const meta = melhor.pessoasPorDia * META_RELATIVA_AO_MELHOR_DIA;
    const folgas = lista
      .filter((d) => d.dow !== melhor.dow && d.pessoasPorDia < meta)
      .map((d) => {
        const pessoasAMais = meta - d.pessoasPorDia;
        return {
          dow: d.dow,
          rotulo: d.rotulo,
          pessoasPorDia: d.pessoasPorDia,
          pctDoMelhor: round4(d.pessoasPorDia / melhor.pessoasPorDia),
          pessoasAMais: round1(pessoasAMais),
          faturamentoMesPotencial: round2(pessoasAMais * d.ticketPessoa * SEMANAS_POR_MES)
        };
      })
      .sort((a, b) => b.faturamentoMesPotencial - a.faturamentoMesPotencial);
    return {
      turno,
      rotulo: ROTULO_TURNO[turno],
      referencia: { dow: melhor.dow, rotulo: melhor.rotulo, pessoasPorDia: melhor.pessoasPorDia, meta: round1(meta) },
      folgas
    };
  });
  return { metaRelativa: META_RELATIVA_AO_MELHOR_DIA, turnos, hipotese: true as const };
}
