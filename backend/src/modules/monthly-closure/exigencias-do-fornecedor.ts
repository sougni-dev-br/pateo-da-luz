// Exigências mensais de um fornecedor obrigatório no Fechamento Mensal.
//
// A checklist antiga pergunta só "este fornecedor teve ALGUMA compra no mês?".
// Isso não serve quando o mesmo fornecedor tem dois lançamentos obrigatórios —
// o condomínio do shopping cobra o condomínio do mês E a parcela de um acordo de
// dívida: lançar só um dos dois deixava o fornecedor "presente" e o outro esquecido.
//
// Cada exigência é reconhecida pelo PRODUTO dos itens da compra e pode ser marcada
// como quitada (acordo pago), o que encerra a cobrança dela sem apagar o histórico.
// Sem nenhuma exigência ativa o fornecedor segue a regra antiga.
//
// Funções puras, sem banco, para poder testar.

export type ExigenciaCadastrada = {
  id: string;
  label: string;
  productId: string;
  productName: string;
  settledAt: Date | null;
};

/** Itens das compras ativas do mês do fornecedor, somados por produto. */
export type LancamentoDoProduto = {
  productId: string;
  total: number;
  /** Compras distintas em que o produto aparece. */
  count: number;
};

export type ExigenciaAvaliada = {
  id: string;
  label: string;
  productName: string;
  quitada: boolean;
  present: boolean;
  total: number;
  purchaseCount: number;
};

export function chaveDaExigencia(supplierId: string, exigenciaId: string): string {
  return `supplier:${supplierId}:${exigenciaId}`;
}

export function avaliarExigencias(
  exigencias: ExigenciaCadastrada[],
  lancamentos: LancamentoDoProduto[]
): ExigenciaAvaliada[] {
  const porProduto = new Map(lancamentos.map((l) => [l.productId, l]));
  return exigencias.map((e) => {
    const lancado = porProduto.get(e.productId);
    return {
      id: e.id,
      label: e.label,
      productName: e.productName,
      quitada: e.settledAt !== null,
      present: (lancado?.count ?? 0) > 0,
      total: lancado?.total ?? 0,
      purchaseCount: lancado?.count ?? 0
    };
  });
}

const ativas = (avaliadas: ExigenciaAvaliada[]) => avaliadas.filter((e) => !e.quitada);

/**
 * O fornecedor está presente no mês quando TODAS as exigências ativas estão.
 * `null` = não há exigência ativa; vale a regra antiga (qualquer compra do mês).
 */
export function fornecedorPresenteComExigencias(avaliadas: ExigenciaAvaliada[]): boolean | null {
  const lista = ativas(avaliadas);
  if (lista.length === 0) return null;
  return lista.every((e) => e.present);
}

export function pendenciasDasExigencias(entrada: {
  supplierId: string;
  supplierName: string;
  aplicaNoMes: boolean;
  exigencias: ExigenciaAvaliada[];
}): Array<{ key: string; label: string }> {
  if (!entrada.aplicaNoMes) return [];
  return ativas(entrada.exigencias)
    .filter((e) => !e.present)
    .map((e) => ({
      key: chaveDaExigencia(entrada.supplierId, e.id),
      label: `Fornecedor: ${entrada.supplierName} — ${e.label}`
    }));
}
