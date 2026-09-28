// Rascunho da tabela de funções: cada alteração fica guardada neste navegador até
// ser salva ou descartada. Trocar de aba, recarregar ou fechar sem querer não perde nada.
import type { TipFunction } from "../../api/client";

const CHAVE = "gorjeta-funcoes-rascunho-v1";

export type Rascunho = {
  /** Versão da tabela no servidor quando a edição começou. */
  versao: string;
  salvoEm: string;
  funcoes: TipFunction[];
  vigencia: string;
  motivo: string;
};

export function lerRascunho(): Rascunho | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho;
    return Array.isArray(r?.funcoes) && typeof r.versao === "string" ? r : null;
  } catch {
    return null;
  }
}

export function gravarRascunho(r: Rascunho): boolean {
  try { window.localStorage.setItem(CHAVE, JSON.stringify(r)); return true; } catch { return false; }
}

export function apagarRascunho() {
  try { window.localStorage.removeItem(CHAVE); } catch { /* nada a apagar */ }
}

export type CampoFuncao = "name" | "points" | "minPoints" | "maxPoints" | "group" | "notes" | "isActive";
export const ROTULO_CAMPO: Record<CampoFuncao, string> = {
  name: "Nome", points: "Pontos", minPoints: "Mínimo", maxPoints: "Máximo", group: "Grupo", notes: "Observação", isActive: "Ativa",
};
const CAMPOS = Object.keys(ROTULO_CAMPO) as CampoFuncao[];

export type Diferenca = {
  chave: string;
  id: string | null;
  nome: string;
  nova: boolean;
  campos: Array<{ campo: CampoFuncao; antes: unknown; depois: unknown }>;
};

const normal = (v: unknown) => (v === "" || v === undefined ? null : typeof v === "string" ? v.trim() || null : v);

export function chaveDe(f: TipFunction, i: number) {
  return f.id ?? `nova-${i}`;
}

// O que mudou em relação ao que está gravado. Funções novas entram inteiras.
export function diferencas(original: TipFunction[], atual: TipFunction[]): Diferenca[] {
  const porId = new Map(original.filter((f) => f.id).map((f) => [f.id!, f]));
  const saida: Diferenca[] = [];
  atual.forEach((f, i) => {
    const velha = f.id ? porId.get(f.id) : undefined;
    if (!velha) {
      saida.push({ chave: chaveDe(f, i), id: null, nome: f.name || "(sem nome)", nova: true,
        campos: CAMPOS.filter((c) => normal(f[c]) != null).map((c) => ({ campo: c, antes: null, depois: normal(f[c]) })) });
      return;
    }
    const campos = CAMPOS.filter((c) => normal(velha[c]) !== normal(f[c])).map((c) => ({ campo: c, antes: normal(velha[c]), depois: normal(f[c]) }));
    if (campos.length) saida.push({ chave: chaveDe(f, i), id: f.id!, nome: f.name || velha.name, nova: false, campos });
  });
  return saida;
}

// Problemas que impedem salvar, na língua de quem usa.
export function problemas(atual: TipFunction[]): string[] {
  const erros: string[] = [];
  const nomes = new Map<string, number>();
  atual.forEach((f) => {
    const nome = f.name.trim();
    const rotulo = nome || "Função sem nome";
    if (!nome) erros.push("Há uma função sem nome.");
    if (!Number.isFinite(f.points) || f.points < 0) erros.push(`${rotulo}: pontos precisam ser 0 ou mais.`);
    if (f.minPoints != null && f.maxPoints != null && f.minPoints > f.maxPoints) erros.push(`${rotulo}: o mínimo está maior que o máximo.`);
    else if ((f.minPoints != null && f.points < f.minPoints) || (f.maxPoints != null && f.points > f.maxPoints)) {
      erros.push(`${rotulo}: os pontos (${f.points}) estão fora da faixa ${f.minPoints ?? "—"} a ${f.maxPoints ?? "—"}.`);
    }
    if (nome) nomes.set(nome.toLocaleLowerCase("pt-BR"), (nomes.get(nome.toLocaleLowerCase("pt-BR")) ?? 0) + 1);
  });
  for (const [nome, n] of nomes) if (n > 1) erros.push(`A função "${nome}" aparece ${n} vezes.`);
  return [...new Set(erros)];
}
