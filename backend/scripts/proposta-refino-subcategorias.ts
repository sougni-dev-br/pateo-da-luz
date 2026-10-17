/**
 * Gera a PRÉVIA do refino das subcategorias que já existem (separar as grandes, corrigir as mal colocadas).
 * Só lê o banco.
 *
 * Uso:  npx tsx --env-file=.env scripts/proposta-refino-subcategorias.ts <pasta-de-saida>
 *
 * A pasta de saída deve ficar FORA do repositório: a planilha tem nomes reais de produtos e o repositório é
 * público. O dono revisa a coluna "subcategoria proposta" (pode editar ou apagar) e a aplicação é outra etapa:
 * scripts/aplicar-subcategorias.ts <planilha> --trocar.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeText } from "../src/shared/utils/normalize-text.js";
import { proposeRefinement, subcategoriasComRefino } from "../src/modules/products/subcategory-refinement.js";

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

function csv(linhas: Array<Array<string | number | null>>): string {
  const celula = (valor: string | number | null) => {
    const bruto = valor === null ? "" : String(valor);
    const texto = ["=", "+", "-", "@", "\t", "\r"].includes(bruto.charAt(0)) ? `'${bruto}` : bruto;
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return `﻿${linhas.map((linha) => linha.map(celula).join(";")).join("\r\n")}\r\n`;
}

async function main() {
  if (!process.argv[2]) throw new Error("Informe a pasta de saída (fora do repositório).");
  const pasta = resolve(process.argv[2]);
  if (dentroDeRepositorio(pasta)) throw new Error("A saída tem nomes reais de produtos e não pode ficar dentro de um repositório git (este é público).");
  mkdirSync(pasta, { recursive: true });

  const alvos = new Set(subcategoriasComRefino().map((r) => `${r.categoria}|${r.subcategoriaAtual}`));
  const produtos = await prisma.product.findMany({
    where: { isActive: true, subcategoryId: { not: null } },
    select: { externalCode: true, name: true, category: { select: { name: true } }, subcategory: { select: { name: true } } },
    orderBy: [{ category: { name: "asc" } }, { subcategory: { name: "asc" } }, { name: "asc" }]
  });
  const existentes = await prisma.subcategory.findMany({ select: { name: true, category: { select: { name: true } } } });
  const jaExiste = new Set(existentes.map((s) => `${normalizeText(s.category.name)}|${normalizeText(s.name)}`));

  const linhas: Array<Array<string | number | null>> = [
    ["codigo", "produto", "categoria atual", "subcategoria atual", "subcategoria proposta", "acao", "criar subcategoria", "categoria sugerida (aviso)", "motivo"]
  ];
  const resumo = new Map<string, number>();
  const aCriar = new Set<string>();
  let semProposta = 0;

  for (const produto of produtos) {
    const categoria = produto.category?.name ?? "";
    const atual = produto.subcategory?.name ?? "";
    if (!alvos.has(`${normalizeText(categoria)}|${normalizeText(atual)}`)) continue;
    const refino = proposeRefinement({ name: produto.name, categoryName: categoria, subcategoryName: atual });
    if (!refino) continue;
    const mudou = refino.esvaziar || (refino.subcategory !== null && normalizeText(refino.subcategory) !== normalizeText(atual));
    if (!mudou) {
      semProposta += 1;
      continue;
    }
    const criar = refino.subcategory !== null && !jaExiste.has(`${normalizeText(categoria)}|${normalizeText(refino.subcategory)}`);
    if (criar && refino.subcategory) aCriar.add(`${categoria} > ${refino.subcategory}`);
    const chave = `${categoria} > ${atual} → ${refino.esvaziar ? "(esvaziar)" : refino.subcategory}`;
    resumo.set(chave, (resumo.get(chave) ?? 0) + 1);
    linhas.push([
      produto.externalCode,
      produto.name,
      categoria,
      atual,
      refino.subcategory,
      refino.esvaziar ? "ESVAZIAR" : "",
      criar ? "SIM" : refino.subcategory ? "já existe" : "",
      refino.categoriaSugerida,
      refino.reason
    ]);
  }

  writeFileSync(join(pasta, "proposta-refino-subcategorias.csv"), csv(linhas), "utf8");
  writeFileSync(
    join(pasta, "resumo-refino-subcategorias.csv"),
    csv([["de > para", "produtos"], ...[...resumo.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n])]),
    "utf8"
  );
  console.log(`Produtos com proposta de refino: ${linhas.length - 1} | ficam como estão (sem regra que case): ${semProposta}`);
  console.log(`Subcategorias novas a criar: ${aCriar.size}`);
  for (const [chave, n] of [...resumo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${n}\t${chave}`);
  console.log(`Arquivos em ${pasta}`);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
