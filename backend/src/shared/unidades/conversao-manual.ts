// Conversão de unidade cadastrada à mão (estoquista) a partir das pendências: "1 UN = 3,5 KG" no BACON PEÇA.
// As regras ficam aqui, puras, para servidor e testes: o fator nunca é aceito sem passar por elas.

import { normalizarUnidade, resolveUnitFactor, type UnitConversion } from "./conversao.js";

export const FATOR_MAXIMO = 1_000_000;

export type ConversaoManualValida = { fromUnit: string; toUnit: string; factor: number; jaCadastrada: boolean };
export type ResultadoDaConversaoManual = { ok: true; valor: ConversaoManualValida } | { ok: false; erro: string; conflito?: boolean };

const arredondar = (n: number) => Math.round(n * 1e6) / 1e6;

const formatar = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

export function validarConversaoManual(
  entrada: { fromUnit: unknown; factor: unknown },
  unidadeDeContagem: string | null | undefined,
  cadastradas: UnitConversion[]
): ResultadoDaConversaoManual {
  const contagem = normalizarUnidade(unidadeDeContagem);
  if (!contagem) return { ok: false, erro: "O produto ainda não tem unidade de estoque. Cadastre a unidade no produto antes de converter." };

  const fromUnit = normalizarUnidade(entrada.fromUnit);
  if (!fromUnit || fromUnit.length > 10) return { ok: false, erro: "Escolha a unidade que se quer converter." };
  if (fromUnit === contagem) return { ok: false, erro: `Essa já é a unidade do estoque (${contagem}): não há o que converter.` };

  const bruto = typeof entrada.factor === "string" ? Number(entrada.factor.replace(",", ".")) : Number(entrada.factor);
  const factor = arredondar(bruto);
  if (!Number.isFinite(bruto) || !(factor > 0)) return { ok: false, erro: "Informe quanto vale 1 unidade: um número maior que zero." };
  if (factor > FATOR_MAXIMO) return { ok: false, erro: `Fator grande demais (máximo ${formatar(FATOR_MAXIMO)}). Confira a vírgula.` };

  // KG e G, L e ML já convertem sozinhos: cadastrar por cima criaria duas verdades.
  if (resolveUnitFactor(fromUnit, contagem, []) != null) {
    return { ok: false, erro: `${fromUnit} e ${contagem} já convertem sozinhos (é só a medida): não precisa cadastrar.` };
  }

  const existente = resolveUnitFactor(fromUnit, contagem, cadastradas);
  if (existente != null) {
    if (Math.abs(existente - factor) / Math.max(existente, factor) < 1e-6) return { ok: true, valor: { fromUnit, toUnit: contagem, factor, jaCadastrada: true } };
    return {
      ok: false,
      conflito: true,
      erro: `Já existe a conversão 1 ${fromUnit} = ${formatar(existente)} ${contagem} neste produto. Para mudar o valor, edite no cadastro do produto.`
    };
  }
  return { ok: true, valor: { fromUnit, toUnit: contagem, factor, jaCadastrada: false } };
}

const MEDIDAS = new Set(["KG", "G", "L", "ML"]);
const PECA_NO_NOME = /\bPE[CÇ]AS?\b|\bP[CÇ]\b/i;

/**
 * Produto contado em medida (KG, L...) cujo nome diz "peça" e ainda não sabe quanto pesa uma peça:
 * ninguém consegue requisitar "1 peça" enquanto isso não for cadastrado. A peça é a UN do sistema.
 */
export function pecaSemConversao(nome: string, unidadeDeContagem: string | null | undefined, cadastradas: UnitConversion[]): boolean {
  const contagem = normalizarUnidade(unidadeDeContagem);
  if (!contagem || !MEDIDAS.has(contagem) || !PECA_NO_NOME.test(nome)) return false;
  return resolveUnitFactor("UN", contagem, cadastradas) == null;
}
