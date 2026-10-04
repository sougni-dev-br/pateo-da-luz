// O que a pessoa digitou e ainda não salvou fica guardado na própria aba (sessionStorage): o
// Android recarrega a aba ao voltar de outro app, e o "voltar" do celular sai da página. Ao
// reabrir, volta tudo e na mesma etapa. A aba fechada leva o rascunho junto; a ficha enviada
// apaga. Fica só no aparelho da pessoa — o servidor só recebe o que ela salva.
import type { FilhoTela } from "./EtapaFamilia";
import type { Valores } from "./etapas";

export type Rascunho = {
  valores: Valores; filhos: FilhoTela[]; etapa: number; doCep?: Partial<Record<"endereco" | "bairro" | "cidade" | "uf", string>>;
  /** Impressão dos dados do servidor sobre os quais o rascunho foi feito (ver `impressaoDe`). */
  base: string;
};

/**
 * Impressão curta dos dados salvos no servidor. O rascunho só volta se ela bater: se a ficha foi
 * salva em outro aparelho ou corrigida pelo RH depois, o rascunho velho não passa por cima.
 */
export function impressaoDe(dados: unknown): string {
  const ordenar = (v: unknown): unknown => Array.isArray(v) ? v.map(ordenar)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordenar(x)]))
    : v;
  const texto = JSON.stringify(ordenar(dados ?? {}));
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return `${texto.length}-${h.toString(16)}`;
}

const filhoValido = (f: unknown) => !!f && typeof f === "object"
  && ["nome", "nascimento", "cpf"].every((k) => typeof (f as Record<string, unknown>)[k] === "string");

const chave = (codigo: string) => `ficha-rascunho:${codigo.slice(0, 12)}`;

export function lerRascunho(codigo: string): Rascunho | null {
  try {
    const bruto = sessionStorage.getItem(chave(codigo));
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Partial<Rascunho>;
    if (!r || typeof r !== "object" || !r.valores || typeof r.valores !== "object" || !Array.isArray(r.filhos) || typeof r.etapa !== "number"
      || typeof r.base !== "string" || !r.filhos.every(filhoValido)) return null;
    return { valores: r.valores, filhos: r.filhos, etapa: r.etapa, doCep: typeof r.doCep === "object" && r.doCep ? r.doCep : {}, base: r.base };
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
 * (CEP digitado errado e depois corrigido) — inclusive limpando, se o CEP novo não traz aquele
 * campo (CEP geral de cidade pequena não tem rua). O que a pessoa escreveu à mão não é tocado.
 * Devolve os valores novos e o mapa completo do que agora está na tela vindo do CEP.
 */
export function aplicarCep(valores: Valores, achado: Endereco, anterior: Partial<Endereco>): { valores: Valores; doCep: Partial<Endereco> } {
  const novos: Valores = { ...valores };
  const doCep: Partial<Endereco> = { ...anterior };
  for (const campo of CAMPOS_DO_CEP) {
    const atual = String(valores[campo] ?? "");
    const veioDoCep = anterior[campo] !== undefined && atual === anterior[campo];
    if (atual !== "" && !veioDoCep) { delete doCep[campo]; continue; }
    // Apagado à mão e o CEP novo não traz: nada aqui veio do CEP.
    if (atual === "" && !achado[campo]) { delete doCep[campo]; continue; }
    if (achado[campo]) {
      novos[campo] = achado[campo];
      doCep[campo] = achado[campo];
    } else if (veioDoCep) {
      novos[campo] = "";
      delete doCep[campo];
    }
  }
  return { valores: novos, doCep };
}

/** Hoje no fuso de São Paulo (AAAA-MM-DD): às 22h o dia em UTC já é amanhã. */
export function hojeSp(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
