// Separa o que ainda VAI acontecer do que JÁ ESTÁ errado.
//
// O fechamento é aberto duas vezes: durante o mês, para pegar erro cedo, e no
// fim, para conferir antes de travar. A tela tratava tudo como "pendência", e
// no dia 10 isso significava cinco itens vermelhos — nenhum deles acionável,
// porque impostos e inventário final simplesmente ainda não aconteceram.
//
// O efeito é o pior possível num painel de controle: o alarme fica sempre
// aceso, quem olha aprende a ignorar, e o erro de verdade some no meio.
//
// Aqui a pendência é classificada por natureza:
//
//   AGUARDANDO  o mês ainda não terminou e este item só existe no fim.
//               Informativo. Vira ATENÇÃO sozinho quando o mês acaba.
//   ATENÇÃO     o que já foi lançado não fecha. Acionável hoje, dia 10 ou 30.
//
// A diferença não é de severidade, é de tempo — e é o que torna a tela útil
// no meio do mês.

/** Pendência como o backend devolve em `summary.pending`. */
export type PendenciaDoFechamento = {
  key: string;
  label: string;
};

export type NaturezaDaPendencia = "AGUARDANDO" | "ATENCAO";

export type PendenciaClassificada = PendenciaDoFechamento & {
  natureza: NaturezaDaPendencia;
};

/**
 * Pendências que só se resolvem no fim do mês.
 *
 * Fornecedor mensal (`supplier:*`) entra por prefixo: a nota do condomínio, do
 * contador e afins chegam depois do mês virar. Faturamento com poucos dias é o
 * caso mais evidente — no dia 10 ter 10 dias lançados é o esperado, não falha.
 */
const SO_NO_FIM_DO_MES = new Set([
  "block:taxes",
  "block:finalInventory",
  "block:revenue"
]);

const PREFIXO_FORNECEDOR = "supplier:";

function soAconteceNoFim(key: string): boolean {
  return SO_NO_FIM_DO_MES.has(key) || key.startsWith(PREFIXO_FORNECEDOR);
}

/**
 * O mês de competência já terminou?
 *
 * Compara só a data, sem hora: fechar no próprio dia 30 deve contar como mês
 * terminado, e comparar com o instante faria a tela mudar de comportamento no
 * meio do dia.
 */
export function mesTerminou(monthEnd: string, hoje: Date = new Date()): boolean {
  const [ano, mes, dia] = monthEnd.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return false;
  const fim = new Date(ano, mes - 1, dia);
  const agora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return agora.getTime() >= fim.getTime();
}

export function classificarPendencias(
  pendencias: PendenciaDoFechamento[],
  monthEnd: string,
  hoje: Date = new Date()
): PendenciaClassificada[] {
  // Depois que o mês fecha, o que não aconteceu deixou de ser espera e virou
  // falta: a mesma pendência muda de natureza sozinha, sem ninguém reclassificar.
  const acabou = mesTerminou(monthEnd, hoje);
  return pendencias.map((p) => ({
    ...p,
    natureza: !acabou && soAconteceNoFim(p.key) ? "AGUARDANDO" : "ATENCAO"
  }));
}

export type ResumoDoFechamento = {
  atencao: PendenciaClassificada[];
  aguardando: PendenciaClassificada[];
  mesTerminou: boolean;
  /** true quando não há nada acionável agora. */
  semNadaParaFazer: boolean;
};

export function resumirFechamento(
  pendencias: PendenciaDoFechamento[],
  monthEnd: string,
  hoje: Date = new Date()
): ResumoDoFechamento {
  const classificadas = classificarPendencias(pendencias, monthEnd, hoje);
  const atencao = classificadas.filter((p) => p.natureza === "ATENCAO");
  return {
    atencao,
    aguardando: classificadas.filter((p) => p.natureza === "AGUARDANDO"),
    mesTerminou: mesTerminou(monthEnd, hoje),
    semNadaParaFazer: atencao.length === 0
  };
}

/**
 * Quanto do mês já passou, de 0 a 1.
 *
 * Serve para a tela dizer "dia 12 de 30" em vez de só "em andamento": saber
 * onde se está no mês é o que dá sentido a uma pendência de fim de mês.
 */
export function progressoDoMes(monthStart: string, monthEnd: string, hoje: Date = new Date()): {
  diaAtual: number;
  totalDeDias: number;
  fracao: number;
} {
  const parse = (v: string) => {
    const [a, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(a, m - 1, d);
  };
  const inicio = parse(monthStart);
  const fim = parse(monthEnd);
  const agora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dia = 24 * 60 * 60 * 1000;

  const totalDeDias = Math.round((fim.getTime() - inicio.getTime()) / dia) + 1;
  const decorridos = Math.round((agora.getTime() - inicio.getTime()) / dia) + 1;
  const diaAtual = Math.min(Math.max(decorridos, 0), totalDeDias);
  return {
    diaAtual,
    totalDeDias,
    fracao: totalDeDias > 0 ? diaAtual / totalDeDias : 0
  };
}
