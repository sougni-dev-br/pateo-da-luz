import type { DishUnitConversion } from "../../api/client";
import { fatorConversao, lerNumero, normalizarUnidade, unidadesPossiveis } from "../../lib/fichaTecnica";

// Quantidade do desperdício em g, ml, kg... e a conversão para a unidade do estoque. As regras de
// conversão são as da ficha técnica (lib/fichaTecnica): o mesmo produto converte igual nas duas telas.
// O servidor refaz a conta e é quem manda; aqui ela só aparece enquanto a pessoa digita.

const formato = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });

/** Até 6 casas: 1 g de uma embalagem de 25 kg é 0,00004 UN e não pode aparecer como "0". */
export const formatarQuantidade = (valor: number) => formato.format(valor);

/** Massa e volume: as medidas em que dá para informar quanto vale 1 unidade do estoque. */
export const MEDIDAS = ["G", "KG", "ML", "L"] as const;
const MEDIDAS_DE_MASSA = ["G", "KG"];
const MEDIDAS_DE_VOLUME = ["ML", "L"];

const ehMedida = (unidade: string) => (MEDIDAS as readonly string[]).includes(unidade);

/** g e kg andam juntos, ml e l também: o peso de 1 unidade se informa na mesma grandeza de quem se lança. */
export function medidasDaMesmaGrandeza(unidade: string): string[] {
  const u = normalizarUnidade(unidade);
  return MEDIDAS_DE_VOLUME.includes(u) ? MEDIDAS_DE_VOLUME : MEDIDAS_DE_MASSA;
}

/**
 * Unidades em que dá para lançar o item: a do estoque primeiro, depois as que convertem para ela.
 */
export function unidadesDoLancamento(unidadeDoEstoque: string | null, conversoes: DishUnitConversion[]): string[] {
  const base = normalizarUnidade(unidadeDoEstoque);
  if (!base) return [];
  const possiveis = unidadesPossiveis(base, conversoes);
  return [base, ...possiveis.filter((u) => u !== base)];
}

export type OpcaoDoLancamento = { value: string; label: string; /** Ainda não converte: escolher pede quanto vale 1 unidade do estoque. */ informar: boolean };

/**
 * Tudo que dá para escolher, como na ficha técnica: as que já convertem e, para itens contados em
 * unidade, pacote, caixa..., g/kg/ml/l marcadas "(informar)". Antes só apareciam as que já convertiam,
 * e quem queria lançar 300 g de um item sem peso cadastrado não tinha por onde.
 */
export function opcoesDoLancamento(unidadeDoEstoque: string | null, conversoes: DishUnitConversion[]): OpcaoDoLancamento[] {
  const base = normalizarUnidade(unidadeDoEstoque);
  if (!base) return [];
  const aceitas = unidadesDoLancamento(base, conversoes);
  const jaConvertem = aceitas.map((value) => ({ value, label: value, informar: false }));
  // Estoque já em g/kg/ml/l: o resto é física ou outra grandeza, que não se informa assim.
  if (ehMedida(base)) return jaConvertem;
  const faltam = MEDIDAS.filter((m) => !aceitas.includes(m));
  return [...jaConvertem, ...faltam.map((value) => ({ value, label: `${value} (informar)`, informar: true }))];
}

/** A unidade escolhida ainda não converte e pede o peso/volume de 1 unidade do estoque. */
export function precisaInformar(unidade: string, unidadeDoEstoque: string | null, conversoes: DishUnitConversion[]): boolean {
  return opcoesDoLancamento(unidadeDoEstoque, conversoes).some((o) => o.informar && o.value === normalizarUnidade(unidade));
}

export type PesoPorUnidade = { quantidade: string; unidade: string };

export type PreviaDaConversao = { tipo: "CONVERTE"; texto: string } | null;

/** Quanto vale 1 unidade do estoque, na unidade em que se lança. null quando o que foi informado não serve. */
function fatorDoPesoInformado(unidadeLancada: string, peso: PesoPorUnidade): number | null {
  const quantidade = lerNumero(peso.quantidade);
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  const emLancada = fatorConversao(peso.unidade, unidadeLancada, []);
  if (emLancada == null) return null;
  return 1 / (quantidade * emLancada);
}

/**
 * O que mostrar sob o campo: o resultado da conversão quando a unidade digitada não é a do estoque.
 * Com o peso de 1 unidade informado na hora, a conta usa ele quando o cadastro ainda não sabe.
 */
export function previaDaConversao(entrada: {
  quantidade: string;
  unidade: string;
  unidadeDoEstoque: string | null;
  conversoes: DishUnitConversion[];
  pesoPorUnidade?: PesoPorUnidade | null;
}): PreviaDaConversao {
  const base = normalizarUnidade(entrada.unidadeDoEstoque);
  const unidade = normalizarUnidade(entrada.unidade);
  if (!base || !unidade || unidade === base) return null;

  const numero = lerNumero(entrada.quantidade);
  if (!Number.isFinite(numero) || numero <= 0) return null;

  const cadastrado = fatorConversao(unidade, base, entrada.conversoes);
  const fator = cadastrado ?? (entrada.pesoPorUnidade ? fatorDoPesoInformado(unidade, entrada.pesoPorUnidade) : null);
  if (fator == null) return null;
  return { tipo: "CONVERTE", texto: `${formatarQuantidade(numero)} ${unidade} = ${formatarQuantidade(numero * fator)} ${base}` };
}
