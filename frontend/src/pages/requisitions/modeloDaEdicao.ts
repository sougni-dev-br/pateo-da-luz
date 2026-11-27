import type { InventoryRequisition } from "../../api/client";
import type { Escolhas } from "./catalogo";
import type { ModeloInicial } from "./FormularioDaRequisicao";

const arredondar = (valor: number) => Math.round(valor * 10000) / 10000;

/** Quanto a requisição tirou de cada produto. Produto em duas linhas soma. */
export function retiradoPorProduto(req: InventoryRequisition): Record<string, number> {
  const retirado: Record<string, number> = {};
  for (const item of req.items ?? []) {
    if (item.productId) retirado[item.productId] = arredondar((retirado[item.productId] ?? 0) + Number(item.quantity));
  }
  return retirado;
}

/**
 * Retirada como o formulário edita: quantidade com vírgula, na unidade em que foi gravada.
 * O mesmo produto em duas linhas vira uma só com a soma: guardar só a última devolveria a outra ao estoque.
 */
/** Unidade em que cada produto foi gravado (a primeira linha dele). */
function unidadesGravadas(req: InventoryRequisition): Record<string, string> {
  const unidade: Record<string, string> = {};
  for (const item of req.items ?? []) {
    if (item.productId && !(item.productId in unidade)) unidade[item.productId] = item.recordedUnit ?? item.unit ?? "UN";
  }
  return unidade;
}

export function escolhasDaRequisicao(req: InventoryRequisition): Escolhas {
  const unidade = unidadesGravadas(req);
  const escolhas: Escolhas = {};
  for (const [productId, quantidade] of Object.entries(retiradoPorProduto(req))) {
    escolhas[productId] = { unit: unidade[productId], quantity: String(quantidade).replace(".", ",") };
  }
  return escolhas;
}

/** A data da requisição é gravada como meia-noite UTC: lida em UTC, como no formatDate, para não voltar um dia. */
export const dataDaRequisicao = (valor: string) => new Date(valor).toISOString().slice(0, 10);

/** O formulário de lançamento aberto sobre uma requisição registrada. Exige a versão para salvar. */
export function modeloDeEdicao(req: InventoryRequisition & { updatedAt: string }): ModeloInicial {
  return {
    cabecalho: { date: dataDaRequisicao(req.date), shift: req.shift, reason: req.reason, reasonNotes: req.reasonNotes ?? "", sectorId: req.sectorId ?? "", notes: req.notes ?? "" },
    escolhas: escolhasDaRequisicao(req),
    edicao: { id: req.id, code: req.code, updatedAt: req.updatedAt, retirado: retiradoPorProduto(req), unidadeRetirada: unidadesGravadas(req) }
  };
}
