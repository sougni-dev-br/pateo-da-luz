import type { LinhaDaRequisicao } from "./linhas";

// O rascunho da requisição fica no aparelho. Uma requisição de 35 itens leva minutos para montar e
// se perdia ao recarregar a página, trocar de aba ou o navegador do celular descartar a aba.

export type DadosDoCabecalho = { date: string; shift: string; reason: string; reasonNotes: string; sectorId: string; notes: string };

export type Rascunho = { cabecalho: DadosDoCabecalho; linhas: LinhaDaRequisicao[]; deFora: LinhaDaRequisicao[]; salvoEm: number };

const chave = (userId: string) => `pateo:requisicao-rascunho:v1:${userId}`;

export function salvarRascunho(userId: string, dados: Omit<Rascunho, "salvoEm">, agora = Date.now()): void {
  try {
    if (dados.linhas.length === 0 && dados.deFora.length === 0) {
      localStorage.removeItem(chave(userId));
      return;
    }
    localStorage.setItem(chave(userId), JSON.stringify({ ...dados, salvoEm: agora } satisfies Rascunho));
  } catch {
    // Armazenamento cheio ou bloqueado (aba anônima): a tela segue funcionando, só não guarda.
  }
}

const ehLinha = (valor: unknown): valor is LinhaDaRequisicao => {
  const l = valor as Partial<LinhaDaRequisicao> | null;
  return !!l && typeof l.productId === "string" && typeof l.productName === "string" && typeof l.unit === "string" && typeof l.quantity === "string" && Array.isArray(l.conversions);
};

export function lerRascunho(userId: string): Rascunho | null {
  try {
    const bruto = localStorage.getItem(chave(userId));
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as Partial<Rascunho>;
    const linhas = (Array.isArray(dados.linhas) ? dados.linhas : []).filter(ehLinha);
    const deFora = (Array.isArray(dados.deFora) ? dados.deFora : []).filter(ehLinha);
    if (linhas.length === 0 && deFora.length === 0) return null;
    if (!dados.cabecalho || typeof dados.cabecalho !== "object") return null;
    return { cabecalho: dados.cabecalho, linhas, deFora, salvoEm: Number(dados.salvoEm) || 0 };
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
