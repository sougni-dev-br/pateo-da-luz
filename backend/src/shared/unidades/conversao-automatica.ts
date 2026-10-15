// Conversao automatica: o sistema cadastra sozinho a conversao que o nome do
// produto e o historico de compras ja dizem.
//
// "SACO AMOSTRA C800" contado em UN e comprado em CX: 1 CX = 800 UN.
// "FARINHA TRIGO 5KG" contada em KG e comprada em UN: 1 UN = 5 KG.
// "AGUA 500ML C/12" contada em L e comprada em CX: 1 CX = 12 x 0,5 L = 6 L.
//
// So vira automatica a leitura sem ambiguidade (uma embalagem so no nome, mesma
// grandeza) e que o preco nao desmente: se a compra na embalagem custa 800x a
// compra avulsa, o 800 do nome se confirma; se custa 3x, o nome nao fala da
// embalagem em que a nota veio e a proposta fica para o operador decidir.
// Conversao ja cadastrada nunca e substituida.

import { detectarEmbalagem, embalagemDoNome, normalizarUnidade, resolveUnitFactor, type UnitConversion } from "./conversao.js";

const MEDIDAS = new Set(["KG", "G", "L", "ML"]);
const GRANDEZA: Record<string, "massa" | "volume"> = { KG: "massa", G: "massa", L: "volume", ML: "volume" };
const EM_BASE: Record<string, number> = { KG: 1000, G: 1, L: 1000, ML: 1 };
/** Embalagens que agrupam pacotes: o "CX 30" do nome vale para elas. */
const NIVEL_CAIXA = new Set(["CX", "FD"]);
/** Unidades fixas de contagem que nao dependem do produto. */
const FIXAS: Record<string, number> = { DZ: 12 };

/** Faixa em que o preco "confirma" o fator: entre metade e o dobro do esperado. */
const PRECO_CONFIRMA = { min: 0.5, max: 2 };
/** Fora desta faixa o preco desmente o fator (ex.: leitura de folhas por rolo). */
const PRECO_DESMENTE = { min: 1 / 3, max: 3 };

export type UnidadeDaNota = {
  /** Unidade em que a nota veio (qualquer grafia). */
  unidade: string;
  /** Linhas de compra nessa unidade ainda sem conversao. */
  linhas: number;
  /** Valor dessas linhas (R$), para ordenar pelo impacto. */
  valor: number;
  /** Preco medio por 1 unidade da nota (total / quantidade). */
  precoPorUnidade: number | null;
};

export type ProdutoParaConversao = {
  nome: string;
  unidadeDeContagem: string | null;
  cadastradas: UnitConversion[];
  unidadesDaNota: UnidadeDaNota[];
  /** Preco normal por 1 unidade de contagem, das compras que ja estao nela. */
  precoNaContagem: number | null;
};

export type PropostaDeConversao = {
  fromUnit: string;
  toUnit: string;
  factor: number;
  /** "alta": aplicada sozinha. "baixa": so com o operador. */
  confianca: "alta" | "baixa";
  /** De onde veio o numero, para a tela mostrar ("C800", "5KG", "preco"). */
  origem: string;
  motivo: string;
  /** true: o preco confirma; false: o preco desmente; null: sem preco para comparar. */
  precoConfirma: boolean | null;
  linhas: number;
  valor: number;
};

