// Contas da linha do tempo de férias: eixo de datas, quem está fora a cada dia e a sugestão
// de quando começar. Tudo em "AAAA-MM-DD" (UTC), como o resto do módulo: o fuso não pode mudar o dia.
import type { ListaFerias, PeriodoFerias, PessoaFerias } from "../../../api/client";
import { dataBr, somaDias } from "./feriasFormato";
import { DIAS_DE_AVISO, type Feriados, diaDaSemana, motivoInicioVedado, nomeDoDia } from "./regrasFerias";

const DIA_MS = 86_400_000;
const emMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
export const diasEntre = (de: string, ate: string) => Math.round((emMs(ate) - emMs(de)) / DIA_MS);

const primeiroDoMes = (iso: string, deslocar = 0): string => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + deslocar, 1)).toISOString().slice(0, 10);
};

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MAX_DIAS_EIXO = 31 * 30;
const DIAS_ATENCAO = 90;
const DIAS_URGENTE = 30;
/** Quanto do futuro a tela mostra, no mínimo, mesmo que ninguém tenha prazo tão longe. */
const HORIZONTE_MINIMO_DIAS = 400;

/** Cada escala mostra exatamente `meses` meses na largura disponível (Ano = 12, Semestre = 6, Trimestre = 3). */
export type Zoom = { id: "ano" | "semestre" | "trimestre"; rotulo: string; meses: 12 | 6 | 3 };
export const ZOOMS: Zoom[] = [
  { id: "ano", rotulo: "Ano", meses: 12 },
  { id: "semestre", rotulo: "Semestre", meses: 6 },
  { id: "trimestre", rotulo: "Trimestre", meses: 3 },
];
export const DIAS_NO_MES = 30.44;
/** Em telas muito estreitas a escala não encolhe além disto; a linha do tempo passa a rolar. */
const PX_MINIMO_POR_DIA = 2.4;

/** Px por dia para os meses da escala caberem na área das pistas (largura visível menos a coluna do nome). */
export const pxPorDiaDaEscala = (zoom: Zoom, larguraDasPistas: number): number =>
  Math.round(Math.max(PX_MINIMO_POR_DIA, larguraDasPistas / (zoom.meses * DIAS_NO_MES)) * 100) / 100;

export type Eixo = { inicio: string; totalDias: number; pxPorDia: number; largura: number };

export function criarEixo(hoje: string, pessoas: PessoaFerias[], pxPorDia: number): Eixo {
  const inicio = primeiroDoMes(hoje, -2);
  let ultimo = somaDias(hoje, HORIZONTE_MINIMO_DIAS);
  for (const pessoa of pessoas) {
    for (const p of pessoa.periodos) {
      if (p.situacao !== "GOZADA" && p.fimConcessivo > ultimo) ultimo = p.fimConcessivo;
      for (const g of p.programacoes) if (g.gozoFim && g.gozoFim > ultimo) ultimo = g.gozoFim;
    }
  }
  // Termina no último dia do mês, e o eixo nunca passa de ~30 meses.
  const fim = somaDias(primeiroDoMes(ultimo, 1), -1);
  const totalDias = Math.min(MAX_DIAS_EIXO, diasEntre(inicio, fim) + 1);
  return { inicio, totalDias, pxPorDia, largura: Math.round(totalDias * pxPorDia) };
}

/** Eixo entre duas datas (inclusive), espremido numa largura em px: serve à folha impressa. */
export function criarEixoEntre(inicio: string, fim: string, largura: number): Eixo {
  const totalDias = diasEntre(inicio, fim) + 1;
  return { inicio, totalDias, pxPorDia: largura / totalDias, largura };
}

export const fimDoEixo = (eixo: Eixo) => somaDias(eixo.inicio, eixo.totalDias - 1);
export const indiceDoDia = (eixo: Eixo, iso: string) => diasEntre(eixo.inicio, iso);
export const xDoDia = (eixo: Eixo, iso: string) => indiceDoDia(eixo, iso) * eixo.pxPorDia;

/** O dia sob um x (em px, a partir da esquerda do eixo), preso às pontas. */
export function diaDoX(eixo: Eixo, x: number): string {
  const i = Math.min(eixo.totalDias - 1, Math.max(0, Math.floor(x / eixo.pxPorDia)));
  return somaDias(eixo.inicio, i);
}

export type MesDoEixo = { iso: string; x: number; largura: number; nome: string; ano: number; viraAno: boolean };

