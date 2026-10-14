import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";
import { ehRecebida } from "./agile-situacao.js";
import { calcularIndicadores, type Indicadores, type VendaVisao } from "./agile-analise-visao.report.js";

// Metas mensais do salão: o que foi definido, onde o mês está e se o ritmo chega lá. O ritmo é por
// DIA DA SEMANA (quinta e domingo vendem muito diferente) e usa só dias que costumam abrir.

export const INDICADORES_DE_META = ["faturamento", "pessoas", "ticketPessoa", "perdaPct"] as const;
export type IndicadorDeMeta = (typeof INDICADORES_DE_META)[number];

const UM_DIA_MS = 24 * 60 * 60 * 1000;
// Janela do ritmo: oito semanas fechadas antes de hoje.
export const DIAS_DA_JANELA_DE_RITMO = 56;
// Menos dias com movimento que isso e o ritmo não é confiável: sem projeção.
export const MIN_DIAS_PARA_PROJETAR = 14;
// Um dia da semana que abriu em menos da metade das vezes na janela é tratado como fechado.
export const MIN_FREQUENCIA_DIA_ABERTO = 0.5;
// Ticket e perda são taxas: com menos dias que isso o número ainda oscila demais.
export const MIN_DIAS_PARA_TAXA = 3;
// Mês do histórico só entra na referência se teve movimento em pelo menos esses dias.
export const MIN_DIAS_MES_DE_REFERENCIA = 10;
export const MESES_DA_MEDIA_DE_REFERENCIA = 3;

export type Situacao = "sem-meta" | "sem-dado" | "atingida" | "no-ritmo" | "abaixo";

export type MesDoHistorico = { ano: number; mes: number; indicadores: Pick<Indicadores, "diasComMovimento" | "faturamento" | "pessoas" | "ticketPessoa"> };

