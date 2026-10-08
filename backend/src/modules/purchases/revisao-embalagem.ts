// Revisao de embalagens das compras ja lancadas.
//
// O problema: a nota diz "10 UN a R$ 2,99" e o produto e contado em UN, mas o
// "UN" do fornecedor e um pacote com 50 forminhas. Como as duas unidades tem o
// mesmo nome, a conversao nunca entra (1 UN = 1 UN) e o custo da forminha vira
// o custo do pacote. O mesmo fornecedor as vezes manda avulso (3.000 UN a
// R$ 0,05), entao nao da para fixar um fator no produto: decide-se por linha.
//
// O sinal e o preco: dentro do mesmo produto, uma linha que custa 10x ou mais
// que a mais barata quase sempre e pacote/caixa lancado como unidade.

export const RAZAO_SUSPEITA = 10;

export type LinhaDeCompra = {
  id: string;
  /** Preco por unidade de contagem (ja convertido quando havia conversao). */
  precoUnitario: number;
  revisada: boolean;
};

/** Menor preco por unidade entre as linhas do produto (a referencia do avulso). */
export function precoDeReferencia(linhas: readonly Pick<LinhaDeCompra, "precoUnitario">[]): number | null {
  const precos = linhas.map((l) => l.precoUnitario).filter((p) => Number.isFinite(p) && p > 0);
  return precos.length ? Math.min(...precos) : null;
}

/** Linha que provavelmente e embalagem lancada como unidade. */
export function pareceEmbalagem(precoUnitario: number, referencia: number | null): boolean {
  return referencia != null && referencia > 0 && precoUnitario >= referencia * RAZAO_SUSPEITA;
}

/**
 * Produto entra na revisao quando ha linha suspeita ainda nao revisada. Linhas
 * revisadas continuam valendo como referencia (o avulso confirmado ancora o
 * preco), mas nao reabrem o produto.
 */
export function linhasSuspeitas<T extends LinhaDeCompra>(linhas: readonly T[]): T[] {
  const referencia = precoDeReferencia(linhas);
  return linhas.filter((l) => !l.revisada && pareceEmbalagem(l.precoUnitario, referencia));
}

/** Quantas unidades de contagem cabem na embalagem: o preco sugere o fator. */
export function fatorSugeridoPeloPreco(precoUnitario: number, referencia: number | null): number | null {
  if (!referencia || referencia <= 0 || precoUnitario <= 0) return null;
  const bruto = precoUnitario / referencia;
  // Embalagens costumam vir em numeros redondos: 10, 12, 20, 24, 50, 100...
  const redondos = [6, 10, 12, 15, 20, 24, 25, 30, 40, 48, 50, 60, 100, 120, 200, 250, 500, 1000];
  const maisPerto = redondos.reduce((a, b) => (Math.abs(b - bruto) < Math.abs(a - bruto) ? b : a));
  return Math.abs(maisPerto - bruto) / bruto <= 0.35 ? maisPerto : Math.round(bruto);
}

export type ValidacaoDeEmbalagem =
  | { ok: true; avulso: true }
  | { ok: true; avulso: false; unidade: string; fator: number }
  | { ok: false; erro: string };

/** Valida a escolha de uma linha: avulso, ou embalagem com unidade e fator. */
export function validarEmbalagem(entrada: { avulso?: unknown; unidade?: unknown; fator?: unknown }, unidadeDeContagem: string): ValidacaoDeEmbalagem {
  if (entrada.avulso === true) return { ok: true, avulso: true };
  const unidade = String(entrada.unidade ?? "").trim().toUpperCase();
  const fator = typeof entrada.fator === "number" ? entrada.fator : Number(String(entrada.fator ?? "").replace(",", "."));
  if (!unidade) return { ok: false, erro: "Escolha a embalagem (PCT, CX, FD...)." };
  if (unidade === unidadeDeContagem.toUpperCase()) {
    return { ok: false, erro: `A embalagem precisa ter outro nome que a unidade de contagem (${unidadeDeContagem}): use PCT, CX, FD...` };
  }
  if (!Number.isFinite(fator) || fator <= 1) return { ok: false, erro: "Informe quantas unidades vem em cada embalagem (mais que 1)." };
  if (fator > 100000) return { ok: false, erro: "Fator acima de 100.000: confira." };
  return { ok: true, avulso: false, unidade, fator };
}