export function mesesDoEixo(eixo: Eixo): MesDoEixo[] {
  const fim = fimDoEixo(eixo);
  const meses: MesDoEixo[] = [];
  for (let mes = eixo.inicio; mes <= fim; mes = primeiroDoMes(mes, 1)) {
    const proximo = primeiroDoMes(mes, 1);
    const de = Math.max(0, indiceDoDia(eixo, mes));
    const ate = Math.min(eixo.totalDias, indiceDoDia(eixo, proximo));
    const [ano, numero] = mes.split("-").map(Number);
    meses.push({ iso: mes, x: de * eixo.pxPorDia, largura: (ate - de) * eixo.pxPorDia, nome: MESES_CURTOS[numero - 1], ano, viraAno: numero === 1 });
  }
  return meses;
}

/** Largura (px) a partir da qual o mês cabe com o ano inteiro ("OUT 2026") e com o ano curto ("OUT 26"). */
const LARGURA_ANO_COMPLETO = 46;
const LARGURA_ANO_CURTO = 34;

/**
 * Textos do cabeçalho de meses. O ano aparece em todos os meses ou em nenhum (nunca só em alguns):
 * completo quando o mês mais estreito comporta, curto quando só comporta isso, senão só o nome do mês.
 * O último mês, que pode ser parcial, não entra na medida.
 */
export function rotulosDosMeses(meses: MesDoEixo[]): Array<{ nome: string; ano: string }> {
  const medida = meses.length > 1 ? Math.min(...meses.slice(0, -1).map((m) => m.largura)) : (meses[0]?.largura ?? 0);
  const ano = (m: MesDoEixo) => (medida >= LARGURA_ANO_COMPLETO ? String(m.ano) : medida >= LARGURA_ANO_CURTO ? String(m.ano).slice(2) : "");
  return meses.map((m) => ({ nome: m.nome, ano: ano(m) }));
}

/** Retângulo (em px) de um intervalo fechado de dias, cortado nas pontas do eixo; null se cair fora. */
export function retangulo(eixo: Eixo, inicio: string, fim: string): { x: number; largura: number; cortaEsquerda: boolean; cortaDireita: boolean } | null {
  const de = indiceDoDia(eixo, inicio);
  const ate = indiceDoDia(eixo, fim);
  if (ate < 0 || de > eixo.totalDias - 1 || ate < de) return null;
  const a = Math.max(0, de);
  const b = Math.min(eixo.totalDias - 1, ate);
  return { x: a * eixo.pxPorDia, largura: (b - a + 1) * eixo.pxPorDia, cortaEsquerda: de < 0, cortaDireita: ate > eixo.totalDias - 1 };
}

// ── Zonas da janela de gozo ────────────────────────────────────────────────────────

export type TomZona = "seguro" | "atencao" | "urgente" | "estouro" | "neutro";
export type Zona = { tom: TomZona; inicio: string; fim: string };

/**
 * A janela em que a pessoa pode tirar férias (do fim do aquisitivo ao fim do concessivo), em faixas
 * pela urgência: seguro, atenção (90 dias antes do limite), urgente (30) e a de estouro, depois do
 * limite, onde começar já passa do prazo. Sem dias a programar a janela é uma faixa só, neutra.
 */
export function zonasDaJanela(p: PeriodoFerias): Zona[] {
  const inicio = somaDias(p.aquisitivoFim, 1);
  if (p.diasPendentes <= 0 || p.doHistorico) return [{ tom: "neutro", inicio, fim: p.fimConcessivo }];
  const zonas: Zona[] = [];
  const corte = (tom: TomZona, de: string, ate: string) => {
    const a = de < inicio ? inicio : de;
    if (a <= ate) zonas.push({ tom, inicio: a, fim: ate });
  };
  corte("seguro", inicio, somaDias(p.limiteInicioGozo, -DIAS_ATENCAO - 1));
  corte("atencao", somaDias(p.limiteInicioGozo, -DIAS_ATENCAO), somaDias(p.limiteInicioGozo, -DIAS_URGENTE - 1));
  corte("urgente", somaDias(p.limiteInicioGozo, -DIAS_URGENTE), p.limiteInicioGozo);
  corte("estouro", somaDias(p.limiteInicioGozo, 1), p.fimConcessivo);
  return zonas;
}

// ── Quem está fora ─────────────────────────────────────────────────────────────────

export type Ausencia = { employeeId: string; nome: string; setor: string | null; inicio: string; fim: string; gozada: boolean };

