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

/** Abaixo disto o casamento não é confiável o bastante para vir marcado; a pessoa escolhe. */
export const LIMITE_CASAMENTO = 0.75;
/** Dois pedidos com notas dentro desta diferença brigam pela mesma nota: não decide sozinho. */
const EMPATE = 0.05;
const IGUAL = 0.001;

export type PedidoCasado = { orderId: string; orderCode: string; itensLigados: number; itensDoPedido: number; score: number };
export type CasamentoDaNota = {
  /** Verdadeiro quando há um casamento confiável e sem ambiguidade: os vínculos podem vir marcados. */
  automatico: boolean;
  vinculos: Record<string, number>;
  pedidos: PedidoCasado[];
  /** O pedido que mais se parece com a nota, mesmo quando não é seguro marcar sozinho. */
  melhor: PedidoCasado | null;
  /** Quantidades que ligariam a nota ao `melhor`, para um toque só quando o sistema não teve certeza. */
  vinculosDoMelhor: Record<string, number>;
};

type Avaliacao = { grupo: GrupoDePedido; score: number; ligar: Record<string, number>; casados: number };

function avaliarPedido(grupo: GrupoDePedido, restanteDaNota: Map<string, number>): Avaliacao | null {
  const local = new Map(restanteDaNota);
  const ligar: Record<string, number> = {};
  let casados = 0;
  let quantidadeBate = 0;
  const produtosCasados = new Set<string>();
  const itensAbertos = grupo.itens.filter((i) => i.unidadeCompativel && i.restante > 0);
  for (const i of itensAbertos) {
    const naNota = local.get(i.productId) ?? 0;
    if (naNota <= 0) continue;
    const parte = arredondar(Math.min(naNota, i.restante));
    ligar[i.purchaseOrderItemId] = parte;
    casados += 1;
    if (Math.abs(naNota - i.restante) < IGUAL) quantidadeBate += 1;
    produtosCasados.add(i.productId);
    local.set(i.productId, arredondar(naNota - parte));
  }
  if (casados === 0) return null;
  const produtosNaNota = [...restanteDaNota.values()].filter((q) => q > 0).length;
  const coberturaDaNota = produtosCasados.size / Math.max(produtosNaNota, 1);
  const coberturaDoPedido = casados / Math.max(itensAbertos.length, 1);
  const score = 0.4 * coberturaDaNota + 0.3 * coberturaDoPedido + 0.3 * (quantidadeBate / casados);
  return { grupo, score, ligar, casados };
}

function aplicar(restanteDaNota: Map<string, number>, grupo: GrupoDePedido, ligar: Record<string, number>) {
  for (const i of grupo.itens) {
    const q = ligar[i.purchaseOrderItemId];
    if (q) restanteDaNota.set(i.productId, arredondar((restanteDaNota.get(i.productId) ?? 0) - q));
  }
}

function paraPedidoCasado(a: Avaliacao): PedidoCasado {
  return { orderId: a.grupo.orderId, orderCode: a.grupo.orderCode, itensLigados: a.casados, itensDoPedido: a.grupo.itens.length, score: Math.round(a.score * 100) / 100 };
}

/**
 * Procura, entre os pedidos em aberto do fornecedor, o que a nota está entregando: quanto da nota o pedido cobre,
 * quanto do pedido a nota cobre e se as quantidades batem. Só marca sozinho quando é confiável e não há outro
 * pedido igualmente bom disputando a mesma nota; uma nota grande pode atender mais de um pedido.
 */
export function casarNotaComPedidos(itensDaNota: Array<{ productId: string; quantity: number }>, abertos: ItemEmAberto[]): CasamentoDaNota {
  const vazio: CasamentoDaNota = { automatico: false, vinculos: {}, pedidos: [], melhor: null, vinculosDoMelhor: {} };
  const restanteDaNota = new Map<string, number>();
  for (const i of itensDaNota) {
    if (i.productId && i.quantity > 0) restanteDaNota.set(i.productId, arredondar((restanteDaNota.get(i.productId) ?? 0) + i.quantity));
  }
  if (restanteDaNota.size === 0 || abertos.length === 0) return vazio;

  const grupos = agruparPorPedido(abertos);
  const vinculos: Record<string, number> = {};
  const pedidos: PedidoCasado[] = [];
  let melhor: PedidoCasado | null = null;
  let vinculosDoMelhor: Record<string, number> = {};
  const usados = new Set<string>();

  for (let rodada = 0; rodada < 6; rodada += 1) {
    const avaliacoes = grupos
      .filter((g) => !usados.has(g.orderId))
      .map((g) => avaliarPedido(g, restanteDaNota))
      .filter((a): a is Avaliacao => a !== null)
      // Mais pontos primeiro; empate de pontos fica com o pedido mais antigo (agruparPorPedido já vem do mais antigo).
      .sort((x, y) => y.score - x.score);
    const [primeiro, segundo] = avaliacoes;
    if (!primeiro) break;
    if (rodada === 0) {
      melhor = paraPedidoCasado(primeiro);
      vinculosDoMelhor = primeiro.ligar;
    }
    if (primeiro.score < LIMITE_CASAMENTO) break;
    if (segundo && segundo.score >= LIMITE_CASAMENTO && primeiro.score - segundo.score <= EMPATE) {
      // Brigam pela mesma nota? Se o segundo ainda se sustenta depois de o primeiro levar a parte dele, os dois cabem.
      const sobra = new Map(restanteDaNota);
      aplicar(sobra, primeiro.grupo, primeiro.ligar);
      const depois = avaliarPedido(segundo.grupo, sobra);
      if (!depois || depois.score < LIMITE_CASAMENTO) return { ...vazio, melhor, vinculosDoMelhor };
    }
    Object.assign(vinculos, primeiro.ligar);
    aplicar(restanteDaNota, primeiro.grupo, primeiro.ligar);
    pedidos.push(paraPedidoCasado(primeiro));
    usados.add(primeiro.grupo.orderId);
  }
  return { automatico: pedidos.length > 0, vinculos, pedidos, melhor, vinculosDoMelhor };
}
