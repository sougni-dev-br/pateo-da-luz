// O que a pessoa digitou e ainda não salvou fica guardado na própria aba (sessionStorage): o
// Android recarrega a aba ao voltar de outro app, e o "voltar" do celular sai da página. Ao
// reabrir, volta tudo e na mesma etapa. A aba fechada leva o rascunho junto; a ficha enviada
// apaga. Fica só no aparelho da pessoa — o servidor só recebe o que ela salva.
import type { FilhoTela } from "./EtapaFamilia";
import type { Valores } from "./etapas";

export type Rascunho = { valores: Valores; filhos: FilhoTela[]; etapa: number; doCep?: Partial<Record<"endereco" | "bairro" | "cidade" | "uf", string>> };

const chave = (codigo: string) => `ficha-rascunho:${codigo.slice(0, 12)}`;

export function lerRascunho(codigo: string): Rascunho | null {
  try {
    const bruto = sessionStorage.getItem(chave(codigo));
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Partial<Rascunho>;
    if (!r || typeof r !== "object" || typeof r.valores !== "object" || !Array.isArray(r.filhos) || typeof r.etapa !== "number") return null;
    return { valores: r.valores ?? {}, filhos: r.filhos, etapa: r.etapa, doCep: typeof r.doCep === "object" && r.doCep ? r.doCep : {} };
  } catch {
    return null;
  }
}

export function guardarRascunho(codigo: string, r: Rascunho) {
  try { sessionStorage.setItem(chave(codigo), JSON.stringify(r)); } catch { /* aba anônima ou cheia: segue sem rascunho */ }
}

export function apagarRascunho(codigo: string) {
  try { sessionStorage.removeItem(chave(codigo)); } catch { /* idem */ }
}

/** Campos do endereço que o CEP preenche. */
export const CAMPOS_DO_CEP = ["endereco", "bairro", "cidade", "uf"] as const;
type Endereco = Record<(typeof CAMPOS_DO_CEP)[number], string>;

/**
 * Endereço do CEP sobre o que está na tela: preenche o vazio e troca o que veio do CEP anterior
 * (CEP digitado errado e depois corrigido). O que a pessoa escreveu à mão não é tocado.
 * Devolve os valores novos e o que agora veio do CEP.
 */
export function aplicarCep(valores: Valores, achado: Endereco, anterior: Partial<Endereco>): { valores: Valores; doCep: Partial<Endereco> } {
  const novos: Valores = { ...valores };
  const doCep: Partial<Endereco> = {};
  for (const campo of CAMPOS_DO_CEP) {
    const atual = String(valores[campo] ?? "");
    const veioDoCep = anterior[campo] !== undefined && atual === anterior[campo];
    if ((atual === "" || veioDoCep) && achado[campo]) {
      novos[campo] = achado[campo];
      doCep[campo] = achado[campo];
    }
  }
  return { valores: novos, doCep };
}

/** Hoje no fuso de São Paulo (AAAA-MM-DD): às 22h o dia em UTC já é amanhã. */
export function hojeSp(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
