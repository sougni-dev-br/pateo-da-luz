// Por que as duas visões do CMV dão números diferentes.
//
// A tela mostrava a conta duas vezes lado a lado — "visão atual" e "visão
// gerencial" — e depois duas tabelas de compras por categoria, uma para cada.
// Como a visão atual é exatamente a mesma do topo da página, o leitor
// comparava cerca de quarenta números para descobrir o que, no fim, é uma
// única informação: a gerencial inclui categorias que a contábil não inclui.
//
// Em junho/2026 a diferença é de R$ 3.288,63, e ela está inteira em duas
// categorias: Material de Limpeza e Descartáveis. Dizer isso é mais útil do
// que mostrar as duas tabelas e deixar a subtração para quem lê.

export type CategoriaDeCompra = {
  categoryName: string;
  totalAmount: number;
  itemsCount: number;
};

export type DivergenciaDeCategoria = CategoriaDeCompra & {
  /** Quanto desta categoria só existe na visão gerencial. */
  diferenca: number;
};

export type ComparacaoDeVisoes = {
  /** Gerencial menos contábil, em reais. Positivo = a gerencial conta mais. */
  diferenca: number;
  /** A mesma diferença em pontos percentuais da receita. Null sem receita. */
  diferencaEmPontos: number | null;
  /** As categorias que explicam a diferença, da maior para a menor. */
  categorias: DivergenciaDeCategoria[];
  /** Quanto das categorias listadas não fecha com a diferença total. */
  naoExplicado: number;
  iguais: boolean;
};

/** Centavos de arredondamento não são divergência. */
const TOLERANCIA = 0.01;

export function compararVisoes(
  cmvContabil: number,
  cmvGerencial: number,
  percentualContabil: number | null,
  percentualGerencial: number | null,
  categoriasContabeis: CategoriaDeCompra[],
  categoriasGerenciais: CategoriaDeCompra[]
): ComparacaoDeVisoes {
  const diferenca = cmvGerencial - cmvContabil;

  const porNome = new Map(categoriasContabeis.map((c) => [c.categoryName, c.totalAmount]));
  const categorias = categoriasGerenciais
    .map((c) => ({ ...c, diferenca: c.totalAmount - (porNome.get(c.categoryName) ?? 0) }))
    .filter((c) => Math.abs(c.diferenca) > TOLERANCIA)
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

  // Categoria que existe só do lado contábil também é divergência — rara, mas
  // se acontecer é um defeito de classificação, e sumir com ela esconderia o
  // defeito em vez de mostrá-lo.
  const nomesGerenciais = new Set(categoriasGerenciais.map((c) => c.categoryName));
  for (const c of categoriasContabeis) {
    if (nomesGerenciais.has(c.categoryName)) continue;
    if (Math.abs(c.totalAmount) <= TOLERANCIA) continue;
    categorias.push({ ...c, totalAmount: 0, itemsCount: 0, diferenca: -c.totalAmount });
  }
  categorias.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

  const somaDasCategorias = categorias.reduce((acc, c) => acc + c.diferenca, 0);

  return {
    diferenca,
    diferencaEmPontos:
      percentualContabil == null || percentualGerencial == null
        ? null
        : percentualGerencial - percentualContabil,
    categorias,
    naoExplicado: diferenca - somaDasCategorias,
    iguais: Math.abs(diferenca) <= TOLERANCIA
  };
}