type Entrada = {
  ano: number;
  mes: number;
  // Dia de hoje (São Paulo), AAAA-MM-DD. Hoje fica de fora do realizado: o dia em andamento é parcial.
  hoje: string;
  vendasMes: VendaVisao[];
  // Vendas dos DIAS_DA_JANELA_DE_RITMO dias fechados antes de hoje.
  vendasRitmo: VendaVisao[];
  itensCanceladosMes: number;
  historico: MesDoHistorico[];
  metas: Partial<Record<IndicadorDeMeta, number>>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (dia: string) => Date.parse(`${dia}T00:00:00.000Z`);
const diaDaSemana = (dia: string) => new Date(ms(dia)).getUTCDay();

export function limitesDoMes(ano: number, mes: number) {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { inicio, fim: `${ano}-${String(mes).padStart(2, "0")}-${String(diasNoMes).padStart(2, "0")}`, diasNoMes };
}

type RitmoDoDia = { aberto: boolean; faturamento: number; pessoas: number };

// Por dia da semana: abre ou não, e o quanto vende em média nos dias em que abre.
function ritmoPorDiaDaSemana(vendasRitmo: VendaVisao[], hoje: string) {
  const ontem = ms(hoje) - UM_DIA_MS;
  const ocorrencias = new Array<number>(7).fill(0);
  for (let i = 0; i < DIAS_DA_JANELA_DE_RITMO; i++) ocorrencias[diaDaSemana(iso(ontem - i * UM_DIA_MS))]++;

  const inicioJanela = iso(ontem - (DIAS_DA_JANELA_DE_RITMO - 1) * UM_DIA_MS);
  const fimJanela = iso(ontem);
  const porDia = new Map<string, { faturamento: number; pessoas: number }>();
  for (const v of vendasRitmo) {
    if (!ehRecebida(v.saleStatus)) continue;
    const dia = toCalendarDateKey(v.movementDate);
    if (dia < inicioJanela || dia > fimJanela) continue;
    const a = porDia.get(dia) ?? { faturamento: 0, pessoas: 0 };
    a.faturamento += v.totalAmount;
    a.pessoas += v.people;
    porDia.set(dia, a);
  }

  const ritmo: RitmoDoDia[] = Array.from({ length: 7 }, () => ({ aberto: false, faturamento: 0, pessoas: 0 }));
  const abertos = new Array<number>(7).fill(0);
  for (const [dia, a] of porDia) {
    const w = diaDaSemana(dia);
    abertos[w]++;
    ritmo[w].faturamento += a.faturamento;
    ritmo[w].pessoas += a.pessoas;
  }
  for (let w = 0; w < 7; w++) {
    ritmo[w].aberto = ocorrencias[w] > 0 && abertos[w] / ocorrencias[w] >= MIN_FREQUENCIA_DIA_ABERTO;
    if (abertos[w] > 0) {
      ritmo[w].faturamento /= abertos[w];
      ritmo[w].pessoas /= abertos[w];
    }
  }
  return { ritmo, diasComMovimento: porDia.size };
}

function referenciasDoHistorico(historico: MesDoHistorico[]) {
  const validos = historico
    .filter((m) => m.indicadores.diasComMovimento >= MIN_DIAS_MES_DE_REFERENCIA)
    .sort((a, b) => b.ano - a.ano || b.mes - a.mes);
  const recentes = validos.slice(0, MESES_DA_MEDIA_DE_REFERENCIA);
  const de = (pegar: (m: MesDoHistorico) => number) => {
    if (validos.length === 0) return null;
    const valores = validos.map(pegar);
    const media = recentes.reduce((s, m) => s + pegar(m), 0) / recentes.length;
    return { media3: round2(media), mesesNaMedia: recentes.length, melhor: round2(Math.max(...valores)) };
  };
  return {
    faturamento: de((m) => m.indicadores.faturamento),
    pessoas: de((m) => m.indicadores.pessoas),
    ticketPessoa: de((m) => m.indicadores.ticketPessoa),
    // A perda mensal depende dos itens cancelados de cada mês, que o histórico não traz.
    perdaPct: null
  };
}

const ROTULO: Record<IndicadorDeMeta, string> = {
  faturamento: "Faturamento do mês",
  pessoas: "Pessoas atendidas",
  ticketPessoa: "Ticket por pessoa",
  perdaPct: "Perda sobre o faturamento"
};

export function montarMetas(entrada: Entrada) {
  const { ano, mes, hoje, historico, metas } = entrada;
  const { inicio, fim, diasNoMes } = limitesDoMes(ano, mes);
  const ontem = iso(ms(hoje) - UM_DIA_MS);
  const ultimoDiaFechado = ontem < fim ? ontem : fim;
  const encerrado = hoje > fim;
  const futuro = inicio >= hoje;

  const vendasMes = entrada.vendasMes.filter((v) => {
    const k = toCalendarDateKey(v.movementDate);
    return k >= inicio && k <= ultimoDiaFechado;
  });
  const realizado = calcularIndicadores(vendasMes, entrada.itensCanceladosMes);

  const { ritmo, diasComMovimento: diasDoRitmo } = ritmoPorDiaDaSemana(entrada.vendasRitmo, hoje);
  const podeProjetar = diasDoRitmo >= MIN_DIAS_PARA_PROJETAR;

  // Dias que ainda vão acontecer: de hoje (em andamento) ao fim do mês.
  let diasRestantes = 0;
  let falta = { faturamento: 0, pessoas: 0 };
  if (!encerrado) {
    const primeiro = inicio > hoje ? inicio : hoje;
    for (let t = ms(primeiro); t <= ms(fim); t += UM_DIA_MS) {
      const r = ritmo[diaDaSemana(iso(t))];
      if (!r.aberto) continue;
      diasRestantes++;
      falta = { faturamento: falta.faturamento + r.faturamento, pessoas: falta.pessoas + r.pessoas };
    }
  }

  const referencias = referenciasDoHistorico(historico);
  const taxaConfiavel = realizado.diasComMovimento >= MIN_DIAS_PARA_TAXA;

  const indicadores = INDICADORES_DE_META.map((indicador) => {
    const meta = metas[indicador] ?? null;
    const ehSoma = indicador === "faturamento" || indicador === "pessoas";
    const menorEMelhor = indicador === "perdaPct";

    let valor: number | null;
    if (ehSoma) valor = indicador === "faturamento" ? realizado.faturamento : realizado.pessoas;
    else if (!taxaConfiavel || realizado.pessoas === 0) valor = null;
    else valor = indicador === "ticketPessoa" ? realizado.ticketPessoa : realizado.perdaPct;

    const projecao = ehSoma && podeProjetar && valor !== null ? round2(valor + falta[indicador]) : null;
    const faltam = ehSoma && meta !== null && valor !== null ? round2(Math.max(0, meta - valor)) : null;
    const porDiaAtual = ehSoma && realizado.diasComMovimento > 0 ? round2((valor as number) / realizado.diasComMovimento) : null;
    const porDiaNecessario = faltam !== null && faltam > 0 && diasRestantes > 0 ? round2(faltam / diasRestantes) : null;

    let situacao: Situacao;
    if (meta === null) situacao = "sem-meta";
    else if (valor === null) situacao = "sem-dado";
    else if (ehSoma) {
      if (valor >= meta) situacao = "atingida";
      else if (encerrado) situacao = "abaixo";
      else if (projecao === null) situacao = "sem-dado";
      else situacao = projecao >= meta ? "no-ritmo" : "abaixo";
    } else {
      const ok = menorEMelhor ? valor <= meta : valor >= meta;
      situacao = ok ? (encerrado ? "atingida" : "no-ritmo") : "abaixo";
    }

    return {
      indicador,
      rotulo: ROTULO[indicador],
      menorEMelhor,
      meta: meta === null ? null : indicador === "perdaPct" ? round4(meta) : round2(meta),
      realizado: valor,
      projecao: encerrado && ehSoma ? valor : projecao,
      progresso: ehSoma && meta !== null && meta > 0 && valor !== null ? round4(valor / meta) : null,
      faltam,
      porDiaAtual,
      porDiaNecessario,
      situacao,
      referencia: referencias[indicador]
    };
  });

  return {
    mes: { ano, mes, inicio, fim, diasNoMes, encerrado, futuro },
    cobertura: {
      diasComMovimento: realizado.diasComMovimento,
      diasRestantes,
      diasNoRitmo: diasDoRitmo,
      podeProjetar
    },
    indicadores
  };
}
