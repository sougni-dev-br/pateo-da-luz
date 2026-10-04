// Previsão de almoços de um dia com evento, e a sugestão de tamanho de buffet que sai dela.
// Regras explicáveis, sem modelo estatístico: a tela precisa dizer de onde veio o número
// para a gerência confiar (ou discordar com motivo).
//
// O que o histórico de 2024–2026 mostrou que move o almoço:
// - a mesma série em edições anteriores, no mesmo ponto do evento (1º dia, meio, último);
// - o ponto do evento: o dia do meio rende mais, o último menos, e o último num fim de
//   semana menos ainda;
// - quantos eventos acontecem juntos.
// O público anunciado na circular quase não explica o movimento, então não entra.

export type Posicao = "UNICO" | "PRIMEIRO" | "MEIO" | "ULTIMO";
export type Tamanho = "PEQUENO" | "MEDIO" | "GRANDE";
export type OrigemEvento = "CENTRO_CONVENCOES" | "TEATRO" | "GRUPO";

export type EventoNoDia = {
  seriesId: string;
  seriesName: string;
  origin: OrigemEvento;
  posicao: Posicao;
};

export type DiaHistorico = {
  date: string; // AAAA-MM-DD
  lunch: number;
  eventos: EventoNoDia[];
};

export type Limites = { smallMaxLunch: number; largeMinLunch: number };

export type Previsao = {
  almoco: number;
  minimo: number;
  maximo: number;
  tamanho: Tamanho;
  /** De onde veio o número, em uma frase. */
  base: string;
  /** Dias do histórico que sustentam a conta. */
  casos: number;
  poucaBase: boolean;
};

const FORCA: Record<Posicao, number> = { MEIO: 3, PRIMEIRO: 2, ULTIMO: 1, UNICO: 0 };
const NOME_POSICAO: Record<Posicao, string> = { UNICO: "evento de um dia", PRIMEIRO: "1º dia", MEIO: "dia do meio", ULTIMO: "último dia" };
const MINIMO_CASOS = 3;

type Periodo = "DIA_UTIL" | "SABADO" | "DOMINGO";
const NOME_PERIODO: Record<Periodo, string> = { DIA_UTIL: "dia útil", SABADO: "sábado", DOMINGO: "domingo" };

export function posicaoNoEvento(indice: number, totalDias: number): Posicao {
  if (totalDias <= 1) return "UNICO";
  if (indice === 0) return "PRIMEIRO";
  if (indice === totalDias - 1) return "ULTIMO";
  return "MEIO";
}

export function tamanhoPara(almoco: number, limites: Limites): Tamanho {
  if (almoco <= limites.smallMaxLunch) return "PEQUENO";
  if (almoco > limites.largeMinLunch) return "GRANDE";
  return "MEDIO";
}

function periodoDe(date: string): Periodo {
  const dia = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dia === 0 ? "DOMINGO" : dia === 6 ? "SABADO" : "DIA_UTIL";
}

/** Grupos com pacote (jornalistas, radialistas) não contam como evento do prédio. */
function doPredio(eventos: EventoNoDia[]): EventoNoDia[] {
  return eventos.filter((e) => e.origin !== "GRUPO");
}

/** O dia vale pelo evento mais forte: com um evento no meio e outro no fim, conta o do meio. */
function posicaoDoDia(eventos: EventoNoDia[]): Posicao | null {
  const lista = doPredio(eventos);
  if (lista.length === 0) return null;
  return lista.reduce((melhor, e) => (FORCA[e.posicao] > FORCA[melhor] ? e.posicao : melhor), lista[0].posicao);
}

function juntos(eventos: EventoNoDia[]): "UM" | "VARIOS" {
  return doPredio(eventos).length > 1 ? "VARIOS" : "UM";
}

function quantil(ordenados: number[], q: number): number {
  if (ordenados.length === 0) return 0;
  const pos = (ordenados.length - 1) * q;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo);
}

function mediana(valores: number[]): number {
  return quantil([...valores].sort((a, b) => a - b), 0.5);
}

type Amostra = { valores: number[]; descricao: string };

/** Mesma série, de preferência no mesmo ponto do evento. Fica com a série que mais rende no dia. */
function amostraDaSerie(eventos: EventoNoDia[], passado: DiaHistorico[]): Amostra | null {
  let escolhida: Amostra | null = null;
  let escolhidaMediana = -1;
  for (const evento of eventos) {
    const daSerie = passado.filter((d) => d.eventos.some((e) => e.seriesId === evento.seriesId));
    if (daSerie.length === 0) continue;
    const mesmoPonto = daSerie.filter((d) => d.eventos.some((e) => e.seriesId === evento.seriesId && e.posicao === evento.posicao));
    const usar = mesmoPonto.length > 0 ? mesmoPonto : daSerie;
    const valores = usar.map((d) => d.lunch);
    const m = mediana(valores);
    if (m > escolhidaMediana) {
      escolhidaMediana = m;
      const onde = mesmoPonto.length > 0 ? `no ${NOME_POSICAO[evento.posicao]}` : "contando todos os dias do evento";
      const dias = valores.length === 1 ? "1 dia" : `${valores.length} dias`;
      escolhida = { valores, descricao: `Em edições anteriores, ${evento.seriesName} teve ${Math.round(m)} almoços ${onde} (${dias})` };
    }
  }
  return escolhida;
}

