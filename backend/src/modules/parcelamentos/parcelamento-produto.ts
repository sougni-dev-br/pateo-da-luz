// O parcelamento de dívida é despesa de serviço: um produto de estoque ou de CMV_COMPRAS
// empurraria o valor para o CMV em vez das despesas do DRE.
export type ProdutoDoParcelamento = {
  isActive: boolean;
  controlsStock: boolean;
  dreCategoryId: string | null;
  dreGroup: string | null;
};

export function motivoProdutoInvalido(p: ProdutoDoParcelamento): string | null {
  if (!p.isActive) return "O produto escolhido está inativo.";
  if (p.controlsStock) return "O produto escolhido controla estoque. Use um produto de despesa (sem estoque).";
  if (!p.dreCategoryId) return "O produto escolhido não tem categoria de DRE. Defina a categoria no cadastro do produto.";
  if (p.dreGroup === "CMV_COMPRAS") return "A categoria do produto cai no CMV. Use um produto de despesa (ex.: condomínio ou aluguel).";
  return null;
}
