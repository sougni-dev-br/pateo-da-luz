import type { Purchase } from "../../api/client";
import { normalizar } from "../../lib/formas-pagamento";

type CompraParaBusca = Pick<
  Purchase,
  "invoiceNumber" | "purchaseNumber" | "purchaseOrderNumber" | "rawSupplierCode" | "paymentMethod" | "supplier" | "items" | "installments"
>;

/** Tudo o que a busca geral enxerga numa compra: NF, pedido, fornecedor (nome, documento, código) e itens. */
export function textoDaCompra(compra: CompraParaBusca): string {
  return normalizar(
    [
      compra.invoiceNumber,
      compra.purchaseNumber,
      compra.purchaseOrderNumber,
      compra.rawSupplierCode,
      compra.supplier.name,
      compra.supplier.document,
      compra.supplier.externalCode,
      ...compra.items.map((item) => `${item.rawProductCode ?? ""} ${item.rawProductName}`)
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/** Cada palavra digitada precisa aparecer em algum lugar da compra (ordem livre). */
export function combinaBusca(compra: CompraParaBusca, termo: string): boolean {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  const texto = textoDaCompra(compra);
  return palavras.every((palavra) => texto.includes(palavra));
}

/** "pix" casa com "PIX" e "Boleto 30 dias" casa com "boleto": contém, sem acento nem caixa. */
export function combinaForma(compra: CompraParaBusca, forma: string): boolean {
  const alvo = normalizar(forma);
  if (!alvo) return true;
  const nomes = [compra.paymentMethod, ...compra.installments.map((p) => p.paymentMethodName)];
  return nomes.some((nome) => normalizar(nome).includes(alvo));
}
