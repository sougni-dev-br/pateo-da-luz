// Como o cardápio do PDV é classificado para as análises de venda por pessoa. Fica num lugar só:
// o SQL do serviço e os relatórios usam as mesmas listas, para a mesma bebida não ser contada de
// um jeito na consulta e de outro na tela.
//
// As categorias são EXATAS (igualdade), não regex: uma regex de "álcool" já casou com "BEBIDAS NÃO
// ALCOOLICAS" e inflou o número cinco vezes.
export const CATEGORIAS_BEBIDA = ["BEBIDAS", "BEBIDAS NÃO ALCOOLICAS", "BEBIDAS ALCOOLICAS", "VINHOS"] as const;
export const CATEGORIAS_ALCOOL = ["BEBIDAS ALCOOLICAS", "VINHOS"] as const;
export const CATEGORIA_SOBREMESA = "SOBREMESA";
// Sobremesa também aparece como GRUPO ("SOBREMESAS") em itens de outra categoria.
export const PADRAO_GRUPO_SOBREMESA = "SOBREMESA";
// Palavra inteira: "CAFETEIRA" e "DESCAFEINADO" não são café.
export const PADRAO_NOME_CAFE = "\\mCAF(E|É)S?\\M";

export type ItemDeAtencao = "bebida" | "alcool" | "cafe" | "sobremesa";
export const ITENS_DE_ATENCAO: ItemDeAtencao[] = ["bebida", "alcool", "cafe", "sobremesa"];
export const ROTULO_ITEM: Record<ItemDeAtencao, string> = { bebida: "Bebida", alcool: "Álcool", cafe: "Café", sobremesa: "Sobremesa" };
