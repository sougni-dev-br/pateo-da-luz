/**
 * Gera a PRÉVIA da reorganização de produtos (natureza, categoria, subcategoria). Só lê o banco.
 *
 * Uso:  npx tsx --env-file=.env scripts/proposta-taxonomia.ts <pasta-de-saida>
 *
 * A pasta de saída deve ficar FORA do repositório: as planilhas têm nomes reais de produtos e o
 * repositório é público.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeText } from "../src/shared/utils/normalize-text.js";
import {
  PROPOSED_CATEGORIES,
  proposeCategory,
  proposeNature,
  proposeSubcategoryAction,
  type Confidence
} from "../src/modules/products/taxonomy-proposal.js";

const prisma = new PrismaClient();

type ProdutoLido = {
  externalCode: string | null;
  name: string;
  categoryName: string | null;
  subcategoryName: string | null;
  sectorName: string | null;
  dreName: string | null;
  dreGroup: string | null;
  controlsStock: boolean;
  nature: string | null;
};

/** A pasta de saída tem nomes reais de produtos: não pode ficar dentro de um repositório git (este é público). */
function dentroDeRepositorio(pasta: string): boolean {
  let atual = pasta;
  for (;;) {
    if (existsSync(join(atual, ".git"))) return true;
    const acima = dirname(atual);
    if (acima === atual) return false;
    atual = acima;
  }
}

