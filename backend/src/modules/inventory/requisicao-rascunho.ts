// Regras (puras) do rascunho de requisição salvo no sistema. O rascunho é só o que a pessoa digitou
// (cabeçalho + produto, unidade e quantidade): o saldo é conferido na hora de concluir, no servidor.

export const LIMITE_DE_ITENS_DO_RASCUNHO = 500;
/** Rascunho sem registro há mais que isso é esquecido e sai da lista. */
export const DIAS_DE_GUARDA_DO_RASCUNHO = 30;

export type CabecalhoDoRascunho = { date: string; shift: string; reason: string; reasonNotes: string; sectorId: string; notes: string };
export type EscolhaDoRascunho = { unit: string; quantity: string };
export type ConteudoDoRascunho = { cabecalho: CabecalhoDoRascunho; escolhas: Record<string, EscolhaDoRascunho> };

export type RascunhoValido = { conteudo: ConteudoDoRascunho; itemCount: number; summary: string | null };
export type ResultadoDaValidacao = { ok: true; valor: RascunhoValido } | { ok: false; erro: string };

const texto = (valor: unknown, limite: number): string => String(valor ?? "").slice(0, limite);

/**
 * Aceita só o que o rascunho guarda, com tamanhos limitados: o corpo vem do navegador e vai para uma coluna JSON
 * que todos os usuários da tela leem de volta.
 */
export function validarRascunho(corpo: unknown): ResultadoDaValidacao {
  const bruto = corpo as { conteudo?: { cabecalho?: Record<string, unknown>; escolhas?: unknown }; summary?: unknown } | null;
  const conteudo = bruto?.conteudo;
  if (!conteudo || typeof conteudo !== "object" || !conteudo.cabecalho || typeof conteudo.cabecalho !== "object") {
    return { ok: false, erro: "Rascunho inválido." };
  }
  const escolhasBrutas = conteudo.escolhas;
  if (!escolhasBrutas || typeof escolhasBrutas !== "object" || Array.isArray(escolhasBrutas)) return { ok: false, erro: "Rascunho inválido." };

  const entradas = Object.entries(escolhasBrutas as Record<string, unknown>);
  if (entradas.length > LIMITE_DE_ITENS_DO_RASCUNHO) return { ok: false, erro: `Rascunho com itens demais (máximo ${LIMITE_DE_ITENS_DO_RASCUNHO}).` };

  const escolhas: Record<string, EscolhaDoRascunho> = {};
  for (const [productId, valor] of entradas) {
    const e = valor as { unit?: unknown; quantity?: unknown } | null;
    if (!productId || productId.length > 64 || !e || typeof e.unit !== "string" || typeof e.quantity !== "string") continue;
    const quantity = texto(e.quantity, 32).trim();
    if (!quantity) continue;
    escolhas[productId] = { unit: texto(e.unit, 16), quantity };
  }

  const c = conteudo.cabecalho;
  const cabecalho: CabecalhoDoRascunho = {
    date: texto(c.date, 10),
    shift: texto(c.shift, 16),
    reason: texto(c.reason, 32),
    reasonNotes: texto(c.reasonNotes, 300),
    sectorId: texto(c.sectorId, 64),
    notes: texto(c.notes, 300)
  };
  const summary = texto(bruto?.summary, 200).trim() || null;
  return { ok: true, valor: { conteudo: { cabecalho, escolhas }, itemCount: Object.keys(escolhas).length, summary } };
}

export type ResultadoDaVersao = { ok: true; proxima: number } | { ok: false; atual: number };

/** Salvar por cima só vale se a pessoa viu a última versão: dois aparelhos editando não se sobrescrevem em silêncio. */
export function conferirVersao(atual: number, recebida: unknown): ResultadoDaVersao {
  return Number(recebida) === atual ? { ok: true, proxima: atual + 1 } : { ok: false, atual };
}
