// Regras (puras) do pedido de compra gerado a partir de uma requisição de insumos.
// A requisição diz o que saiu do estoque; o pedido é a reposição, e a quantidade que a pessoa
// confirmar na revisão é a que vale para o pedido (a retirada fica guardada só como sugestão).

export const QUANTIDADE_MAXIMA = 100_000;
/** Preço por unidade acima disso é erro de digitação (e estouraria a coluna do total estimado). */
export const PRECO_MAXIMO = 1_000_000;

export type OpcaoDeFornecedor = {
  supplierId: string;
  supplierName: string;
  /** Último preço pago por 1 unidade do estoque (convertido); null quando a compra não tinha conversão. */
  lastUnitPrice: number | null;
  lastPurchaseDate: Date;
  purchaseCount: number;
};

export type LinhaDeCompra = {
  productId: string;
  supplierId: string | null;
  quantity: number;
  unitPrice: number | null;
};

/** Quem fornece o item por padrão: o fornecedor principal do cadastro; sem ele, o da última compra. */
export function fornecedorPadrao(principalId: string | null, opcoes: OpcaoDeFornecedor[]): string | null {
  if (principalId) return principalId;
  const maisRecente = [...opcoes].sort((a, b) => b.lastPurchaseDate.getTime() - a.lastPurchaseDate.getTime())[0];
  return maisRecente?.supplierId ?? null;
}

/** Preço da última compra daquele fornecedor, se houver. */
export function precoDoFornecedor(opcoes: OpcaoDeFornecedor[], supplierId: string | null): number | null {
  if (!supplierId) return null;
  return opcoes.find((o) => o.supplierId === supplierId)?.lastUnitPrice ?? null;
}

/** A reposição sugerida é o que saiu: arredondada em 3 casas, que é a precisão do pedido. */
export function quantidadeSugerida(retirada: number): number {
  return Math.round(retirada * 1000) / 1000;
}

export type ItemRecebido = { productId: unknown; supplierId: unknown; requestedQuantity: unknown; unitPriceEstimated?: unknown };

export type ResultadoDaValidacao = {
  validos: LinhaDeCompra[];
  /** Quantidade fora da escala: erro de digitação grosseiro que aborta tudo (como no planejamento de compra). */
  foraDaEscala: Array<{ productId: string; quantity: number }>;
  ignorados: Array<{ productId: string | null; reason: string }>;
};

const numero = (valor: unknown): number | null => {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const texto = (valor: unknown): string | null => {
  const t = String(valor ?? "").trim();
  return t || null;
};

/**
 * O que a pessoa confirmou na revisão. Só entra produto que veio da requisição, com fornecedor e quantidade
 * válidos; o resto é devolvido com o motivo para a tela mostrar o que ficou de fora.
 */
export function validarItensDoPedido(itens: ItemRecebido[], produtosDaRequisicao: Set<string>): ResultadoDaValidacao {
  const resultado: ResultadoDaValidacao = { validos: [], foraDaEscala: [], ignorados: [] };
  const vistos = new Set<string>();
  for (const item of itens) {
    if (item == null || typeof item !== "object") {
      resultado.ignorados.push({ productId: null, reason: "Item inválido." });
      continue;
    }
    const productId = texto(item.productId);
    if (!productId) {
      resultado.ignorados.push({ productId: null, reason: "Produto inválido." });
      continue;
    }
    if (!produtosDaRequisicao.has(productId)) {
      resultado.ignorados.push({ productId, reason: "Produto não faz parte desta requisição." });
      continue;
    }
    if (vistos.has(productId)) {
      resultado.ignorados.push({ productId, reason: "Produto repetido." });
      continue;
    }
    vistos.add(productId);
    const informada = numero(item.requestedQuantity);
    // Arredonda antes de validar: 0,0004 vira 0,000 na gravação e não pode passar como quantidade válida.
    const quantity = informada == null ? null : Math.round(informada * 1000) / 1000;
    if (quantity == null || quantity <= 0) {
      resultado.ignorados.push({ productId, reason: "Quantidade inválida." });
      continue;
    }
    if (quantity > QUANTIDADE_MAXIMA) {
      resultado.foraDaEscala.push({ productId, quantity });
      continue;
    }
    const supplierId = texto(item.supplierId);
    if (!supplierId) {
      resultado.ignorados.push({ productId, reason: "Fornecedor não selecionado." });
      continue;
    }
    const preco = numero(item.unitPriceEstimated);
    resultado.validos.push({ productId, supplierId, quantity, unitPrice: preco != null && preco >= 0 && preco <= PRECO_MAXIMO ? preco : null });
  }
  return resultado;
}

export function agruparPorFornecedor<T extends { supplierId: string | null }>(linhas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const linha of linhas) {
    if (!linha.supplierId) continue;
    grupos.set(linha.supplierId, [...(grupos.get(linha.supplierId) ?? []), linha]);
  }
  return grupos;
}

export function totalEstimado(quantidade: number, precoUnitario: number | null): number | null {
  return precoUnitario == null ? null : Math.round(quantidade * precoUnitario * 100) / 100;
}
