// Edição de requisição já registrada. A baixa de estoque já aconteceu, então editar não refaz
// a requisição: lança só a diferença de cada produto (mais retirado = nova saída; menos = volta
// ao estoque), sempre com movimentos novos ligados à requisição. Os movimentos antigos ficam
// como estão: o histórico do produto mostra a retirada e o acerto, nunca uma linha que sumiu.

export type QuantidadePorProduto = { productId: string; quantidade: number };

export type DiferencaDoProduto = {
  productId: string;
  /** Na unidade do estoque: o que esta requisição tirava antes da edição. */
  antes: number;
  /** O que passa a tirar. */
  depois: number;
  /** depois - antes: positivo sai mais do estoque, negativo volta. */
  delta: number;
};

const arredondar = (valor: number) => Math.round(valor * 10_000) / 10_000;

function somarPorProduto(itens: QuantidadePorProduto[]) {
  const total = new Map<string, number>();
  for (const item of itens) total.set(item.productId, arredondar((total.get(item.productId) ?? 0) + item.quantidade));
  return total;
}

/** Diferença por produto entre o que a requisição tirava e o que passa a tirar; produto sem mudança fica de fora. */
export function diferencaDaEdicao(antigos: QuantidadePorProduto[], novos: QuantidadePorProduto[]): DiferencaDoProduto[] {
  const antes = somarPorProduto(antigos);
  const depois = somarPorProduto(novos);
  const produtos = new Set([...antes.keys(), ...depois.keys()]);
  const diferencas: DiferencaDoProduto[] = [];
  for (const productId of produtos) {
    const a = antes.get(productId) ?? 0;
    const d = depois.get(productId) ?? 0;
    const delta = arredondar(d - a);
    if (delta !== 0) diferencas.push({ productId, antes: a, depois: d, delta });
  }
  return diferencas;
}

/** Quanto a requisição já tirou de cada produto: na edição isso volta a contar como saldo disponível. */
export function retiradoPorProduto(antigos: QuantidadePorProduto[]) {
  return somarPorProduto(antigos);
}

export type ConferenciaDaEdicao = { ok: true } | { ok: false; status: number; message: string };

/**
 * Só requisição confirmada se edita, e só a partir da versão que a pessoa abriu: dois aparelhos
 * editando a mesma requisição não podem lançar o acerto duas vezes.
 */
export function conferirEdicao(
  requisicao: { status: string; updatedAt: Date } | null | undefined,
  versaoAberta: string | null
): ConferenciaDaEdicao {
  if (!requisicao) return { ok: false, status: 404, message: "Requisicao nao encontrada." };
  if (requisicao.status !== "CONFIRMED") return { ok: false, status: 409, message: "Esta requisicao foi cancelada e nao pode ser editada." };
  if (!versaoAberta) return { ok: false, status: 400, message: "Informe a versao da requisicao que foi aberta para editar." };
  const aberta = new Date(versaoAberta);
  if (Number.isNaN(aberta.getTime()) || aberta.getTime() !== requisicao.updatedAt.getTime()) {
    return { ok: false, status: 409, message: "Esta requisicao foi alterada depois que voce a abriu. Abra de novo para ver a versao atual." };
  }
  return { ok: true };
}

/** Texto do movimento de acerto: quem olha o histórico do produto entende de onde veio. */
export function notaDoAcerto(codigo: string, diferenca: DiferencaDoProduto, unidade: string | null) {
  const un = unidade ? ` ${unidade}` : "";
  return `Edicao da requisicao ${codigo}: retirada de ${diferenca.antes}${un} para ${diferenca.depois}${un}`;
}

/** Linha gravada da requisição, com a unidade de estoque que o produto tem hoje. */
export type LinhaGravada = {
  productId: string | null;
  productName: string | null;
  quantidade: number;
  /** Unidade em que foi gravada: a do estoque naquele dia. */
  unidade: string | null;
  /** Unidade do estoque hoje; null quando o produto não tem unidade ou não existe mais. */
  unidadeDeHoje: string | null;
};

export type Conversor = (quantidade: number, de: string | null, para: string | null, productId: string) => { ok: true; quantidade: number } | { ok: false };

const mesmaUnidade = (a: string | null, b: string | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

/**
 * O que a requisição tirava, na unidade de estoque de hoje. Se o produto passou de CX para UN depois do
 * registro, comparar 2 (CX) com 24 (UN) lançaria 22 de diferença numa edição que não mexeu na quantidade.
 * Sem unidade de um dos lados, vale como veio (o mesmo que o registro faz). Sem conversão, devolve os nomes.
 */
export function retiradoNaUnidadeDeHoje(linhas: LinhaGravada[], converter: Conversor):
  { ok: true; retirado: QuantidadePorProduto[] } | { ok: false; semConversao: string[] } {
  const retirado: QuantidadePorProduto[] = [];
  const semConversao: string[] = [];
  for (const linha of linhas) {
    if (!linha.productId) continue;
    if (!linha.unidade?.trim() || !linha.unidadeDeHoje?.trim() || mesmaUnidade(linha.unidade, linha.unidadeDeHoje)) {
      retirado.push({ productId: linha.productId, quantidade: linha.quantidade });
      continue;
    }
    const convertido = converter(linha.quantidade, linha.unidade, linha.unidadeDeHoje, linha.productId);
    if (convertido.ok) retirado.push({ productId: linha.productId, quantidade: arredondar(convertido.quantidade) });
    else semConversao.push(`${linha.productName ?? linha.productId} (${linha.unidade} para ${linha.unidadeDeHoje})`);
  }
  return semConversao.length > 0 ? { ok: false, semConversao } : { ok: true, retirado };
}
