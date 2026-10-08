import type { ClasseConferencia, ItemDaConferencia } from "../../api/client";

// Apoio a quem revisa a conferencia. Fica fora do componente para dar teste.

export const SEM_SETOR = "Sem setor";

const CLASSES: ClasseConferencia[] = ["IMPOSSIVEL", "ZERADO_SUSPEITO", "FORA_DO_HISTORICO", "SEM_REFERENCIA", "PENDENTE", "COERENTE"];

// Palavra de categoria nao identifica produto: "VINHO TINTO" aparece em dezenas.
const GENERICAS = new Set([
  "VINHO", "TINTO", "BRANCO", "ROSE", "SECO", "SUAVE", "DEMI", "MEIO", "ESPUMANTE", "CERVEJA", "SUCO",
  "REFRIGERANTE", "AGUA", "LATA", "GARRAFA", "PACOTE", "CAIXA", "COM", "SEM", "PARA", "TIPO", "LITRO", "LITROS"
]);

function palavras(nome: string): string[] {
  return nome
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

// "1KG", "500G", "600ML": tamanho nao identifica produto. Sem isso, FARINHA DE
// TRIGO 1KG e FARINHA DE MILHO 1KG viravam "parecidos".
const MEDIDA = /^\d+([.,]\d+)?(KG|KGS|G|GR|L|LT|ML|UN|UND|CX|PCT|PCTE|M|CM|MM)?$/;

function identificadoras(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.length >= 3 && /[A-Z]/.test(t) && !MEDIDA.test(t) && !GENERICAS.has(t)));
}

const MAXIMO_DE_PARECIDOS = 3;

/**
 * Zerado com o vizinho contado: setembro/2026 teve 34 de 84 zerados assim
 * (COCA COLA 2 L ZERO zerada com a COCA COLA 2 L contada). Parecido = pelo
 * menos duas palavras que identificam o produto em comum; ordena por quantas
 * palavras, de qualquer tipo, os nomes dividem.
 */
export function produtosParecidos(alvo: ItemDaConferencia, todos: readonly ItemDaConferencia[]): ItemDaConferencia[] {
  const tokensAlvo = palavras(alvo.productName);
  const chave = identificadoras(tokensAlvo);
  if (chave.size < 2) return [];
  return todos
    .filter((outro) => outro.itemId !== alvo.itemId && Number(outro.contado) > 0)
    .map((outro) => {
      const tokensOutro = palavras(outro.productName);
      const emComumIdentificadoras = [...identificadoras(tokensOutro)].filter((t) => chave.has(t)).length;
      const todasDoOutro = new Set(tokensOutro);
      const emComum = new Set(tokensAlvo.filter((t) => todasDoOutro.has(t))).size;
      return { outro, emComumIdentificadoras, emComum };
    })
    .filter((x) => x.emComumIdentificadoras >= 2)
    .sort((a, b) => b.emComum - a.emComum || a.outro.productName.localeCompare(b.outro.productName, "pt-BR"))
    .slice(0, MAXIMO_DE_PARECIDOS)
    .map((x) => x.outro);
}

const CLASSES_DE_ALERTA = new Set<ClasseConferencia>(["IMPOSSIVEL", "ZERADO_SUSPEITO", "FORA_DO_HISTORICO"]);

/** Mesma regra do servidor (revisao-conferencia.ts): alerta a partir do limite, ou sem custo. */
export function exigeConferencia(item: Pick<ItemDaConferencia, "classe" | "impacto">, limite: number): boolean {
  if (!CLASSES_DE_ALERTA.has(item.classe)) return false;
  return item.impacto == null || item.impacto >= limite;
}

/** Conferido de verdade: tem motivo e nao esta so esperando recontagem. */
export function estaConferido(item: Pick<ItemDaConferencia, "conferido">): boolean {
  return item.conferido != null && item.conferido.motivo !== "RECONTAR";
}

export function progressoDaConferencia(itens: readonly ItemDaConferencia[], limite: number) {
  const exigidos = itens.filter((item) => exigeConferencia(item, limite));
  return { exigidos: exigidos.length, conferidos: exigidos.filter(estaConferido).length };
}

export type Situacao = "todos" | "faltam" | "conferidos" | "sem_custo";

/** Contado e sem custo nenhum no sistema: entraria a R$ 0 no CMV. */
export function semCusto(item: Pick<ItemDaConferencia, "contado" | "custoUnitario">): boolean {
  return (item.contado ?? 0) > 0 && item.custoUnitario == null;
}

export type FiltroDaConferencia = { setor: string; valorMinimo: number; situacao?: Situacao; limite?: number };

/** Item sem custo fica no corte por valor: nao da para saber se pesa. */
export function filtrarConferencia(itens: readonly ItemDaConferencia[], filtro: FiltroDaConferencia): ItemDaConferencia[] {
  const situacao = filtro.situacao ?? "todos";
  return itens.filter((item) =>
    (!filtro.setor || (item.sectorName ?? SEM_SETOR) === filtro.setor)
    && (filtro.valorMinimo <= 0 || item.impacto == null || item.impacto >= filtro.valorMinimo)
    && (situacao === "todos"
      || (situacao === "sem_custo" ? semCusto(item)
        : situacao === "conferidos" ? estaConferido(item) : exigeConferencia(item, filtro.limite ?? 0) && !estaConferido(item)))
  );
}

export function resumirItens(itens: readonly Pick<ItemDaConferencia, "classe" | "impacto">[]): Record<ClasseConferencia, { itens: number; impacto: number }> {
  const resumo = Object.fromEntries(CLASSES.map((c) => [c, { itens: 0, impacto: 0 }])) as Record<ClasseConferencia, { itens: number; impacto: number }>;
  for (const item of itens) {
    const atual = resumo[item.classe];
    resumo[item.classe] = { itens: atual.itens + 1, impacto: Math.round((atual.impacto + (item.impacto ?? 0)) * 100) / 100 };
  }
  return resumo;
}
