import type { PurchaseOrder } from "../../api/client";

export type StatusPedido = PurchaseOrder["status"];
export type TomStatus = "success" | "info" | "danger" | "neutral" | "warning";

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisão",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  RECEBIDO_PARCIAL: "Recebido parcial",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
  ENCERRADO_LEGADO: "Encerrado (legado)"
};

export const ROTULO_ORIGEM: Record<PurchaseOrder["source"], string> = {
  PRE_LISTA_COMPRADOR: "Pré-lista",
  PLANEJAMENTO_COMPRA: "Planejamento de compra",
  REQUISICAO: "Requisição de insumos",
  MANUAL: "Manual"
};

export function pluralPedidos(n: number): string {
  return `${n} ${n === 1 ? "pedido" : "pedidos"}`;
}

export function rotuloStatus(status: string): string {
  return ROTULO_STATUS[status as StatusPedido] ?? status;
}

export function rotuloOrigem(origem: string): string {
  return ROTULO_ORIGEM[origem as PurchaseOrder["source"]] ?? "Manual";
}

export function tomStatus(status: string): TomStatus {
  if (status === "APROVADO" || status === "RECEBIDO") return "success";
  if (status === "EM_REVISAO" || status === "ENVIADO" || status === "RECEBIDO_PARCIAL") return "info";
  if (status === "CANCELADO") return "danger";
  if (status === "ENCERRADO_LEGADO") return "neutral";
  return "warning";
}

/** Etapas do fluxo em aberto: cada uma é um cartão do resumo, que filtra a lista. */
export type Etapa = "rascunho" | "revisao" | "aEnviar" | "aReceber" | "recebidos";

export const STATUS_DA_ETAPA: Record<Etapa, StatusPedido[]> = {
  rascunho: ["RASCUNHO"],
  revisao: ["EM_REVISAO"],
  aEnviar: ["APROVADO"],
  aReceber: ["ENVIADO", "RECEBIDO_PARCIAL"],
  recebidos: ["RECEBIDO"]
};

/** Situação do pedido: as abas acima da lista. */
export type Vista = "abertos" | "concluidos" | "cancelados" | "todos";

const STATUS_DA_VISTA: Record<Exclude<Vista, "todos">, StatusPedido[]> = {
  abertos: ["RASCUNHO", "EM_REVISAO", "APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"],
  // Os 73 rascunhos antigos encerrados em 16/10 viraram compra: contam como concluídos.
  concluidos: ["RECEBIDO", "ENCERRADO_LEGADO"],
  cancelados: ["CANCELADO"]
};

export function vistaDaEtapa(etapa: Etapa): Vista {
  return etapa === "recebidos" ? "concluidos" : "abertos";
}

export function valorDo(pedido: PurchaseOrder): number {
  const valor = Number(pedido.estimatedTotal ?? 0);
  return Number.isFinite(valor) ? valor : 0;
}

export type TotalEtapa = { quantidade: number; valor: number };

export function totaisPorEtapa(pedidos: PurchaseOrder[]): Record<Etapa, TotalEtapa> {
  const totais = Object.fromEntries(
    (Object.keys(STATUS_DA_ETAPA) as Etapa[]).map((etapa) => [etapa, { quantidade: 0, valor: 0 }])
  ) as Record<Etapa, TotalEtapa>;
  for (const pedido of pedidos) {
    const etapa = (Object.keys(STATUS_DA_ETAPA) as Etapa[]).find((e) => STATUS_DA_ETAPA[e].includes(pedido.status));
    if (!etapa) continue;
    totais[etapa] = { quantidade: totais[etapa].quantidade + 1, valor: totais[etapa].valor + valorDo(pedido) };
  }
  return totais;
}

export function contagemPorVista(pedidos: PurchaseOrder[]): Record<Vista, number> {
  const conta = (vista: Exclude<Vista, "todos">) => pedidos.filter((p) => STATUS_DA_VISTA[vista].includes(p.status)).length;
  return { abertos: conta("abertos"), concluidos: conta("concluidos"), cancelados: conta("cancelados"), todos: pedidos.length };
}

/** Sem acento e em minúsculas: "pao" acha "Pão". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrarPedidos(
  pedidos: PurchaseOrder[],
  { vista, etapa, busca }: { vista: Vista; etapa: Etapa | null; busca: string }
): PurchaseOrder[] {
  const termo = normalizar(busca);
  return pedidos.filter((pedido) => {
    if (etapa) {
      if (!STATUS_DA_ETAPA[etapa].includes(pedido.status)) return false;
    } else if (vista !== "todos" && !STATUS_DA_VISTA[vista].includes(pedido.status)) {
      return false;
    }
    if (!termo) return true;
    return normalizar(`${pedido.code} ${pedido.supplierNameSnapshot}`).includes(termo);
  });
}

/** Data no formato AAAA-MM-DD lida em UTC: o backend grava a previsão como meia-noite UTC. */
export function diaUtc(valor?: string | null): string {
  return valor ? new Date(valor).toISOString().slice(0, 10) : "";
}

/** Previsão vencida de pedido que ainda espera entrega. */
export function entregaAtrasada(pedido: PurchaseOrder, hoje: string): boolean {
  if (!pedido.expectedDeliveryDate) return false;
  if (!["APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"].includes(pedido.status)) return false;
  return diaUtc(pedido.expectedDeliveryDate) < hoje;
}

export type PassoFluxo = { chave: string; rotulo: string; data: string | null; estado: "feito" | "atual" | "pendente" };

const FLUXO: Array<{ chave: string; rotulo: string; status: StatusPedido[]; data: (p: PurchaseOrder) => string | null }> = [
  { chave: "rascunho", rotulo: "Rascunho", status: ["RASCUNHO"], data: (p) => p.createdAt },
  { chave: "revisao", rotulo: "Em revisão", status: ["EM_REVISAO"], data: (p) => p.sentToReviewAt },
  { chave: "aprovado", rotulo: "Aprovado", status: ["APROVADO"], data: (p) => p.approvedAt },
  { chave: "enviado", rotulo: "Enviado", status: ["ENVIADO", "RECEBIDO_PARCIAL"], data: (p) => p.sentAt },
  { chave: "recebido", rotulo: "Recebido", status: ["RECEBIDO"], data: (p) => p.receivedAt }
];

/** Linha do tempo do pedido; vazia para cancelado e legado, que saem do fluxo. */
export function passosDoFluxo(pedido: PurchaseOrder): PassoFluxo[] {
  const atual = FLUXO.findIndex((passo) => passo.status.includes(pedido.status));
  if (atual < 0) return [];
  return FLUXO.map((passo, indice) => ({
    chave: passo.chave,
    rotulo: passo.chave === "enviado" && pedido.status === "RECEBIDO_PARCIAL" ? "Recebido parcial" : passo.rotulo,
    data: passo.data(pedido),
    estado: indice < atual || (indice === atual && pedido.status === "RECEBIDO") ? "feito" : indice === atual ? "atual" : "pendente"
  }));
}