export function ausenciasDaLista(lista: ListaFerias): Ausencia[] {
  return lista.pessoas.flatMap((pessoa) =>
    pessoa.periodos.flatMap((p) =>
      p.programacoes.flatMap((g) => (g.gozoInicio && g.gozoFim
        ? [{ employeeId: pessoa.employeeId, nome: pessoa.nome, setor: pessoa.setor, inicio: g.gozoInicio, fim: g.gozoFim, gozada: g.status === "GOZADA" }]
        : []))));
}

/** Quantas pessoas estão fora em cada dia do eixo. */
export function coberturaPorDia(eixo: Eixo, ausencias: Ausencia[]): number[] {
  const dias = new Array<number>(eixo.totalDias).fill(0);
  for (const a of ausencias) {
    const r = Math.max(0, indiceDoDia(eixo, a.inicio));
    const ate = Math.min(eixo.totalDias - 1, indiceDoDia(eixo, a.fim));
    for (let i = r; i <= ate; i++) dias[i] += 1;
  }
  return dias;
}

export type TrechoDeCobertura = { de: number; ate: number; quantos: number };

/** Dias seguidos com o mesmo número de pessoas fora (só os de 1 em diante), para desenhar a faixa. */
export function trechosDeCobertura(cobertura: number[]): TrechoDeCobertura[] {
  const trechos: TrechoDeCobertura[] = [];
  let i = 0;
  while (i < cobertura.length) {
    const quantos = cobertura[i];
    let j = i;
    while (j + 1 < cobertura.length && cobertura[j + 1] === quantos) j++;
    if (quantos > 0) trechos.push({ de: i, ate: j, quantos });
    i = j + 1;
  }
  return trechos;
}

/** Setores que existem na lista, em ordem alfabética (para o seletor da cobertura). */
export const setoresDaLista = (lista: ListaFerias): string[] =>
  [...new Set(lista.pessoas.flatMap((p) => (p.setor ? [p.setor] : [])))].sort((a, b) => a.localeCompare(b, "pt-BR"));

/** Quem estará fora em algum dia do intervalo, separando os colegas do mesmo setor (que pesam mais). */
export function colegasFora(ausencias: Ausencia[], inicio: string, fim: string, ignorar: string, setor: string | null): { mesmoSetor: string[]; outros: string[] } {
  const fora = ausencias.filter((a) => a.employeeId !== ignorar && a.inicio <= fim && a.fim >= inicio);
  const nomes = (lista: Ausencia[]) => [...new Set(lista.map((a) => a.nome))];
  return {
    mesmoSetor: setor ? nomes(fora.filter((a) => a.setor === setor)) : [],
    outros: nomes(fora.filter((a) => !setor || a.setor !== setor)),
  };
}

/** Nomes (sem repetir) de quem está fora em algum dia do intervalo; `ignorar` tira a própria pessoa. */
export function quemEstaFora(ausencias: Ausencia[], inicio: string, fim: string, ignorar?: string): string[] {
  const nomes = ausencias.filter((a) => a.employeeId !== ignorar && a.inicio <= fim && a.fim >= inicio).map((a) => a.nome);
  return [...new Set(nomes)];
}

// ── Sugestão de datas ──────────────────────────────────────────────────────────────

/** Onde a sugestão nasceu: do pedido do colaborador (quando ele serve) ou do cálculo da casa. */
export type OrigemDaSugestao = "pedido" | "calculada";
export type Sugestao = {
  inicio: string; fim: string; dias: number; pico: number; picoSetor: number;
  origem: OrigemDaSugestao;
  /** Dias de abono do pedido, quando a sugestão é o próprio pedido. */
  diasAbono: number;
  /** Por que o pedido não serve como está (a sugestão é a data mais próxima que serve). Só existe quando há pedido e ele não serve. */
  motivoDoPedido?: string;
};

/** Quando o prazo já passou, procura só nesta janela (o quanto antes, mas com folga para avisar a pessoa). */
const PROCURA_SE_VENCIDA_DIAS = 60;
/** Colegas do mesmo setor fora ao mesmo tempo a partir dos quais o setor "lota" e o pedido deixa de servir. */
export const COLEGAS_DO_SETOR_QUE_LOTAM = 2;

export type PedidoParaSugerir = { inicio: string; dias: number; diasAbono: number };

export type ContextoSugestao = {
  feriados: Feriados;
  /** Dias da semana de repouso da pessoa (0 = domingo). */
  repousos?: number[];
  /** Setor da pessoa: colegas dele fora ao mesmo tempo pesam mais do que os de outros setores. */
  setor: string | null;
  /** Ausências dos colegas (sem a própria pessoa). */
  dosOutros: Ausencia[];
  /** Férias já marcadas da própria pessoa: a sugestão não pode bater nelas. */
  proprias: Ausencia[];
  /** O que o colaborador pediu para este período: se serve, a sugestão é ele; se não, a data mais próxima que serve. */
  pedido?: PedidoParaSugerir | null;
};

