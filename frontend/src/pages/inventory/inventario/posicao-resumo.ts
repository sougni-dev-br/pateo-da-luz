import type { ItemDaPosicao } from "../../../api/client";

export type ResumoDaPosicao = {
  /** Valor da ultima contagem aprovada de cada produto contado. */
  valor: number;
  contados: number;
  /** Compras recebidas depois das contagens. */
  valorCompras: number;
  /** Teto: o sistema nao registra consumo, entao hoje o estoque e no maximo isto. */
  teto: number;
  maisRecente: string | null;
};

export function resumirPosicao(itens: ItemDaPosicao[]): ResumoDaPosicao {
  const contados = itens.filter((i) => i.quantidade != null);
  const valor = contados.reduce((s, i) => s + (i.valor ?? 0), 0);
  const valorCompras = itens.reduce((s, i) => s + i.valorComprasDesde, 0);
  return {
    valor,
    contados: contados.length,
    valorCompras,
    teto: valor + valorCompras,
    maisRecente: contados.reduce<string | null>((m, i) => (i.contadoEm && (!m || i.contadoEm > m) ? i.contadoEm : m), null)
  };
}

export type ResumoDoSetor = {
  setor: string;
  valor: number;
  contados: number;
  /** Produtos controlados do setor, contados ou nao. */
  total: number;
  /** Contagem mais recente do setor: cada setor e contado em seu dia. */
  maisRecente: string | null;
};

export const SEM_SETOR = "Sem setor";

/** Valor da ultima contagem de cada setor, do maior para o menor. */
export function resumirPorSetor(itens: ItemDaPosicao[]): ResumoDoSetor[] {
  const mapa = new Map<string, ItemDaPosicao[]>();
  for (const item of itens) {
    const chave = item.sectorName ?? SEM_SETOR;
    mapa.set(chave, [...(mapa.get(chave) ?? []), item]);
  }
  return [...mapa.entries()]
    .map(([setor, lista]) => {
      const r = resumirPosicao(lista);
      return { setor, valor: r.valor, contados: r.contados, total: lista.length, maisRecente: r.maisRecente };
    })
    .sort((a, b) => b.valor - a.valor || a.setor.localeCompare(b.setor, "pt-BR"));
}
