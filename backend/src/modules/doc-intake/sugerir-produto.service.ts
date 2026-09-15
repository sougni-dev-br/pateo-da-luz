// Sugestao de produto para cada linha lida do documento.
//
// Existe para viabilizar nota de insumo: a compra tipica tem 6 itens e a maior
// da base tem 69. Casar 69 linhas a mao e pior do que digitar a nota inteira.
//
// Duas regras que valem mais que a precisao do algoritmo:
//   1. NUNCA cria produto. A importacao de Excel cria, e por isso o cadastro
//      tem 800 itens com duplicatas. Aqui, se nao ha candidato, quem decide e a
//      pessoa.
//   2. Sugestao sempre vem com o MOTIVO e o nivel de confianca. Uma sugestao
//      que a pessoa nao consegue avaliar e pior do que sugestao nenhuma.

import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { palavrasChave, semelhanca } from "./similaridade.js";

/** Abaixo disto a sugestao nao e oferecida: o ruido supera a ajuda. */
const SEMELHANCA_MINIMA = 0.55;
/** A partir daqui o nome e parecido o bastante para vir pre-selecionado. */
const SEMELHANCA_ALTA = 0.82;
const MAX_ALTERNATIVAS = 4;
const MAX_HISTORICO = 3000;

export type NivelConfianca = "ALTA" | "MEDIA" | "BAIXA";

export type ProdutoSugerido = {
  id: string;
  nome: string;
  unidade: string | null;
  codigoExterno: string | null;
  categoria: string | null;
  subcategoria: string | null;
};

export type SugestaoLinha = {
  descricaoLida: string;
  sugestao: ProdutoSugerido | null;
  confianca: NivelConfianca | null;
  /** Por que este produto foi sugerido — a pessoa precisa poder discordar com base. */
  motivo: string | null;
  alternativas: ProdutoSugerido[];
};

type ProdutoBruto = {
  id: string;
  name: string;
  normalizedName: string;
  unit: string | null;
  externalCode: string | null;
  category: { name: string } | null;
  subcategory: { name: string } | null;
};

function paraSugerido(produto: ProdutoBruto): ProdutoSugerido {
  return {
    id: produto.id,
    nome: produto.name,
    unidade: produto.unit,
    codigoExterno: produto.externalCode,
    categoria: produto.category?.name ?? null,
    subcategoria: produto.subcategory?.name ?? null,
  };
}

const SELECAO = {
  id: true, name: true, normalizedName: true, unit: true, externalCode: true,
  category: { select: { name: true } },
  subcategory: { select: { name: true } },
} as const;

/**
 * O que este fornecedor ja vendeu antes, e para qual produto foi lancado.
 * E o sinal mais forte que existe: se "COXA E SOBRECOXA CONG KG" da Friboi ja
 * virou o produto X cinco vezes, vai virar de novo.
 */
async function historicoDoFornecedor(supplierId: string): Promise<Map<string, string>> {
  const itens = await prisma.purchaseItem.findMany({
    where: { purchase: { supplierId, status: "ACTIVE" } },
    select: { rawProductName: true, productId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORICO,
  });

  // O mais recente vence: se o item foi remapeado para outro produto, o lancamento
  // novo e que reflete a decisao atual.
  const mapa = new Map<string, string>();
  for (const item of itens) {
    const chave = normalizeText(item.rawProductName);
    if (chave && !mapa.has(chave)) mapa.set(chave, item.productId);
  }
  return mapa;
}

export async function sugerirProdutos(params: {
  supplierId: string | null;
  descricoes: string[];
}): Promise<SugestaoLinha[]> {
  const descricoes = params.descricoes.filter((descricao) => descricao.trim().length > 0);
  if (descricoes.length === 0) return [];

  const historico = params.supplierId ? await historicoDoFornecedor(params.supplierId) : new Map<string, string>();

  // Um unico conjunto de candidatos para todas as linhas: uma consulta em vez
  // de uma por item (a nota de 69 itens faria 69 idas ao banco).
  const termos = [...new Set(descricoes.flatMap((descricao) => palavrasChave(descricao)))];
  const candidatos = termos.length > 0
    ? await prisma.product.findMany({
        where: { isActive: true, OR: termos.map((termo) => ({ normalizedName: { contains: termo } })) },
        select: SELECAO,
        take: 400,
      })
    : [];

  const idsDoHistorico = [...new Set(historico.values())];
  const produtosDoHistorico = idsDoHistorico.length > 0
    ? await prisma.product.findMany({ where: { id: { in: idsDoHistorico } }, select: SELECAO })
    : [];
  const porId = new Map(produtosDoHistorico.map((produto) => [produto.id, produto]));

  const aliases = await prisma.productAlias.findMany({
    where: { normalizedAlias: { in: descricoes.map(normalizeText) } },
    select: { normalizedAlias: true, productId: true },
  });
  const porAlias = new Map(aliases.map((alias) => [alias.normalizedAlias, alias.productId]));
  const idsDeAlias = [...new Set(aliases.map((alias) => alias.productId))].filter((id) => !porId.has(id));
  if (idsDeAlias.length > 0) {
    const produtos = await prisma.product.findMany({ where: { id: { in: idsDeAlias } }, select: SELECAO });
    for (const produto of produtos) porId.set(produto.id, produto);
  }

  return descricoes.map((descricaoLida) => {
    const normalizada = normalizeText(descricaoLida);

    // 1. Já lançado antes com este mesmo fornecedor.
    const doHistorico = historico.get(normalizada);
    if (doHistorico && porId.has(doHistorico)) {
      return {
        descricaoLida,
        sugestao: paraSugerido(porId.get(doHistorico)!),
        confianca: "ALTA" as const,
        motivo: "já lançado antes com este fornecedor, com a mesma descrição",
        alternativas: [],
      };
    }

    // 2. Apelido registrado — o cadastro já aprendeu este nome.
    const doAlias = porAlias.get(normalizada);
    if (doAlias && porId.has(doAlias)) {
      return {
        descricaoLida,
        sugestao: paraSugerido(porId.get(doAlias)!),
        confianca: "ALTA" as const,
        motivo: "nome já cadastrado como apelido deste produto",
        alternativas: [],
      };
    }

    // 3. Nome idêntico ao do cadastro.
    const identico = candidatos.find((produto) => produto.normalizedName === normalizada);
    if (identico) {
      return {
        descricaoLida,
        sugestao: paraSugerido(identico),
        confianca: "ALTA" as const,
        motivo: "nome idêntico ao do cadastro",
        alternativas: [],
      };
    }

    // 4. Semelhança de texto — daqui para baixo é palpite, e é dito como tal.
    const pontuados = candidatos
      .map((produto) => ({ produto, pontos: semelhanca(descricaoLida, produto.name) }))
      .filter((item) => item.pontos >= SEMELHANCA_MINIMA)
      .sort((a, b) => b.pontos - a.pontos);

    if (pontuados.length === 0) {
      return { descricaoLida, sugestao: null, confianca: null, motivo: null, alternativas: [] };
    }

    const melhor = pontuados[0];
    const porcentagem = Math.round(melhor.pontos * 100);
    return {
      descricaoLida,
      sugestao: paraSugerido(melhor.produto),
      confianca: melhor.pontos >= SEMELHANCA_ALTA ? ("MEDIA" as const) : ("BAIXA" as const),
      motivo: `nome parecido (${porcentagem}%)`,
      alternativas: pontuados.slice(1, 1 + MAX_ALTERNATIVAS).map((item) => paraSugerido(item.produto)),
    };
  });
}
