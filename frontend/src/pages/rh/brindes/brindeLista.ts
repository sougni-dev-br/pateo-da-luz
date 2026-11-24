import type { PessoaBrinde } from "../../../api/client";

export type FiltroBrinde = "TODOS" | "FALTAM" | "RECEBERAM";

export const dataBr = (iso: string | null): string => (iso ? iso.split("-").reverse().join("/") : "—");

/** Aplica filtro e busca (sem acento); quem já saiu só aparece se recebeu. */
export function filtrarPessoas(pessoas: readonly PessoaBrinde[], filtro: FiltroBrinde, busca: string): PessoaBrinde[] {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const termo = norm(busca.trim());
  return pessoas.filter((p) => {
    if (filtro === "FALTAM" && (p.entrega || !p.ativo)) return false;
    if (filtro === "RECEBERAM" && !p.entrega) return false;
    if (!termo) return true;
    return norm(`${p.nome} ${p.nomeCompleto} ${p.setor ?? ""} ${p.cargo ?? ""}`).includes(termo);
  });
}

export type GrupoEmpresa = { empresa: string; pessoas: PessoaBrinde[] };

/** Agrupa mantendo a ordem em que a API devolveu (já vem por empresa e nome). */
export function agruparPorEmpresa(pessoas: readonly PessoaBrinde[]): GrupoEmpresa[] {
  const grupos: GrupoEmpresa[] = [];
  for (const p of pessoas) {
    const empresa = p.empresa ?? "Sem empresa";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.empresa === empresa) ultimo.pessoas.push(p);
    else grupos.push({ empresa, pessoas: [p] });
  }
  return grupos;
}

export type QuemEntraNoPdf = "FALTAM" | "TODOS";

/** Quem vai na folha de assinatura: ativos que ainda não receberam, ou todos os ativos (com a data de quem já recebeu). */
export function pessoasParaPdf(pessoas: readonly PessoaBrinde[], quem: QuemEntraNoPdf): PessoaBrinde[] {
  return pessoas.filter((p) => p.ativo && (quem === "TODOS" || !p.entrega));
}

/** Nome de arquivo sem acento nem símbolo: "Brinde de Natal" 2026 → brinde-de-natal-2026-assinaturas.pdf */
export function nomeArquivoBrinde(nome: string, ano: number): string {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "brinde"}-${ano}-assinaturas.pdf`;
}
