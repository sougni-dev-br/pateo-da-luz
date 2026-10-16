// Regras (puras) da tela que liga a nota aos pedidos de compra. As mesmas contas do servidor, para a tela
// já mostrar o que vai acontecer; quem vale é o servidor.

export type ItemEmAberto = {
  purchaseOrderItemId: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  orderCreatedAt: string;
  productId: string;
  productName: string;
  unit: string | null;
  pedida: number;
  restante: number;
  vinculada: number | null;
  /** Falso quando o pedido e a nota usam unidades diferentes (caixa x unidade): a quantidade não é comparável. */
  unidadeCompativel: boolean;
};

const arredondar = (valor: number) => Math.round(valor * 1000) / 1000;

/** Divide a quantidade da nota pelos pedidos em aberto do produto, do mais antigo para o mais novo. */
export function sugerirDivisao(
  quantidadeNota: number,
  abertos: Array<Pick<ItemEmAberto, "purchaseOrderItemId" | "restante" | "orderCreatedAt">>
): Record<string, number> {
  let sobra = arredondar(quantidadeNota);
  const out: Record<string, number> = {};
  for (const a of [...abertos].sort((x, y) => x.orderCreatedAt.localeCompare(y.orderCreatedAt))) {
    if (sobra <= 0) break;
    const parte = arredondar(Math.min(sobra, Math.max(a.restante, 0)));
    if (parte > 0) out[a.purchaseOrderItemId] = parte;
    sobra = arredondar(sobra - parte);
  }
  return out;
}

/** Sugestão para todos os produtos da nota de uma vez. */
export function sugerirParaNota(
  itensDaNota: Array<{ productId: string; quantity: number }>,
  abertos: ItemEmAberto[]
): Record<string, number> {
  const totalPorProduto = new Map<string, number>();
  for (const i of itensDaNota) totalPorProduto.set(i.productId, arredondar((totalPorProduto.get(i.productId) ?? 0) + i.quantity));
  const out: Record<string, number> = {};
  for (const [productId, total] of totalPorProduto) {
    Object.assign(out, sugerirDivisao(total, abertos.filter((a) => a.productId === productId && a.unidadeCompativel)));
  }
  return out;
}

export type GrupoDePedido = { orderId: string; orderCode: string; orderStatus: string; orderCreatedAt: string; itens: ItemEmAberto[] };

export function agruparPorPedido(itens: ItemEmAberto[]): GrupoDePedido[] {
  const grupos = new Map<string, GrupoDePedido>();
  for (const item of itens) {
    const g = grupos.get(item.orderId) ?? { orderId: item.orderId, orderCode: item.orderCode, orderStatus: item.orderStatus, orderCreatedAt: item.orderCreatedAt, itens: [] };
    g.itens.push(item);
    grupos.set(item.orderId, g);
  }
  return [...grupos.values()].sort((a, b) => a.orderCreatedAt.localeCompare(b.orderCreatedAt));
}

/** Produtos em que a soma ligada aos pedidos passa do que a nota trouxe (aviso, não bloqueio). */
export function produtosAcimaDaNota(
  vinculos: Record<string, number>,
  abertos: ItemEmAberto[],
  itensDaNota: Array<{ productId: string; quantity: number }>
): string[] {
  const naNota = new Map<string, number>();
  for (const i of itensDaNota) naNota.set(i.productId, arredondar((naNota.get(i.productId) ?? 0) + i.quantity));
  const ligado = new Map<string, { nome: string; total: number }>();
  for (const a of abertos) {
    const q = vinculos[a.purchaseOrderItemId];
    if (!q) continue;
    const atual = ligado.get(a.productId) ?? { nome: a.productName, total: 0 };
    ligado.set(a.productId, { nome: atual.nome, total: arredondar(atual.total + q) });
  }
  return [...ligado].filter(([id, v]) => v.total > (naNota.get(id) ?? 0)).map(([, v]) => v.nome);
}

/** Lê "1,5" ou "1.5"; vazio, zero ou inválido viram null (sem vínculo). */
export function lerQuantidade(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Tira do que foi marcado os itens que a lista de pedidos em aberto não traz mais (produto removido da nota, por exemplo). */
export function descartarOrfaos(valor: Record<string, string>, abertos: ItemEmAberto[]): Record<string, string> {
  const validos = new Set(abertos.map((a) => a.purchaseOrderItemId));
  return Object.fromEntries(Object.entries(valor).filter(([id]) => validos.has(id)));
}
