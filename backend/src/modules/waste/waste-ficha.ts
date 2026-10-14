// Prato criado pelo lançamento de desperdício (o purê, uma guarnição do buffet) que aguarda a ficha técnica.
// Quando a ficha fica completa, o que foi lançado sem valor passa a valer pelo custo dela.

import { normalizarUnidade } from "../../shared/unidades/conversao.js";
import { carregarDetalhe, type ClienteDoBanco } from "../dishes/dish-detail.js";
import { calcularValor } from "./waste.js";

/** Origem gravada no lançamento valorado depois, para a Análise e a auditoria distinguirem do custo do dia. */
export const FONTE_DO_CUSTO_RETROATIVO = "FICHA_TECNICA (retroativo)";

const MIN_NOME = 3;
const MAX_NOME = 80;
const MAX_OBSERVACAO = 300;
export const UNIDADES_DO_PRATO_NOVO = ["KG", "UN"] as const;

/** Mesma chave para "Purê de batata", "pure  de batata." e "PURÊ DE BATATA": barra o prato duplicado. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type PratoNovoValido = { name: string; unit: (typeof UNIDADES_DO_PRATO_NOVO)[number]; observacao: string | null };

export function validarPratoNovo(entrada: Record<string, unknown>): { ok: true; valor: PratoNovoValido } | { ok: false; erro: string } {
  const name = String(entrada.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < MIN_NOME) return { ok: false, erro: `Informe o nome do prato (mínimo ${MIN_NOME} letras).` };
  if (name.length > MAX_NOME) return { ok: false, erro: `Nome muito longo (máximo ${MAX_NOME}).` };
  if (!/[A-Za-zÀ-ú]/.test(name)) return { ok: false, erro: "O nome precisa ter letras." };

  const unidade = normalizarUnidade(entrada.unit || "KG");
  if (!(UNIDADES_DO_PRATO_NOVO as readonly string[]).includes(unidade)) return { ok: false, erro: "A unidade do prato é kg ou porção (UN)." };

  const observacao = String(entrada.notes ?? "").trim().replace(/\s+/g, " ") || null;
  if (observacao && observacao.length > MAX_OBSERVACAO) return { ok: false, erro: `Observação muito longa (máximo ${MAX_OBSERVACAO}).` };

  return { ok: true, valor: { name, unit: unidade as PratoNovoValido["unit"], observacao } };
}

export type ResultadoDaConclusao = {
  /** A ficha tem custo conhecido (todos os ingredientes convertem e têm custo). */
  completa: boolean;
  /** Lançamentos sem valor que passaram a ter. */
  revalorizados: number;
  /** Lançamentos que continuam sem valor porque estão numa unidade que não é a do rendimento da ficha. */
  emOutraUnidade: number;
  /** A ficha saiu de "aguardando". */
  concluiuPendencia: boolean;
};

/**
 * Chamada depois de gravar uma ficha. Ficha completa: (1) lançamentos de desperdício daquele prato que
 * ficaram sem valor passam a valer pelo custo dela; (2) se estava "aguardando ficha", deixa de estar.
 * Só mexe em lançamento SEM valor: o que já foi valorado no dia continua como está. Lançamento em unidade
 * diferente da do rendimento (a ficha mudou de kg para porção) fica sem valor em vez de ganhar um número errado.
 */
export async function concluirFichaDoPrato(client: ClienteDoBanco, dishId: string): Promise<ResultadoDaConclusao> {
  const vazio: ResultadoDaConclusao = { completa: false, revalorizados: 0, emOutraUnidade: 0, concluiuPendencia: false };
  const detalhe = await carregarDetalhe(client, dishId);
  if (!detalhe || detalhe.custoIncompleto || !(detalhe.custoPorcao > 0)) return vazio;

  const unidadeDaFicha = normalizarUnidade(detalhe.yieldUnit);
  const semValor = await client.wasteEntry.findMany({ where: { dishId, totalCost: null, cancelledAt: null }, select: { id: true, quantity: true, unit: true } });
  let revalorizados = 0;
  let emOutraUnidade = 0;
  for (const entrada of semValor) {
    if (normalizarUnidade(entrada.unit) !== unidadeDaFicha) { emOutraUnidade++; continue; }
    const total = calcularValor(Number(entrada.quantity), detalhe.custoPorcao);
    if (total == null) continue;
    await client.wasteEntry.update({ where: { id: entrada.id }, data: { unitCost: detalhe.custoPorcao, totalCost: total, costSource: FONTE_DO_CUSTO_RETROATIVO } });
    revalorizados++;
  }

  const concluida = await client.dish.updateMany({ where: { id: dishId, fichaPendente: true }, data: { fichaPendente: false, fichaConcluidaEm: new Date() } });
  return { completa: true, revalorizados, emOutraUnidade, concluiuPendencia: concluida.count > 0 };
}
