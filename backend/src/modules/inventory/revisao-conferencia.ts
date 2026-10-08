// Conferido por item: quem revisa marca cada alerta como visto, com motivo.
//
// Sem isso a tela nao sabia o que ja tinha sido olhado: um zerado que estava
// certo (o produto acabou mesmo) seguia como alerta para sempre, e a aprovacao
// mostrava "120 em alerta" mesmo com tudo conferido. Agora a aprovacao so passa
// quando os alertas que pesam foram vistos — e "recontar" nao conta como visto.

import type { ClasseConferencia } from "./conferencia.js";

/** A partir deste valor (R$) o alerta precisa ser conferido para aprovar. */
export const LIMITE_DE_CONFERENCIA = 50;

const CLASSES_DE_ALERTA = new Set<ClasseConferencia>(["IMPOSSIVEL", "ZERADO_SUSPEITO", "FORA_DO_HISTORICO"]);

export const MOTIVOS_DE_REVISAO = ["CORRETO", "COMPRA_NAO_LANCADA", "ERRO_DE_UNIDADE", "CORRIGIDO", "OUTRO", "RECONTAR"] as const;
export type MotivoDeRevisao = (typeof MOTIVOS_DE_REVISAO)[number];

const TAMANHO_MAXIMO_DA_OBSERVACAO = 500;

/** Alerta sem custo exige conferencia: nao da para saber se pesa. */
export function exigeConferencia(item: { classe: ClasseConferencia; impacto: number | null }): boolean {
  if (!CLASSES_DE_ALERTA.has(item.classe)) return false;
  return item.impacto == null || item.impacto >= LIMITE_DE_CONFERENCIA;
}

export function pendenciasParaAprovar<T extends { classe: ClasseConferencia; impacto: number | null; motivo: string | null }>(itens: readonly T[]): T[] {
  return itens.filter((item) => exigeConferencia(item) && (item.motivo == null || item.motivo === "RECONTAR"));
}

export type ResultadoDaValidacao =
  | { ok: true; motivo: MotivoDeRevisao | null; observacao: string | null }
  | { ok: false; erro: string };

export function validarRevisao(motivo: unknown, observacao: unknown): ResultadoDaValidacao {
  const texto = typeof observacao === "string" ? observacao.trim().slice(0, TAMANHO_MAXIMO_DA_OBSERVACAO) : "";
  if (motivo == null || motivo === "") return { ok: true, motivo: null, observacao: null };
  if (typeof motivo !== "string" || !(MOTIVOS_DE_REVISAO as readonly string[]).includes(motivo)) {
    return { ok: false, erro: "Motivo de conferência inválido." };
  }
  if (motivo === "OUTRO" && !texto) return { ok: false, erro: "Descreva o motivo em \"Outro\"." };
  return { ok: true, motivo: motivo as MotivoDeRevisao, observacao: texto || null };
}
