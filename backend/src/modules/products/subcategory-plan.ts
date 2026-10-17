/**
 * Plano de aplicação das subcategorias aprovadas na planilha. Só calcula, nada aqui grava.
 *
 * Regras: por padrão só preenche produto que ainda NÃO tem subcategoria (nunca troca a que já existe); no modo
 * `trocar`, troca a subcategoria apenas quando a planilha mostra a subcategoria atual do produto e ela ainda é
 * essa (a planilha foi revisada para aquele estado). Reaproveita a subcategoria existente da mesma categoria,
 * comparando sem caixa nem acento; cria só o que falta; e só vale se a categoria da planilha ainda é a do produto.
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";

export type LinhaDeSubcategoria = {
  codigo: string;
  subcategoria: string;
  /** Categoria que a planilha mostrava para o produto; quando informada, precisa bater com a do banco. */
  categoria?: string;
  /** Subcategoria que a planilha mostrava como atual (modo trocar). */
  subcategoriaAtual?: string;
  /** "ESVAZIAR": a subcategoria atual não serve e o produto fica sem subcategoria (modo trocar). */
  acao?: string;
};

export type ProdutoParaSubcategoria = {
  id: string;
  externalCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  subcategoryName?: string | null;
};

export type SubcategoriaExistente = { id: string; name: string; categoryId: string; isActive?: boolean };

export type AtribuicaoDeSubcategoria = {
  productId: string;
  codigo: string;
  categoryId: string;
  /** Nome final da subcategoria; nulo quando a ação é esvaziar. */
  name: string | null;
  chave: string | null;
  /** Subcategoria que o produto tem agora (nula se não tem): o gravar só vale se ainda for essa. */
  antesId: string | null;
};

export type PlanoDeSubcategorias = {
  criar: Array<{ categoryId: string; categoryName: string; name: string }>;
  atribuir: AtribuicaoDeSubcategoria[];
  ignorados: Array<{ codigo: string; motivo: string }>;
};

/** Maiúsculas, espaços simples: o padrão das subcategorias já cadastradas. */
export function nomeDaSubcategoria(bruto: string): string {
  return bruto.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Chave única da subcategoria dentro da categoria: sem caixa nem acento. */
export function chaveDaSubcategoria(categoryId: string, nome: string): string {
  return `${categoryId}|${normalizeText(nome)}`;
}

export function planejarSubcategorias(
  linhas: LinhaDeSubcategoria[],
  produtos: ProdutoParaSubcategoria[],
  existentes: SubcategoriaExistente[],
  opcoes: { trocar?: boolean } = {}
): PlanoDeSubcategorias {
  const trocar = opcoes.trocar === true;
  const porCodigo = new Map(produtos.filter((p) => p.externalCode).map((p) => [String(p.externalCode), p]));
  const conhecidas = new Map(existentes.map((s) => [chaveDaSubcategoria(s.categoryId, s.name), s]));
  const criar = new Map<string, { categoryId: string; categoryName: string; name: string }>();
  const atribuir: PlanoDeSubcategorias["atribuir"] = [];
  const ignorados: PlanoDeSubcategorias["ignorados"] = [];
  const vistos = new Set<string>();

  for (const linha of linhas) {
    const nome = nomeDaSubcategoria(linha.subcategoria);
    const esvaziar = trocar && normalizeText(linha.acao) === "esvaziar";
    if (!nome && !esvaziar) continue; // em branco: o dono não escolheu, nada a fazer
    const codigo = linha.codigo.trim();
    if (vistos.has(codigo)) {
      ignorados.push({ codigo, motivo: "código repetido na planilha" });
      continue;
    }
    vistos.add(codigo);

    const produto = porCodigo.get(codigo);
    if (!produto) {
      ignorados.push({ codigo, motivo: "produto não encontrado" });
      continue;
    }
    if (!produto.categoryId) {
      ignorados.push({ codigo, motivo: "produto sem categoria" });
      continue;
    }
    if (linha.categoria !== undefined && normalizeText(linha.categoria) !== normalizeText(produto.categoryName)) {
      ignorados.push({ codigo, motivo: `a categoria mudou desde a planilha (era ${linha.categoria}, agora ${produto.categoryName ?? "nenhuma"})` });
      continue;
    }

    if (produto.subcategoryId) {
      if (!trocar) {
        ignorados.push({ codigo, motivo: "já tem subcategoria (a planilha nunca troca a existente)" });
        continue;
      }
      if (linha.subcategoriaAtual === undefined || normalizeText(linha.subcategoriaAtual) !== normalizeText(produto.subcategoryName)) {
        ignorados.push({ codigo, motivo: `a subcategoria mudou desde a planilha (era ${linha.subcategoriaAtual ?? "?"}, agora ${produto.subcategoryName ?? "outra"})` });
        continue;
      }
    } else if (trocar && esvaziar) {
      ignorados.push({ codigo, motivo: "já está sem subcategoria" });
      continue;
    }

    if (esvaziar) {
      atribuir.push({ productId: produto.id, codigo, categoryId: produto.categoryId, name: null, chave: null, antesId: produto.subcategoryId });
      continue;
    }

    const chave = chaveDaSubcategoria(produto.categoryId, nome);
    const existente = conhecidas.get(chave);
    if (existente && existente.isActive === false) {
      ignorados.push({ codigo, motivo: `a subcategoria ${existente.name} existe mas está inativa: reative ou escolha outra` });
      continue;
    }
    if (existente && existente.id === produto.subcategoryId) {
      ignorados.push({ codigo, motivo: "já está nessa subcategoria" });
      continue;
    }
    if (!existente && !criar.has(chave)) {
      criar.set(chave, { categoryId: produto.categoryId, categoryName: produto.categoryName ?? "", name: nome });
    }
    const nomeFinal = existente?.name ?? criar.get(chave)?.name ?? nome;
    atribuir.push({ productId: produto.id, codigo, categoryId: produto.categoryId, name: nomeFinal, chave, antesId: produto.subcategoryId });
  }

  return { criar: [...criar.values()], atribuir, ignorados };
}