// Excel em português abre CSV com ponto e vírgula e BOM.
function csv(linhas: Array<Array<string | number | boolean | null>>): string {
  const celula = (valor: string | number | boolean | null) => {
    const bruto = valor === null ? "" : String(valor);
    // Texto que começa com = + - @ viraria fórmula ao abrir no Excel.
    const texto = ["=", "+", "-", "@"].includes(bruto.charAt(0)) ? `'${bruto}` : bruto;
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return `﻿${linhas.map((linha) => linha.map(celula).join(";")).join("\r\n")}\r\n`;
}

const contar = <T>(itens: T[], chave: (item: T) => string) => {
  const totais = new Map<string, number>();
  for (const item of itens) totais.set(chave(item), (totais.get(chave(item)) ?? 0) + 1);
  return [...totais.entries()].sort((a, b) => b[1] - a[1]);
};

async function main() {
  const destino = process.argv[2];
  if (!destino) throw new Error("Informe a pasta de saída (fora do repositório).");
  const pasta = resolve(destino);
  if (dentroDeRepositorio(pasta)) {
    throw new Error(`A pasta de saída (${pasta}) está dentro de um repositório git. Use uma pasta fora dele.`);
  }
  mkdirSync(pasta, { recursive: true });

  const produtos = await prisma.$queryRaw<ProdutoLido[]>`
    SELECT p."externalCode", p."name", c."name" AS "categoryName", s."name" AS "subcategoryName",
           sec."name" AS "sectorName", d."name" AS "dreName", d."dreGroup" AS "dreGroup",
           p."controlsStock", p."nature"::text AS "nature"
    FROM "Product" p
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Subcategory" s ON s."id" = p."subcategoryId"
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "DRECategory" d ON d."id" = p."dreCategoryId"
    WHERE p."isActive" = true
    ORDER BY c."name" NULLS FIRST, p."name"
  `;

  const propostas = produtos.map((produto) => {
    const natureza = proposeNature(produto);
    const categoria = proposeCategory(produto);
    const definicao = categoria.category ? PROPOSED_CATEGORIES[categoria.category] : undefined;
    // Pior das confianças decide: uma dúvida em qualquer eixo manda a linha para revisão.
    const ordem: Confidence[] = ["alta", "media", "revisar"];
    const confianca = ordem[Math.max(ordem.indexOf(natureza.confidence), ordem.indexOf(categoria.confidence))];
    const conflito = Boolean(definicao && natureza.nature && definicao.nature !== natureza.nature);
    return {
      produto,
      natureza,
      categoria,
      confianca: conflito ? ("revisar" as Confidence) : confianca,
      conflito
    };
  });

  const cabecalho = [
    "codigo", "nome", "categoria_atual", "subcategoria_atual", "setor", "dre_atual", "grupo_dre", "controla_estoque",
    "natureza_gravada", "natureza_proposta", "categoria_proposta", "muda_categoria", "confianca", "motivo"
  ];
  const linhasProdutos = propostas.map(({ produto: p, natureza, categoria, confianca, conflito }) => [
    p.externalCode, p.name, p.categoryName, p.subcategoryName, p.sectorName, p.dreName, p.dreGroup, p.controlsStock ? "sim" : "nao",
    p.nature, natureza.nature, categoria.category,
    categoria.category && normalizeText(categoria.category) !== normalizeText(p.categoryName) ? "sim" : "nao",
    confianca,
    [natureza.reason, categoria.reason, conflito ? "natureza da categoria proposta diverge da natureza pela DRE" : ""].filter(Boolean).join(" | ")
  ]);
  writeFileSync(join(pasta, "produtos.csv"), csv([cabecalho, ...linhasProdutos]));
  // Só o que precisa de decisão humana, para ninguém ter que procurar.
  writeFileSync(
    join(pasta, "produtos-para-revisar.csv"),
    csv([cabecalho, ...linhasProdutos.filter((linha) => linha[12] !== "alta")])
  );

  const categoriasAtuais = await prisma.$queryRaw<Array<{ name: string; produtos: number }>>`
    SELECT c."name", COUNT(p."id")::int AS "produtos" FROM "Category" c
    LEFT JOIN "Product" p ON p."categoryId" = c."id" AND p."isActive" = true GROUP BY c."name"
  `;
  const existentes = new Set(categoriasAtuais.map((categoria) => normalizeText(categoria.name)));
  const porCategoria = contar(propostas.filter((item) => item.categoria.category), (item) => item.categoria.category as string);
  writeFileSync(
    join(pasta, "categorias.csv"),
    csv([
      ["categoria", "natureza", "dre_padrao", "produtos_propostos", "ja_existe"],
      ...Object.entries(PROPOSED_CATEGORIES).map(([nome, definicao]) => [
        nome, definicao.nature, definicao.dreName, porCategoria.find(([categoria]) => categoria === nome)?.[1] ?? 0, existentes.has(normalizeText(nome)) ? "sim" : "nao"
      ])
    ])
  );

  const subcategorias = await prisma.$queryRaw<Array<{ name: string; categoria: string; produtos: number; repetida: number }>>`
    SELECT s."name", c."name" AS "categoria", COUNT(p."id")::int AS "produtos",
           (SELECT COUNT(*)::int FROM "Subcategory" outra WHERE UPPER(outra."name") = UPPER(s."name")) AS "repetida"
    FROM "Subcategory" s JOIN "Category" c ON c."id" = s."categoryId"
    LEFT JOIN "Product" p ON p."subcategoryId" = s."id"
    GROUP BY s."id", s."name", c."name" ORDER BY c."name", s."name"
  `;
  writeFileSync(
    join(pasta, "subcategorias.csv"),
    csv([
      ["categoria", "subcategoria", "produtos", "acao_proposta", "motivo"],
      ...subcategorias.map((sub) => {
        const acao = proposeSubcategoryAction({ name: sub.name, products: sub.produtos, nameRepeatedIn: sub.repetida });
        return [sub.categoria, sub.name, sub.produtos, acao.action, acao.reason];
      })
    ])
  );

  const total = propostas.length;
  const porConfianca = contar(propostas, (item) => item.confianca);
  const resumo = [
    "# Prévia da reorganização de produtos",
    "",
    `Produtos ativos analisados: ${total}`,
    "",
    "## Confiança",
    ...porConfianca.map(([nome, qtd]) => `- ${nome}: ${qtd} (${Math.round((qtd / total) * 100)}%)`),
    "",
    "## Natureza proposta",
    ...contar(propostas, (item) => item.natureza.nature ?? "(sem proposta)").map(([nome, qtd]) => `- ${nome}: ${qtd}`),
    "",
    "## Categoria proposta",
    ...contar(propostas, (item) => item.categoria.category ?? "(para revisar)").map(([nome, qtd]) => `- ${nome}: ${qtd}`),
    "",
    `Produtos que mudam de categoria: ${propostas.filter((item) => item.categoria.category && normalizeText(item.categoria.category) !== normalizeText(item.produto.categoryName)).length}`,
    `Nada foi gravado no banco.`
  ].join("\n");
  writeFileSync(join(pasta, "resumo.md"), resumo);
  console.log(resumo);
  console.log(`\nArquivos em ${pasta}`);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
