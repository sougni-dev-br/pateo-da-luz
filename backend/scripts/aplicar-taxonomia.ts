/**
 * Aplica (ou reverte) a reclassificação de produtos (natureza, categoria, subcategoria) a partir de um arquivo de
 * decisões já revisado. SIMULA por padrão: só com --aplicar grava.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/aplicar-taxonomia.ts <decisoes.csv> --saida <pasta-fora-do-repositorio> [--aplicar]
 *   npx tsx --env-file=.env scripts/aplicar-taxonomia.ts --reverter <reversao.json> [--aplicar]
 *
 * Garantias:
 *  - não toca em categoria DRE, controle de estoque, setor, unidade, nome nem situação do produto (mudar a DRE
 *    reescreve o histórico do DRE); uma impressão digital desses campos é conferida dentro da transação e, se
 *    mudar, tudo é desfeito;
 *  - grava o arquivo de reversão ANTES de mudar qualquer coisa e o completa depois (ids criados);
 *  - recusa aplicar se uma regra ativa da agenda de contagem aponta para uma categoria que seria desativada;
 *  - confere, dentro da transação, que os produtos não mudaram desde a leitura e que remoções e desativações
 *    aconteceram na quantidade planejada;
 *  - é idempotente: rodar de novo não propõe nada;
 *  - o arquivo de decisões e a pasta de saída têm nomes reais de produtos: ficam FORA do repositório (público).
 *
 * Antes de rodar em produção: backup do banco (pg_dump) e comparação do DRE e do CMV antes e depois
 * (scripts/comparar-relatorios.ts). Roteiro completo em docs/runbook-reorganizacao-cadastros.md.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient, type ProductNature } from "@prisma/client";
import { lerDecisoes } from "../src/modules/products/taxonomy-csv.js";
import { planTaxonomy, type CategoryRef, type SubcategoryRef } from "../src/modules/products/taxonomy-plan.js";
import { normalizeText } from "../src/shared/utils/normalize-text.js";

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

const impressaoDigital = (produtos: Array<Record<string, unknown>>) =>
  createHash("sha256").update(JSON.stringify([...produtos].sort((a, b) => String(a.id).localeCompare(String(b.id))))).digest("hex");

const CAMPOS_PROTEGIDOS = { id: true, name: true, dreCategoryId: true, controlsStock: true, inventorySectorId: true, unit: true, unitMeasureId: true, isActive: true } as const;

type Reversao = {
  criadoEm: string;
  produtos: Array<{ id: string; categoryId: string | null; subcategoryId: string | null; nature: string | null }>;
  subcategoriasRemovidas: Array<{ id: string; name: string; categoryId: string; isActive: boolean; notes: string | null }>;
  categoriasDesativadas: Array<{ id: string; name: string }>;
  categoriasAtualizadas: Array<{ id: string; name: string; nature: string | null; defaultDreCategoryId: string | null; isActive: boolean }>;
  categoriasCriadas: Array<{ name: string; id?: string }>;
  subcategoriasCriadas: Array<{ id: string }>;
};

function argumento(args: string[], nome: string): string | null {
  const i = args.indexOf(nome);
  if (i < 0) return null;
  const valor = args[i + 1];
  if (!valor || valor.startsWith("--")) throw new Error(`${nome} precisa de um valor.`);
  return valor;
}

function mostrarBanco() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    console.log(`Banco: ${url.hostname}${url.pathname}`);
  } catch {
    console.log("Banco: (DATABASE_URL ausente ou inválida)");
  }
}

async function referenciasSoltas(subIds: string[], categoriaIds: string[]) {
  const [regrasAtivas, itensDaAgenda, sessoes] = await Promise.all([
    prisma.inventoryAgendaRule.count({ where: { isActive: true, categoryId: { in: categoriaIds } } }),
    prisma.inventoryAgendaItem.count({ where: { categoryId: { in: categoriaIds } } }),
    prisma.stockCountSession.count({ where: { OR: [{ categoryId: { in: categoriaIds } }, { subcategoryId: { in: subIds } }] } })
  ]);
  return { regrasAtivas, itensDaAgenda, sessoes };
}

async function aplicarDecisoes(arquivo: string, saida: string | null, aplicar: boolean) {
  if (aplicar && !saida) throw new Error("Com --aplicar é obrigatório --saida <pasta> para o arquivo de reversão.");
  if (saida && dentroDeRepositorio(saida)) throw new Error(`A pasta de saída (${saida}) está dentro de um repositório git. Use uma pasta fora dele.`);
  if (dentroDeRepositorio(resolve(arquivo))) throw new Error("O arquivo de decisões tem nomes reais de produtos e não pode estar dentro de um repositório git.");

  const decisions = lerDecisoes(readFileSync(resolve(arquivo), "utf-8"));
  const [products, categories, subcategories, dreCategories, protegidosAntes] = await Promise.all([
    prisma.product.findMany({ select: { id: true, externalCode: true, categoryId: true, subcategoryId: true, nature: true } }),
    prisma.category.findMany({ select: { id: true, name: true, nature: true, defaultDreCategoryId: true, isActive: true } }),
    prisma.subcategory.findMany({ select: { id: true, name: true, categoryId: true, isActive: true, notes: true } }),
    prisma.dRECategory.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: CAMPOS_PROTEGIDOS })
  ]);

  const plano = planTaxonomy({ decisions, products, categories, subcategories, dreCategories });
  const referencias = await referenciasSoltas(plano.subcategoriesToDelete.map((s) => s.id), plano.categoriesToDeactivate.map((c) => c.id));
  const resumo = [
    `Decisões lidas: ${decisions.length}`,
    `Categorias a criar: ${plano.categoriesToCreate.length} (${plano.categoriesToCreate.map((c) => c.name).join(", ") || "-"})`,
    `Categorias a completar ou reativar: ${plano.categoriesToUpdate.length}`,
    `Subcategorias a criar: ${plano.subcategoriesToCreate.length}`,
    `Produtos a alterar: ${plano.productChanges.length} de ${products.length}`,
    `Subcategorias a remover: ${plano.subcategoriesToDelete.length}`,
    `Categorias a desativar (ficam sem produto): ${plano.categoriesToDeactivate.length} (${plano.categoriesToDeactivate.map((c) => c.name).join(", ") || "-"})`,
    `Referências soltas às categorias/subcategorias afetadas: regras ativas da agenda ${referencias.regrasAtivas}, itens da agenda ${referencias.itensDaAgenda}, sessões de contagem ${referencias.sessoes}`,
    ...plano.warnings.map((aviso) => `AVISO: ${aviso}`)
  ].join("\n");
  console.log(resumo);

  if (!aplicar) {
    console.log("\nSIMULAÇÃO: nada foi gravado. Use --aplicar para gravar.");
    return;
  }
  if (referencias.regrasAtivas > 0) {
    throw new Error(`${referencias.regrasAtivas} regra(s) ativa(s) da agenda de contagem usam categorias que seriam desativadas. Ajuste a agenda antes.`);
  }
  if (plano.productChanges.length + plano.categoriesToCreate.length + plano.categoriesToUpdate.length + plano.subcategoriesToDelete.length + plano.categoriesToDeactivate.length === 0) {
    console.log("\nNada a fazer (já aplicado).");
    return;
  }

  mostrarBanco();
  const pasta = saida as string;
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivoReversao = join(pasta, `reversao-${carimbo}.json`);
  const subPorId = new Map(subcategories.map((sub) => [sub.id, sub]));
  const categoriaPorId = new Map(categories.map((categoria) => [categoria.id, categoria]));
  const reversao: Reversao = {
    criadoEm: new Date().toISOString(),
    produtos: plano.productChanges.map((m) => ({ id: m.productId, ...m.before })),
    subcategoriasRemovidas: plano.subcategoriesToDelete.map((sub) => ({ id: sub.id, name: sub.name, categoryId: sub.categoryId, isActive: subPorId.get(sub.id)?.isActive ?? true, notes: subPorId.get(sub.id)?.notes ?? null })),
    categoriasDesativadas: plano.categoriesToDeactivate,
    categoriasAtualizadas: plano.categoriesToUpdate.map((a) => ({ id: a.id, name: a.name, nature: categoriaPorId.get(a.id)?.nature ?? null, defaultDreCategoryId: categoriaPorId.get(a.id)?.defaultDreCategoryId ?? null, isActive: categoriaPorId.get(a.id)?.isActive ?? true })),
    categoriasCriadas: plano.categoriesToCreate.map((c) => ({ name: c.name })),
    subcategoriasCriadas: []
  };
  writeFileSync(arquivoReversao, JSON.stringify(reversao));
  writeFileSync(join(pasta, `resumo-${carimbo}.txt`), resumo);
  console.log(`\nReversão gravada em ${arquivoReversao}`);

  const digitalAntes = impressaoDigital(protegidosAntes);
  const estadoLido = new Map(products.map((p) => [p.id, p]));
  await prisma.$transaction(
    async (tx) => {
      // O plano foi calculado fora da transação: se alguém editou um desses produtos nesse intervalo, para.
      const atuais = await tx.product.findMany({ where: { id: { in: plano.productChanges.map((m) => m.productId) } }, select: { id: true, categoryId: true, subcategoryId: true, nature: true } });
      for (const atual of atuais) {
        const lido = estadoLido.get(atual.id);
        if (!lido || lido.categoryId !== atual.categoryId || lido.subcategoryId !== atual.subcategoryId || lido.nature !== atual.nature) {
          throw new Error("Um produto foi alterado no sistema durante a aplicação. Nada foi gravado; rode de novo.");
        }
      }

      const idDaCategoria = new Map<string, string>();
      for (const nova of plano.categoriesToCreate) {
        const criada = await tx.category.create({ data: { name: nova.name, nature: nova.nature as ProductNature, defaultDreCategoryId: nova.defaultDreCategoryId, isActive: true } });
        idDaCategoria.set(normalizeText(nova.name), criada.id);
        const registro = reversao.categoriasCriadas.find((c) => c.name === nova.name);
        if (registro) registro.id = criada.id;
      }
      for (const alteracao of plano.categoriesToUpdate) {
        await tx.category.update({
          where: { id: alteracao.id },
          data: {
            ...(alteracao.nature ? { nature: alteracao.nature as ProductNature } : {}),
            ...(alteracao.defaultDreCategoryId ? { defaultDreCategoryId: alteracao.defaultDreCategoryId } : {}),
            ...(alteracao.isActive ? { isActive: true } : {})
          }
        });
      }
      const resolverCategoria = (ref: CategoryRef): string => {
        if ("id" in ref) return ref.id;
        const id = idDaCategoria.get(normalizeText(ref.newName));
        if (!id) throw new Error(`Categoria "${ref.newName}" não foi criada.`);
        return id;
      };
      const idDaSub = new Map<string, string>();
      for (const nova of plano.subcategoriesToCreate) {
        const categoryId = resolverCategoria(nova.category);
        const existia = await tx.subcategory.findUnique({ where: { categoryId_name: { categoryId, name: nova.name } }, select: { id: true } });
        const sub = existia ?? (await tx.subcategory.create({ data: { categoryId, name: nova.name, isActive: true } }));
        if (!existia) reversao.subcategoriasCriadas.push({ id: sub.id });
        idDaSub.set(`${categoryId}|${normalizeText(nova.name)}`, sub.id);
      }
      const resolverSub = (ref: SubcategoryRef): string | null => {
        if (!ref) return null;
        if ("id" in ref) return ref.id;
        const id = idDaSub.get(`${resolverCategoria(ref.category)}|${normalizeText(ref.newName)}`);
        if (!id) throw new Error(`Subcategoria "${ref.newName}" não foi criada.`);
        return id;
      };
      for (const mudanca of plano.productChanges) {
        await tx.product.update({
          where: { id: mudanca.productId },
          data: {
            ...(mudanca.category ? { categoryId: resolverCategoria(mudanca.category) } : {}),
            subcategoryId: resolverSub(mudanca.subcategory),
            nature: (mudanca.nature as ProductNature | null) ?? null
          }
        });
      }
      if (plano.subcategoriesToDelete.length > 0) {
        const apagadas = await tx.subcategory.deleteMany({ where: { id: { in: plano.subcategoriesToDelete.map((sub) => sub.id) }, products: { none: {} } } });
        if (apagadas.count !== plano.subcategoriesToDelete.length) {
          throw new Error(`Eram ${plano.subcategoriesToDelete.length} subcategorias a remover, mas só ${apagadas.count} estavam vazias. Nada foi gravado.`);
        }
      }
      if (plano.categoriesToDeactivate.length > 0) {
        const desativadas = await tx.category.updateMany({ where: { id: { in: plano.categoriesToDeactivate.map((c) => c.id) }, products: { none: {} } }, data: { isActive: false } });
        if (desativadas.count !== plano.categoriesToDeactivate.length) {
          throw new Error(`Eram ${plano.categoriesToDeactivate.length} categorias a desativar, mas só ${desativadas.count} estavam vazias. Nada foi gravado.`);
        }
      }
      const digitalDepois = impressaoDigital(await tx.product.findMany({ select: CAMPOS_PROTEGIDOS }));
      if (digitalDepois !== digitalAntes) {
        throw new Error("Os campos protegidos (DRE, estoque, setor, unidade, nome, situação) mudaram. Tudo foi desfeito.");
      }
    },
    { timeout: 300_000, maxWait: 30_000 }
  );
  // Completa a reversão com os ids que só existem depois da gravação.
  writeFileSync(arquivoReversao, JSON.stringify(reversao));
  console.log("APLICADO. Campos protegidos conferidos: nenhum mudou.");
}

async function reverter(arquivo: string, aplicar: boolean) {
  const reversao = JSON.parse(readFileSync(resolve(arquivo), "utf-8")) as Reversao;
  console.log(`Reversão de ${reversao.criadoEm}: ${reversao.produtos.length} produto(s), ${reversao.subcategoriasRemovidas.length} subcategoria(s) a recriar, ${reversao.categoriasDesativadas.length} categoria(s) a reativar, ${reversao.categoriasCriadas.length} categoria(s) a remover se vazias.`);
  if (!aplicar) {
    console.log("\nSIMULAÇÃO: nada foi gravado. Use --aplicar para reverter.");
    return;
  }
  mostrarBanco();
  const digitalAntes = impressaoDigital(await prisma.product.findMany({ select: CAMPOS_PROTEGIDOS }));
  await prisma.$transaction(
    async (tx) => {
      for (const sub of reversao.subcategoriasRemovidas) {
        await tx.subcategory.upsert({ where: { id: sub.id }, create: { id: sub.id, name: sub.name, categoryId: sub.categoryId, isActive: sub.isActive, notes: sub.notes }, update: {} });
      }
      for (const categoria of reversao.categoriasDesativadas) await tx.category.update({ where: { id: categoria.id }, data: { isActive: true } });
      for (const antes of reversao.categoriasAtualizadas) {
        await tx.category.update({ where: { id: antes.id }, data: { nature: (antes.nature as ProductNature | null) ?? null, defaultDreCategoryId: antes.defaultDreCategoryId, isActive: antes.isActive } });
      }
      for (const produto of reversao.produtos) {
        await tx.product.update({ where: { id: produto.id }, data: { categoryId: produto.categoryId, subcategoryId: produto.subcategoryId, nature: (produto.nature as ProductNature | null) ?? null } });
      }
      if (reversao.subcategoriasCriadas.length > 0) {
        await tx.subcategory.deleteMany({ where: { id: { in: reversao.subcategoriasCriadas.map((s) => s.id) }, products: { none: {} } } });
      }
      for (const criada of reversao.categoriasCriadas) {
        await tx.category.deleteMany({ where: { ...(criada.id ? { id: criada.id } : { name: criada.name }), products: { none: {} }, subcategories: { none: {} } } });
      }
      const digitalDepois = impressaoDigital(await tx.product.findMany({ select: CAMPOS_PROTEGIDOS }));
      if (digitalDepois !== digitalAntes) throw new Error("Os campos protegidos mudaram durante a reversão. Tudo foi desfeito.");
    },
    { timeout: 300_000, maxWait: 30_000 }
  );
  console.log("REVERTIDO.");
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const arquivoDeReversao = argumento(args, "--reverter");
  if (arquivoDeReversao) return reverter(arquivoDeReversao, aplicar);
  const arquivo = args[0];
  if (!arquivo || arquivo.startsWith("--")) throw new Error("Informe o arquivo de decisões (.csv) como primeiro argumento.");
  const saida = argumento(args, "--saida");
  return aplicarDecisoes(arquivo, saida ? resolve(saida) : null, aplicar);
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

