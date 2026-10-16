import type { Escolhas } from "./catalogo";

// O rascunho da requisição fica no aparelho. Uma requisição de 35 itens leva minutos para montar e
// se perdia ao recarregar a página, trocar de aba ou o navegador do celular descartar a aba.

export type DadosDoCabecalho = { date: string; shift: string; reason: string; reasonNotes: string; sectorId: string; notes: string };

/** Id e versão do rascunho espelhado no sistema: recarregar a página continua o mesmo rascunho em vez de criar outro. */
export type VinculoComServidor = { id: string; version: number };

export type Rascunho = { cabecalho: DadosDoCabecalho; escolhas: Escolhas; salvoEm: number; servidor?: VinculoComServidor | null };

const chave = (userId: string) => `pateo:requisicao-rascunho:v2:${userId}`;

export function salvarRascunho(userId: string, dados: Omit<Rascunho, "salvoEm">, agora = Date.now()): void {
  try {
    if (Object.keys(dados.escolhas).length === 0) {
      localStorage.removeItem(chave(userId));
      return;
    }
    localStorage.setItem(chave(userId), JSON.stringify({ ...dados, salvoEm: agora } satisfies Rascunho));
  } catch {
    // Armazenamento cheio ou bloqueado (aba anônima): a tela segue funcionando, só não guarda.
  }
}

const ehEscolha = (valor: unknown): boolean => {
  const e = valor as { unit?: unknown; quantity?: unknown } | null;
  return !!e && typeof e.unit === "string" && typeof e.quantity === "string" && e.quantity.trim() !== "";
};

export function lerRascunho(userId: string): Rascunho | null {
  try {
    const bruto = localStorage.getItem(chave(userId));
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as Partial<Rascunho>;
    if (!dados.cabecalho || typeof dados.cabecalho !== "object" || !dados.escolhas || typeof dados.escolhas !== "object") return null;
    const escolhas: Escolhas = {};
    for (const [id, valor] of Object.entries(dados.escolhas)) if (ehEscolha(valor)) escolhas[id] = valor;
    if (Object.keys(escolhas).length === 0) return null;
    const s = dados.servidor;
    const servidor = s && typeof s.id === "string" && Number.isFinite(Number(s.version)) ? { id: s.id, version: Number(s.version) } : null;
    return { cabecalho: dados.cabecalho, escolhas, salvoEm: Number(dados.salvoEm) || 0, servidor };
  } catch {
    return null;
  }
}

export function apagarRascunho(userId: string): void {
  try {
    localStorage.removeItem(chave(userId));
  } catch {
    // sem armazenamento, sem rascunho a apagar
  }
}