/** Dias parecidos de qualquer evento. Vai afrouxando o filtro até ter casos suficientes. */
function amostraDoPerfil(date: string, eventos: EventoNoDia[], passado: DiaHistorico[]): Amostra | null {
  const posicao = posicaoDoDia(eventos);
  if (!posicao) return null;
  const periodo = periodoDe(date);
  const quantos = juntos(eventos);
  const comEvento = passado.filter((d) => posicaoDoDia(d.eventos) !== null);

  const tentativas: Array<{ filtro: (d: DiaHistorico) => boolean; texto: string }> = [
    {
      filtro: (d) => posicaoDoDia(d.eventos) === posicao && periodoDe(d.date) === periodo && juntos(d.eventos) === quantos,
      texto: `${NOME_POSICAO[posicao]}, ${NOME_PERIODO[periodo]}, ${quantos === "VARIOS" ? "2 ou mais eventos" : "1 evento"}`,
    },
    {
      filtro: (d) => posicaoDoDia(d.eventos) === posicao && periodoDe(d.date) === periodo,
      texto: `${NOME_POSICAO[posicao]}, ${NOME_PERIODO[periodo]}`,
    },
    { filtro: (d) => posicaoDoDia(d.eventos) === posicao, texto: NOME_POSICAO[posicao] },
    { filtro: () => true, texto: "qualquer dia com evento" },
  ];
  // Fica com o filtro mais parecido que tenha casos suficientes. Se nenhum tiver, poucos
  // casos no mesmo ponto do evento ainda dizem mais que a média de todos os dias (e a tela
  // avisa "pouca base"); a média de todos os dias só entra quando não há nenhum.
  const amostraDe = (t: (typeof tentativas)[number]): Amostra | null => {
    const valores = comEvento.filter(t.filtro).map((d) => d.lunch);
    return valores.length === 0 ? null : { valores, descricao: `dias parecidos com este (${t.texto}) tiveram ${Math.round(mediana(valores))} almoços (${valores.length} ${valores.length === 1 ? "dia" : "dias"})` };
  };
  const mesmoPonto = tentativas.slice(0, -1).map(amostraDe).filter((a): a is Amostra => a !== null);
  return mesmoPonto.find((a) => a.valores.length >= MINIMO_CASOS) ?? mesmoPonto[0] ?? amostraDe(tentativas[tentativas.length - 1]);
}

export function preverAlmoco(
  dia: { date: string; eventos: EventoNoDia[] },
  historico: DiaHistorico[],
  limites: Limites,
): Previsao | null {
  if (dia.eventos.length === 0) return null;
  // Só o que já aconteceu antes do dia: a mesma função serve para medir o acerto no passado.
  const passado = historico.filter((d) => d.date < dia.date);
  const serie = amostraDaSerie(dia.eventos, passado);
  const perfil = amostraDoPerfil(dia.date, dia.eventos, passado);
  if (!serie && !perfil) return null;

  let almoco: number;
  let faixaDe: number[];
  if (serie && perfil) {
    // Quanto mais edições da série, mais ela pesa.
    const peso = serie.valores.length >= 2 ? 0.6 : 0.5;
    almoco = peso * mediana(serie.valores) + (1 - peso) * mediana(perfil.valores);
    faixaDe = serie.valores.length >= MINIMO_CASOS ? serie.valores : perfil.valores;
  } else {
    const unica = (serie ?? perfil) as Amostra;
    almoco = mediana(unica.valores);
    faixaDe = unica.valores;
  }

  const ordenados = [...faixaDe].sort((a, b) => a - b);
  const arredondado = Math.round(almoco);
  const casos = (serie?.valores.length ?? 0) + (perfil?.valores.length ?? 0);
  return {
    almoco: arredondado,
    minimo: Math.min(arredondado, Math.round(quantil(ordenados, 0.25))),
    maximo: Math.max(arredondado, Math.round(quantil(ordenados, 0.75))),
    tamanho: tamanhoPara(arredondado, limites),
    base: [serie?.descricao, perfil?.descricao].filter(Boolean).join("; "),
    casos,
    poucaBase: (serie?.valores.length ?? 0) < 2 && (perfil?.valores.length ?? 0) < MINIMO_CASOS,
  };
}
