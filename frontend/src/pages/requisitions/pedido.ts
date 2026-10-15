import type { RequisitionPurchaseItem, RequisitionPurchaseSupplierOption } from "../../api/client";
import { lerNumero } from "../../lib/fichaTecnica";

/** O que a pessoa decidiu para cada item na revisão: quanto comprar e de quem. Quantidade vazia = não comprar. */
export type DecisaoDoItem = { quantity: string; supplierId: string | null };
export type Decisoes = Record<string, DecisaoDoItem>;

const emTexto = (valor: number) => String(Math.round(valor * 1000) / 1000).replace(".", ",");

/** Começa pelo que a requisição sugere (repor o que saiu) e pelo fornecedor de sempre; tudo pode ser trocado. */
export function decisoesIniciais(itens: RequisitionPurchaseItem[]): Decisoes {
  return Object.fromEntries(itens.map((i) => [i.productId, { quantity: emTexto(i.suggestedQuantity), supplierId: i.defaultSupplierId }]));
}

/** Preço de referência do fornecedor escolhido, como no planejamento: o menor que ele já praticou; sem histórico dele, o último ou o menor geral. */
export function precoDoItem(item: RequisitionPurchaseItem, supplierId: string | null): number | null {
  if (supplierId) {
    const opcao = item.supplierOptions.find((o) => o.supplierId === supplierId);
    if (opcao) return opcao.bestUnitPrice;
  }
  return item.lastUnitPrice ?? item.bestUnitPrice ?? null;
}

/** Os até 3 fornecedores recomendados: menor preço, depois mais compras, depois compra mais recente (o mesmo ranking do planejamento). */
export function recomendados(item: RequisitionPurchaseItem): RequisitionPurchaseSupplierOption[] {
  return [...item.supplierOptions]
    .sort((a, b) => {
      if (a.bestUnitPrice !== b.bestUnitPrice) return a.bestUnitPrice - b.bestUnitPrice;
      if (a.purchaseCount !== b.purchaseCount) return b.purchaseCount - a.purchaseCount;
      return (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? "");
    })
    .slice(0, 3);
}

/** O preço do fornecedor escolhido é da embalagem, não da unidade do estoque: revisar antes de enviar. */
export function precisaRevisarUnidade(item: RequisitionPurchaseItem, supplierId: string | null): boolean {
  const opcao = supplierId ? item.supplierOptions.find((o) => o.supplierId === supplierId) : null;
  return opcao ? opcao.conversionMissing : item.conversionMissing;
}

export type SituacaoDoItem = {
  /** Quanto vai no pedido (0 quando a pessoa deixou de fora). */
  quantidade: number;
  foraDoPedido: boolean;
  invalida: boolean;
  semFornecedor: boolean;
  alterada: boolean;
  revisarUnidade: boolean;
  preco: number | null;
  total: number | null;
};

export function situacaoDoItem(item: RequisitionPurchaseItem, decisao: DecisaoDoItem | undefined): SituacaoDoItem {
  const texto = (decisao?.quantity ?? "").trim();
  const numero = texto === "" ? 0 : lerNumero(texto);
  // Quantidade que arredonda para zero na gravação (0,0004) não é um pedido: é digitação errada.
  const invalida = texto !== "" && (!Number.isFinite(numero) || numero < 0 || (numero > 0 && Math.round(numero * 1000) === 0));
  const quantidade = invalida || !Number.isFinite(numero) ? 0 : numero;
  const foraDoPedido = !invalida && quantidade === 0;
  const supplierId = decisao?.supplierId ?? null;
  const preco = precoDoItem(item, supplierId);
  return {
    quantidade,
    foraDoPedido,
    invalida,
    semFornecedor: quantidade > 0 && !supplierId,
    alterada: !foraDoPedido && !invalida ? Math.abs(quantidade - item.suggestedQuantity) > 0.0005 : texto !== emTexto(item.suggestedQuantity),
    revisarUnidade: quantidade > 0 && precisaRevisarUnidade(item, supplierId),
    preco,
    total: preco != null && quantidade > 0 ? Math.round(quantidade * preco * 100) / 100 : null
  };
}

export type ResumoDoPedido = {
  itens: number;
  fornecedores: number;
  total: number;
  /** Itens com preço conhecido entram no total; o resto fica de fora e a tela avisa que é estimativa. */
  semPreco: number;
  semFornecedor: string[];
  invalidos: string[];
  foraDoPedido: number;
  alterados: number;
};

export function resumirPedido(itens: RequisitionPurchaseItem[], decisoes: Decisoes): ResumoDoPedido {
  const resumo: ResumoDoPedido = { itens: 0, fornecedores: 0, total: 0, semPreco: 0, semFornecedor: [], invalidos: [], foraDoPedido: 0, alterados: 0 };
  const fornecedores = new Set<string>();
  for (const item of itens) {
    const decisao = decisoes[item.productId];
    const s = situacaoDoItem(item, decisao);
    if (s.invalida) resumo.invalidos.push(item.productId);
    if (s.foraDoPedido) resumo.foraDoPedido += 1;
    if (s.alterada) resumo.alterados += 1;
    if (s.quantidade <= 0) continue;
    if (s.semFornecedor) {
      resumo.semFornecedor.push(item.productId);
      continue;
    }
    resumo.itens += 1;
    if (decisao?.supplierId) fornecedores.add(decisao.supplierId);
    if (s.total == null) resumo.semPreco += 1;
    else resumo.total += s.total;
  }
  resumo.fornecedores = fornecedores.size;
  resumo.total = Math.round(resumo.total * 100) / 100;
  return resumo;
}

/** Só gera com algo no pedido e sem item pendente: sem fornecedor ou com quantidade ilegível não passa em silêncio. */
export function podeGerar(resumo: ResumoDoPedido): boolean {
  return resumo.itens > 0 && resumo.semFornecedor.length === 0 && resumo.invalidos.length === 0;
}

export function itensParaEnviar(itens: RequisitionPurchaseItem[], decisoes: Decisoes) {
  return itens.flatMap((item) => {
    const decisao = decisoes[item.productId];
    const s = situacaoDoItem(item, decisao);
    if (s.quantidade <= 0 || !decisao?.supplierId) return [];
    return [{ productId: item.productId, supplierId: decisao.supplierId, requestedQuantity: s.quantidade, unitPriceEstimated: s.preco }];
  });
}