type Medida = { i: number; excede: number; distancia: number; picoSetor: number; pico: number; somaSetor: number; soma: number; naoSegunda: number };
const ORDEM_SEM_PEDIDO = ["picoSetor", "pico", "somaSetor", "soma", "naoSegunda"] as const;
// Com pedido: primeiro o que não lota o setor, depois o mais perto do que foi pedido.
const ORDEM_COM_PEDIDO = ["excede", "distancia", "picoSetor", "pico", "somaSetor", "soma", "naoSegunda"] as const;
const melhorQue = (a: Medida, b: Medida | null, ordem: readonly (keyof Medida)[]) => {
  if (!b) return true;
  for (const k of ordem) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
};

/**
 * Acha onde encaixar `dias` de férias respeitando a lei e a casa.
 *
 * Com pedido do colaborador, parte dele: se o pedido serve (começa em dia permitido, termina dentro do prazo, não
 * bate nas férias da própria pessoa, não lota o setor e cabe no saldo), a sugestão é o próprio pedido. Se não serve,
 * sugere a data mais próxima do pedido que serve e diz por que o pedido não serve (`motivoDoPedido`).
 *
 * Sem pedido (ou para achar a alternativa): nunca começa em dia vedado, respeita o aviso de 30 dias quando o prazo
 * permite, não bate nas férias da própria pessoa e prefere menos colegas do mesmo setor fora, depois menos gente
 * fora na casa toda, depois começar numa segunda-feira, depois o dia mais cedo.
 */
export function sugerirInicio(eixo: Eixo, p: PeriodoFerias, hoje: string, dias: number, ctx: ContextoSugestao): Sugestao | null {
  if (dias < 1) return null;
  const geral = coberturaPorDia(eixo, ctx.dosOutros);
  const doSetor = ctx.setor ? coberturaPorDia(eixo, ctx.dosOutros.filter((a) => a.setor === ctx.setor)) : geral.map(() => 0);
  const propria = coberturaPorDia(eixo, ctx.proprias);
  const abertura = somaDias(p.aquisitivoFim, 1);
  const maior = (a: string, b: string) => (a > b ? a : b);
  const em = (cobertura: number[], k: number) => cobertura[k] ?? 0; // fora do eixo não há dado: conta como livre

  const pedido = ctx.pedido ?? null;
  const idxPedido = pedido ? indiceDoDia(eixo, pedido.inicio) : 0;
  let motivoDoPedido: string | undefined;

  if (pedido) {
    const fim = somaDias(pedido.inicio, pedido.dias - 1);
    let pico = 0;
    let picoSetor = 0;
    let bate = false;
    for (let k = idxPedido; k < idxPedido + pedido.dias; k++) {
      pico = Math.max(pico, em(geral, k));
      picoSetor = Math.max(picoSetor, em(doSetor, k));
      if (em(propria, k) > 0) bate = true;
    }
    const vedado = motivoInicioVedado(pedido.inicio, ctx.feriados, ctx.repousos);
    const motivos = [
      pedido.inicio <= p.aquisitivoFim && "começa antes de completar o período aquisitivo",
      pedido.inicio > p.aquisitivoFim && pedido.inicio <= hoje && "essa data já passou",
      vedado && `não pode começar em ${nomeDoDia(pedido.inicio)}: ${vedado}`,
      fim > p.fimConcessivo && `termina depois do prazo (${dataBr(p.fimConcessivo)}): férias pagas em dobro`,
      bate && "bate em férias já programadas dele",
      picoSetor >= COLEGAS_DO_SETOR_QUE_LOTAM && `${picoSetor} colegas do setor ${ctx.setor} já estarão fora`,
      pedido.dias > dias && `pede ${pedido.dias} dias e restam ${dias} a programar`,
    ].filter(Boolean) as string[];
    if (motivos.length === 0) return { inicio: pedido.inicio, fim, dias: pedido.dias, pico, picoSetor, origem: "pedido", diasAbono: pedido.diasAbono };
    motivoDoPedido = motivos.join("; ");
    dias = Math.min(dias, pedido.dias); // a alternativa mantém os dias pedidos (até o que resta)
  }

  const ordem = pedido ? ORDEM_COM_PEDIDO : ORDEM_SEM_PEDIDO;
  const procurar = (primeiro: string, ultimo: string): Medida | null => {
    let melhor: Medida | null = null;
    const de = Math.max(0, indiceDoDia(eixo, primeiro));
    const ate = Math.min(eixo.totalDias - dias, indiceDoDia(eixo, ultimo));
    for (let i = de; i <= ate; i++) {
      const inicio = somaDias(eixo.inicio, i);
      if (motivoInicioVedado(inicio, ctx.feriados, ctx.repousos)) continue;
      const m: Medida = { i, excede: 0, distancia: Math.abs(i - idxPedido), picoSetor: 0, pico: 0, somaSetor: 0, soma: 0, naoSegunda: diaDaSemana(inicio) === 1 ? 0 : 1 };
      let bate = false;
      for (let k = i; k < i + dias; k++) {
        if (propria[k] > 0) { bate = true; break; }
        m.pico = Math.max(m.pico, geral[k]);
        m.picoSetor = Math.max(m.picoSetor, doSetor[k]);
        m.soma += geral[k];
        m.somaSetor += doSetor[k];
      }
      m.excede = m.picoSetor >= COLEGAS_DO_SETOR_QUE_LOTAM ? 1 : 0;
      if (!bate && melhorQue(m, melhor, ordem)) melhor = m;
    }
    return melhor;
  };

  // Primeiro tenta com o aviso de 30 dias; se o prazo é curto demais para isso, aceita o quanto antes.
  const comAviso = maior(abertura, somaDias(hoje, DIAS_DE_AVISO));
  let achada = p.limiteInicioGozo >= comAviso ? procurar(comAviso, p.limiteInicioGozo) : null;
  if (!achada) {
    const primeiro = maior(abertura, somaDias(hoje, 1));
    achada = procurar(primeiro, p.limiteInicioGozo < primeiro ? somaDias(primeiro, PROCURA_SE_VENCIDA_DIAS) : p.limiteInicioGozo);
  }
  if (!achada) return null;
  const inicio = somaDias(eixo.inicio, achada.i);
  return { inicio, fim: somaDias(inicio, dias - 1), dias, pico: achada.pico, picoSetor: achada.picoSetor, origem: "calculada", diasAbono: 0, ...(motivoDoPedido ? { motivoDoPedido } : {}) };
}

