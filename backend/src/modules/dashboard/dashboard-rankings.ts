// Rankings de compras do Dashboard, separados pela natureza do item.
// Função pura: a rota busca as notas e esta função só soma.

export type Natureza = "INSUMO" | "EMBALAGEM" | "CONSUMO" | "DURAVEL" | "SERVICO";
export type NaturezaChave = Natureza | "SEM_NATUREZA";
export type VisaoChave = "TODAS" | NaturezaChave;

export const ORDEM_NATUREZAS: NaturezaChave[] = ["INSUMO", "EMBALAGEM", "CONSUMO", "DURAVEL", "SERVICO", "SEM_NATUREZA"];

/** Linha que segura o que a nota cobra mas nenhum item explica. */
export const SEM_ITEMIZACAO = "Sem itemização";
const SEM_ITEMIZACAO_MINIMO = 1;
const TOP = 10;

export type ItemDeCompra = {
  totalPrice: number;
  productName: string;
  /** Categoria do CADASTRO do produto — é a que a reorganização de 10/2026 deixou certa. */
  categoryName: string | null;
  /** Categoria escrita na nota/planilha importada; só vale se o produto não tiver categoria. */
  rawCategory: string | null;
  nature: Natureza | null;
  /** Natureza da categoria do cadastro (a categoria pertence a uma só). */
  categoryNature?: Natureza | null;
  /** Subcategoria do cadastro do produto. */
  subcategoryName?: string | null;
};

export type CompraParaRanking = {
  supplierName: string;
  totalAmount: number;
  items: ItemDeCompra[];
};

/** Na categoria, `children` traz as subcategorias dela (todas, maiores primeiro). */
export type LinhaRanking = { name: string; total: number; children?: Array<{ name: string; total: number }> };

export const SEM_SUBCATEGORIA = "Sem subcategoria";
export type Ranking = { rows: LinhaRanking[]; total: number };
export type Visao = { category: Ranking; supplier: Ranking; product: Ranking };

export type RankingsDeCompras = {
  /** Total de itens por natureza, na ordem fixa (só as que aparecem no mês). */
  byNature: Array<{ nature: NaturezaChave; total: number; items: number }>;
  /** Diferença entre o valor das notas e a soma dos itens (nota sem itemização). */
  unitemizedTotal: number;
  views: Partial<Record<VisaoChave, Visao>>;
};

class Somador {
  private readonly mapa = new Map<string, number>();
  private readonly filhos = new Map<string, Map<string, number>>();
  add(chave: string, valor: number, filho?: string) {
    this.mapa.set(chave, (this.mapa.get(chave) ?? 0) + valor);
    if (filho === undefined) return;
    const sub = this.filhos.get(chave) ?? new Map<string, number>();
    sub.set(filho, (sub.get(filho) ?? 0) + valor);
    this.filhos.set(chave, sub);
  }
  ranking(): Ranking {
    const linhas: LinhaRanking[] = [...this.mapa.entries()].map(([name, total]) => {
      const sub = this.filhos.get(name);
      if (!sub) return { name, total };
      const children = [...sub.entries()].map(([n, t]) => ({ name: n, total: t })).sort((a, b) => b.total - a.total);
      return { name, total, children };
    });
    const total = linhas.reduce((s, l) => s + l.total, 0);
    return { rows: linhas.sort((a, b) => b.total - a.total).slice(0, TOP), total };
  }
}

type Somadores = { category: Somador; supplier: Somador; product: Somador };
const novosSomadores = (): Somadores => ({ category: new Somador(), supplier: new Somador(), product: new Somador() });

export function categoriaDoItem(item: Pick<ItemDeCompra, "categoryName" | "rawCategory">): string {
  return item.categoryName ?? item.rawCategory ?? "Sem categoria";
}

export function montarRankings(compras: CompraParaRanking[]): RankingsDeCompras {
  const todas = novosSomadores();
  const porNatureza = new Map<NaturezaChave, Somadores>();
  const totais = new Map<NaturezaChave, { total: number; items: number }>();
  let unitemizedTotal = 0;

  for (const compra of compras) {
    // Na visão de todas, o fornecedor soma a NOTA inteira (é o que se paga a ele).
    todas.supplier.add(compra.supplierName, compra.totalAmount);
    let somaItens = 0;

    for (const item of compra.items) {
      somaItens += item.totalPrice;
      const categoria = categoriaDoItem(item);
      const subcategoria = item.subcategoryName ?? SEM_SUBCATEGORIA;
      todas.category.add(categoria, item.totalPrice, subcategoria);
      todas.product.add(item.productName, item.totalPrice);

      // Produto ainda sem natureza herda a da categoria.
      const chave: NaturezaChave = item.nature ?? item.categoryNature ?? "SEM_NATUREZA";
      const somadores = porNatureza.get(chave) ?? novosSomadores();
      porNatureza.set(chave, somadores);
      somadores.category.add(categoria, item.totalPrice, subcategoria);
      // Dentro de uma natureza, o fornecedor soma só os itens dela: o fornecedor
      // de hortifruti que também vendeu um saco de lixo não entra em Consumo pelo
      // valor da nota inteira.
      somadores.supplier.add(compra.supplierName, item.totalPrice);
      somadores.product.add(item.productName, item.totalPrice);

      const t = totais.get(chave) ?? { total: 0, items: 0 };
      t.total += item.totalPrice;
      t.items += 1;
      totais.set(chave, t);
    }
    unitemizedTotal += compra.totalAmount - somaItens;
  }

  // Centavos de arredondamento dos itens não viram linha; diferença de verdade, sim.
  if (Math.abs(unitemizedTotal) < SEM_ITEMIZACAO_MINIMO) unitemizedTotal = 0;
  if (unitemizedTotal !== 0) todas.category.add(SEM_ITEMIZACAO, unitemizedTotal);

  const views: Partial<Record<VisaoChave, Visao>> = {
    TODAS: { category: todas.category.ranking(), supplier: todas.supplier.ranking(), product: todas.product.ranking() },
  };
  for (const [chave, s] of porNatureza) {
    views[chave] = { category: s.category.ranking(), supplier: s.supplier.ranking(), product: s.product.ranking() };
  }

  const byNature = ORDEM_NATUREZAS.filter((n) => totais.has(n)).map((nature) => ({ nature, ...totais.get(nature)! }));

  return { byNature, unitemizedTotal, views };
}
