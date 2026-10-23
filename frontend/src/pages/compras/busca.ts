import type { Purchase } from "../../api/client";
import { normalizar } from "../../lib/formas-pagamento";

type CompraParaBusca = Pick<
  Purchase,
  "totalAmount" | "invoiceNumber" | "purchaseNumber" | "purchaseOrderNumber" | "rawSupplierCode" | "paymentMethod" | "supplier" | "items" | "installments"
>;

/** O texto da busca geral: NF, pedido, fornecedor (nome, documento, código) e itens. Valores são tratados à parte, em combinaValor. */
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

/**
 * Valor digitado como número: aceita "13092,94", "13.092,94", "13092.94", "R$ 509" e "1.234" (milhar).
 * Devolve null quando o texto não é um valor.
 */
export function parseValor(token: string): number | null {
  const limpo = token.toLowerCase().replace(/^r\$/, "").trim();
  if (!/^\d[\d.,]*$/.test(limpo)) return null;
  const virgulas = (limpo.match(/,/g) ?? []).length;
  if (virgulas > 1) return null;
  const pontos = (limpo.match(/\./g) ?? []).length;
  let texto: string;
  if (virgulas === 1) texto = limpo.replace(/\./g, "").replace(",", ".");
  else if (pontos > 1 || /^\d{1,3}\.\d{3}$/.test(limpo)) texto = limpo.replace(/\./g, "");
  else texto = limpo;
  const valor = Number(texto);
  return Number.isFinite(valor) ? valor : null;
}

function valoresDaCompra(compra: CompraParaBusca): number[] {
  return [compra.totalAmount, ...compra.installments.map((parcela) => parcela.amount)]
    .map((valor) => Number(valor))
    .filter((valor) => Number.isFinite(valor) && valor > 0);
}

/** Como o valor aparece escrito: "13.092,94", "13092,94" e "13092.94". */
function formasDoValor(valor: number): string[] {
  const duasCasas = valor.toFixed(2);
  return [valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), duasCasas.replace(".", ","), duasCasas];
}

/**
 * O termo é um valor que bate com o total da compra ou com uma parcela: igual, ou um trecho do
 * valor escrito. Número curto sem vírgula (ex.: "50") só vale se for exato, para não casar com tudo.
 */
export function combinaValor(compra: CompraParaBusca, termo: string): boolean {
  const alvo = parseValor(termo);
  if (alvo === null) return false;
  const limpo = termo.toLowerCase().replace(/^r\$/, "").trim();
  const aceitaTrecho = /[.,]/.test(limpo) || limpo.replace(/\D/g, "").length >= 4;
  return valoresDaCompra(compra).some(
    (valor) => Math.abs(valor - alvo) < 0.005 || (aceitaTrecho && formasDoValor(valor).some((forma) => forma.includes(limpo)))
  );
}

/** Cada palavra digitada precisa aparecer em algum lugar da compra, no texto ou como valor (ordem livre). */
export function combinaBusca(compra: CompraParaBusca, termo: string): boolean {
  const palavras = normalizar(termo)
    .split(/\s+/)
    .filter((palavra) => palavra && palavra !== "r$");
  if (palavras.length === 0) return true;
  const texto = textoDaCompra(compra);
  return palavras.every((palavra) => texto.includes(palavra) || combinaValor(compra, palavra));
}

/** "pix" casa com "PIX" e "Boleto 30 dias" casa com "boleto": contém, sem acento nem caixa. */
export function combinaForma(compra: CompraParaBusca, forma: string): boolean {
  const alvo = normalizar(forma);
  if (!alvo) return true;
  const nomes = [compra.paymentMethod, ...compra.installments.map((p) => p.paymentMethodName)];
  return nomes.some((nome) => normalizar(nome).includes(alvo));
}