/** O período em que um clique na linha da pessoa vai programar: o mais antigo que ainda tem o que programar. */
export function periodoAlvo(pessoa: PessoaFerias): PeriodoFerias | null {
  return pessoa.periodos.find((p) => p.situacao !== "EM_AQUISICAO" && p.diasPendentes > 0 && !p.doHistorico) ?? null;
}

// ── Dias vedados (cache por escala) ────────────────────────────────────────────────

export type TrechoVedado = { de: number; ate: number };
const cacheDeVedados = new WeakMap<Eixo, Map<string, TrechoVedado[]>>();

/**
 * Trechos de dias (índices do eixo) em que as férias não podem começar para quem repousa nesses dias.
 * Quase todo mundo repousa no mesmo dia, então o resultado é guardado por eixo e por repouso: a tela de
 * 90 pessoas faz poucas contas em vez de uma por linha.
 */
export function trechosVedados(eixo: Eixo, feriados: Feriados, repousos: number[]): TrechoVedado[] {
  const chave = repousos.join(",");
  const doEixo = cacheDeVedados.get(eixo) ?? new Map<string, TrechoVedado[]>();
  cacheDeVedados.set(eixo, doEixo);
  const guardado = doEixo.get(chave);
  if (guardado) return guardado;
  const trechos: TrechoVedado[] = [];
  let aberto: TrechoVedado | null = null;
  for (let i = 0; i < eixo.totalDias; i++) {
    if (motivoInicioVedado(somaDias(eixo.inicio, i), feriados, repousos)) {
      if (aberto) aberto.ate = i;
      else { aberto = { de: i, ate: i }; trechos.push(aberto); }
    } else aberto = null;
  }
  doEixo.set(chave, trechos);
  return trechos;
}

/** Segundas-feiras do eixo (x em px e dia do mês): as marcas semanais da folha de 3 meses. */
export function segundasDoEixo(eixo: Eixo): Array<{ x: number; dia: number }> {
  const segundas: Array<{ x: number; dia: number }> = [];
  for (let i = 0; i < eixo.totalDias; i++) {
    const dia = somaDias(eixo.inicio, i);
    if (diaDaSemana(dia) === 1) segundas.push({ x: i * eixo.pxPorDia, dia: Number(dia.slice(8)) });
  }
  return segundas;
}
