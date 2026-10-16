// Regras (puras) do vínculo entre o pedido de compra e a nota (compra) que o atendeu.
// Uma nota pode atender vários pedidos e um pedido pode ser atendido por várias notas, por isso o vínculo
// é por item do pedido, com a quantidade que aquela nota cobre. O recebido do pedido é sempre a soma dos
// vínculos de notas não canceladas; nada é guardado em duplicidade.

import { normalizeText } from "../../shared/utils/normalize-text.js";

export const QUANTIDADE_MAXIMA_VINCULO = 100_000;

export type VinculoGravado = { purchaseOrderItemId: string; quantity: number; purchaseCancelada: boolean };
export type VinculoInformado = { purchaseOrderItemId: string; quantity: number };

const CASAS = 1000;
const arredondar = (valor: number) => Math.round(valor * CASAS) / CASAS;

export function somarRecebido(vinculos: VinculoGravado[]): Map<string, number> {
  const soma = new Map<string, number>();
  for (const v of vinculos) {
    if (v.purchaseCancelada) continue;
    soma.set(v.purchaseOrderItemId, arredondar((soma.get(v.purchaseOrderItemId) ?? 0) + v.quantity));
  }
  return soma;
}

const ANTES_DO_ENVIO = new Set(["RASCUNHO", "EM_REVISAO", "APROVADO"]);

export type ResultadoStatus = { status: string; mudou: boolean; promovidoSemEnvio: boolean };

/**
 * Status do pedido a partir do que as notas cobriram. Pedido que ainda não tinha sido enviado pelo sistema
 * (o pedido foi feito por fora, como no WhatsApp) é promovido direto e marcado para a auditoria dizer isso.
 * Sem nenhum recebimento, quem estava recebido volta para ENVIADO; quem não tinha sido enviado fica como está.
 */
export function calcularStatusDoPedido(statusAtual: string, itens: Array<{ meta: number; recebido: number }>): ResultadoStatus {
  if (statusAtual === "CANCELADO") return { status: statusAtual, mudou: false, promovidoSemEnvio: false };
  const algumRecebido = itens.some((i) => i.recebido > 0);
  const tudoRecebido = itens.length > 0 && itens.every((i) => i.recebido >= i.meta);
  const novo = tudoRecebido ? "RECEBIDO"
    : algumRecebido ? "RECEBIDO_PARCIAL"
    : ANTES_DO_ENVIO.has(statusAtual) ? statusAtual
    : "ENVIADO";
  return {
    status: novo,
    mudou: novo !== statusAtual,
    promovidoSemEnvio: novo !== statusAtual && ANTES_DO_ENVIO.has(statusAtual) && algumRecebido
  };
}

export type ItemDePedidoConhecido = { orderId: string; orderStatus: string; supplierId: string; productId: string };

export function validarVinculos(
  vinculos: VinculoInformado[],
  itensDePedido: Map<string, ItemDePedidoConhecido>,
  compra: { supplierId: string; productIds: Set<string> }
): { ok: true } | { ok: false; message: string } {
  const vistos = new Set<string>();
  for (const v of vinculos) {
    if (!Number.isFinite(v.quantity) || v.quantity <= 0 || v.quantity > QUANTIDADE_MAXIMA_VINCULO) {
      return { ok: false, message: "Quantidade do vinculo com o pedido invalida." };
    }
    if (vistos.has(v.purchaseOrderItemId)) {
      return { ok: false, message: "O mesmo item do pedido foi informado duas vezes na mesma nota." };
    }
    vistos.add(v.purchaseOrderItemId);
    const item = itensDePedido.get(v.purchaseOrderItemId);
    if (!item) return { ok: false, message: "Item de pedido de compra nao encontrado." };
    if (item.orderStatus === "CANCELADO") return { ok: false, message: "Pedido cancelado nao pode receber nota." };
    if (item.supplierId !== compra.supplierId) return { ok: false, message: "O pedido e de outro fornecedor." };
    if (!compra.productIds.has(item.productId)) return { ok: false, message: "O produto do pedido nao esta nesta nota." };
  }
  return { ok: true };
}

/** Divide a quantidade da nota pelos pedidos em aberto, do mais antigo para o mais novo. A pessoa ajusta depois. */
export function sugerirDivisao(
  quantidadeNota: number,
  abertos: Array<{ purchaseOrderItemId: string; restante: number; criadoEm: string }>
): Array<{ purchaseOrderItemId: string; quantity: number }> {
  let sobra = arredondar(quantidadeNota);
  const out: Array<{ purchaseOrderItemId: string; quantity: number }> = [];
  for (const a of [...abertos].sort((x, y) => x.criadoEm.localeCompare(y.criadoEm))) {
    if (sobra <= 0) break;
    const parte = arredondar(Math.min(sobra, Math.max(a.restante, 0)));
    if (parte > 0) out.push({ purchaseOrderItemId: a.purchaseOrderItemId, quantity: parte });
    sobra = arredondar(sobra - parte);
  }
  return out;
}

/** O pedido guarda o nome da unidade ("unidade", "pacote") e a nota o código ("UN", "PCT"): as duas pontas viram o código. */
export function montarMapaDeUnidades(unidades: Array<{ code: string; name: string }>): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const u of unidades) {
    mapa.set(normalizeText(u.code), u.code);
    mapa.set(normalizeText(u.name), u.code);
  }
  return mapa;
}

export function mesmaUnidade(a: string | null | undefined, b: string | null | undefined, mapa: Map<string, string>): boolean {
  const chave = (texto: string | null | undefined) => {
    const limpo = normalizeText(texto ?? "");
    return limpo ? (mapa.get(limpo) ?? limpo) : "";
  };
  const ca = chave(a);
  return ca !== "" && ca === chave(b);
}

/**
 * Pedido em "caixa" e nota em "UN" não dizem a mesma coisa: ligar a quantidade da nota ao pedido daria recebido errado.
 * Só barra quando as duas pontas têm unidade e nenhuma da nota casa com a do pedido.
 */
export function unidadeCompativel(unidadeDoPedido: string | null | undefined, unidadesDaNota: Array<string | null | undefined>, mapa: Map<string, string>): boolean {
  const comUnidade = unidadesDaNota.filter((u) => (u ?? "").trim() !== "");
  if ((unidadeDoPedido ?? "").trim() === "" || comUnidade.length === 0) return true;
  return comUnidade.some((u) => mesmaUnidade(unidadeDoPedido, u, mapa));
}
