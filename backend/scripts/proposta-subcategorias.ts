/**
 * Gera a PRÉVIA de subcategorias para os produtos ativos que só têm categoria. Só lê o banco.
 *
 * Uso:  npx tsx --env-file=.env scripts/proposta-subcategorias.ts <pasta-de-saida>
 *
 * A pasta de saída deve ficar FORA do repositório: a planilha tem nomes reais de produtos e o
 * repositório é público. O dono revisa a coluna "subcategoria proposta", corrige o que precisar e a
 * aplicação é uma etapa separada.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeText } from "../src/shared/utils/normalize-text.js";
import { proposeSubcategoryForProduct } from "../src/modules/products/subcategory-proposal.js";

const prisma = new PrismaClient();

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
function csv(linhas: Array<Array<string | number | null>>): string {
  const celula = (valor: string | number | null) => {
    const bruto = valor === null ? "" : String(valor);
    const texto = ["=", "+", "-", "@", "\t", "\r"].includes(bruto.charAt(0)) ? `'${bruto}` : bruto;
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return `﻿${linhas.map((linha) => linha.map(celula).join(";")).join("\r\n")}\r\n`;
}

async function main() {
  const pasta = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("Informe a pasta de saída (fora do repositório).");
  if (dentroDeRepositorio(pasta)) throw new Error("A saída tem nomes reais de produtos e não pode ficar dentro de um repositório git (este é público).");
  mkdirSync(pasta, { recursive: true });

  const produtos = await prisma.product.findMany({
    where: { isActive: true, subcategoryId: null, categoryId: { not: null } },
    select: { externalCode: true, name: true, category: { select: { name: true } } },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }]
  });
  const existentes = await prisma.subcategory.findMany({ select: { name: true, category: { select: { name: true } } } });
  const jaExiste = new Set(existentes.map((s) => `${normalizeText(s.category.name)}|${normalizeText(s.name)}`));

  const linhas: Array<Array<string | number | null>> = [
    ["codigo", "produto", "categoria atual", "subcategoria proposta", "criar subcategoria", "categoria sugerida (aviso)", "motivo"]
  ];
  const porCategoria = new Map<string, { total: number; propostos: number; avisos: number }>();
  const aCriar = new Set<string>();

  for (const produto of produtos) {
    const categoria = produto.category?.name ?? "";
    const proposta = proposeSubcategoryForProduct({ name: produto.name, categoryName: categoria });
    const criar = proposta.subcategory !== null && !jaExiste.has(`${normalizeText(categoria)}|${normalizeText(proposta.subcategory)}`);
    if (criar && proposta.subcategory) aCriar.add(`${categoria} > ${proposta.subcategory}`);
    linhas.push([
      produto.externalCode,
      produto.name,
      categoria,
      proposta.subcategory,
      criar ? "SIM" : proposta.subcategory ? "já existe" : "",
      proposta.categoriaSugerida,
      proposta.reason
    ]);
    const conta = porCategoria.get(categoria) ?? { total: 0, propostos: 0, avisos: 0 };
    conta.total += 1;
    if (proposta.subcategory) conta.propostos += 1;
    if (proposta.categoriaSugerida) conta.avisos += 1;
    porCategoria.set(categoria, conta);
  }

  writeFileSync(join(pasta, "proposta-subcategorias.csv"), csv(linhas), "utf8");
  writeFileSync(
    join(pasta, "resumo-subcategorias.csv"),
    csv([
      ["categoria", "produtos sem subcategoria", "com proposta", "sem proposta (revisar)", "avisos de categoria"],
      ...[...porCategoria.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([categoria, c]) => [categoria, c.total, c.propostos, c.total - c.propostos - c.avisos, c.avisos])
    ]),
    "utf8"
  );
  writeFileSync(join(pasta, "subcategorias-a-criar.csv"), csv([["categoria > subcategoria"], ...[...aCriar].sort().map((s) => [s])]), "utf8");

  const propostos = linhas.slice(1).filter((l) => l[3]).length;
  console.log(`Produtos sem subcategoria: ${produtos.length} | com proposta: ${propostos} | sem proposta: ${produtos.length - propostos}`);
  console.log(`Subcategorias novas a criar: ${aCriar.size}`);
  console.log(`Arquivos em ${pasta}`);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