function arredondar(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function formatar(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

/** Quanto de `para` cabe em `quantidade` de `de`, na mesma grandeza. null se grandezas diferem. */
function medidaEm(quantidade: number, de: string, para: string): number | null {
  if (!GRANDEZA[de] || GRANDEZA[de] !== GRANDEZA[para]) return null;
  return (quantidade * EM_BASE[de]) / EM_BASE[para];
}

function avaliarPreco(fator: number, nota: UnidadeDaNota, precoNaContagem: number | null): boolean | null {
  if (!nota.precoPorUnidade || !precoNaContagem || precoNaContagem <= 0) return null;
  const razao = nota.precoPorUnidade / precoNaContagem / fator;
  if (razao >= PRECO_CONFIRMA.min && razao <= PRECO_CONFIRMA.max) return true;
  if (razao < PRECO_DESMENTE.min || razao > PRECO_DESMENTE.max) return false;
  return null;
}

type Leitura = { fator: number; origem: string; motivo: string; ambigua: boolean };

/** Le o fator "1 <nota> = fator <contagem>" do nome, ou null. */
function lerDoNome(nome: string, nota: string, contagem: string): Leitura | null {
  if (FIXAS[nota] && contagem === "UN") {
    return { fator: FIXAS[nota], origem: nota, motivo: `1 ${nota} = ${FIXAS[nota]} UN.`, ambigua: false };
  }

  const contagens = detectarEmbalagem(nome).filter((e) => e.unidade == null && e.confianca === "alta");
  const peso = embalagemDoNome(nome);

  // Conta em UN (ou outra contagem que nao e medida) e a nota veio em embalagem.
  if (!MEDIDAS.has(contagem) && !MEDIDAS.has(nota)) {
    if (contagem !== "UN") return null;
    const distintas = [...new Map(contagens.map((c) => [c.quantidade, c])).values()];
    if (distintas.length === 0) return null;
    const doNivel = distintas.filter((c) => (c.nivel === "caixa") === NIVEL_CAIXA.has(nota) || c.nivel === "pacote");
    const escolhida = doNivel.length === 1 ? doNivel[0] : distintas.sort((a, b) => b.quantidade - a.quantidade)[0];
    const ambigua = distintas.length > 1 || (escolhida.nivel === "caixa" && !NIVEL_CAIXA.has(nota));
    return {
      fator: escolhida.quantidade,
      origem: escolhida.trecho,
      motivo: `"${escolhida.trecho}" no nome: 1 ${nota} = ${formatar(escolhida.quantidade)} UN.`,
      ambigua
    };
  }

  // Conta em medida (KG, L...) e a nota veio em unidade/embalagem.
  if (MEDIDAS.has(contagem) && !MEDIDAS.has(nota)) {
    if (!peso) return null;
    const porItem = medidaEm(peso.quantidade, peso.unidade, contagem);
    if (porItem == null) return null;
    const distintas = [...new Set(contagens.map((c) => c.quantidade))];
    if (distintas.length === 0) {
      return {
        fator: porItem,
        origem: peso.trecho,
        motivo: `"${peso.trecho}" no nome: 1 ${nota} = ${formatar(porItem)} ${contagem}.`,
        // Caixa sem quantidade no nome pode ter varias unidades de 5 KG.
        ambigua: NIVEL_CAIXA.has(nota)
      };
    }
    const fator = distintas[0] * porItem;
    return {
      fator,
      origem: `${peso.trecho} x ${contagens[0].trecho}`,
      motivo: `"${peso.trecho}" e "${contagens[0].trecho}" no nome: 1 ${nota} = ${distintas[0]} x ${formatar(porItem)} = ${formatar(fator)} ${contagem}.`,
      // Com contagem no nome, so a embalagem de fora (CX/FD) leva o total; "UN" seria a unidade solta.
      ambigua: distintas.length > 1 || !NIVEL_CAIXA.has(nota)
    };
  }

  // Conta em UN e a nota veio em medida: peca de 5 KG comprada a quilo.
  if (contagem === "UN" && MEDIDAS.has(nota)) {
    if (!peso || contagens.length > 0) return null;
    const porItem = medidaEm(peso.quantidade, peso.unidade, nota);
    if (porItem == null || porItem <= 0) return null;
    return {
      fator: 1 / porItem,
      origem: peso.trecho,
      motivo: `"${peso.trecho}" no nome: 1 UN = ${formatar(porItem)} ${nota}.`,
      ambigua: false
    };
  }

  return null;
}

/**
 * Conversoes que faltam para as unidades em que o produto ja foi (ou e) comprado.
 * Nao propoe o que ja converte (cadastrado, mesma unidade ou KG<->G).
 */
export function proporConversoes(produto: ProdutoParaConversao): PropostaDeConversao[] {
  const contagem = normalizarUnidade(produto.unidadeDeContagem);
  if (!contagem) return [];

  const porUnidade = new Map<string, UnidadeDaNota>();
  for (const linha of produto.unidadesDaNota) {
    const unidade = normalizarUnidade(linha.unidade);
    if (!unidade || unidade === contagem) continue;
    const atual = porUnidade.get(unidade);
    if (!atual) {
      porUnidade.set(unidade, { ...linha, unidade });
      continue;
    }
    // Duas grafias da mesma unidade ("CAIXA" e "CX"): soma, preco ponderado pelo valor.
    const linhas = atual.linhas + linha.linhas;
    const valor = atual.valor + linha.valor;
    const qtdAtual = atual.precoPorUnidade ? atual.valor / atual.precoPorUnidade : 0;
    const qtdNova = linha.precoPorUnidade ? linha.valor / linha.precoPorUnidade : 0;
    porUnidade.set(unidade, { unidade, linhas, valor, precoPorUnidade: qtdAtual + qtdNova > 0 ? valor / (qtdAtual + qtdNova) : null });
  }

  const propostas: PropostaDeConversao[] = [];
  for (const nota of porUnidade.values()) {
    if (resolveUnitFactor(nota.unidade, contagem, produto.cadastradas) != null) continue;
    const leitura = lerDoNome(produto.nome, nota.unidade, contagem);
    if (!leitura || !(leitura.fator > 0) || !Number.isFinite(leitura.fator)) continue;

    const fator = arredondar(leitura.fator);
    const precoConfirma = avaliarPreco(fator, nota, produto.precoNaContagem);
    const alta = !leitura.ambigua && precoConfirma !== false;
    propostas.push({
      fromUnit: nota.unidade,
      toUnit: contagem,
      factor: fator,
      confianca: alta ? "alta" : "baixa",
      origem: leitura.origem,
      motivo:
        leitura.motivo +
        (precoConfirma === true ? " O preço das compras confirma." : "") +
        (precoConfirma === false ? " O preço das compras não bate com esse fator: confira." : "") +
        (leitura.ambigua ? " O nome tem mais de uma leitura possível: confira." : ""),
      precoConfirma,
      linhas: nota.linhas,
      valor: nota.valor
    });
  }
  return propostas;
}

/** Proposta que o sistema aplica sem perguntar. */
export function aplicavelSozinha(proposta: PropostaDeConversao): boolean {
  return proposta.confianca === "alta";
}
