/**
 * Aplica (ou reverte) as subcategorias aprovadas na planilha gerada por proposta-subcategorias.ts (produtos sem
 * subcategoria) ou por proposta-refino-subcategorias.ts (refino das que já existem, com --trocar).
 * SIMULA por padrão: só com --aplicar grava.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/aplicar-subcategorias.ts <planilha.csv> --saida <pasta-fora-do-repositorio> [--trocar] [--aplicar]
 *   npx tsx --env-file=.env scripts/aplicar-subcategorias.ts --reverter <reversao.json> [--aplicar]
 *
 * Garantias:
 *  - sem --trocar, só preenche produto que ainda não tem subcategoria e nunca troca a existente;
 *  - com --trocar, só troca quando a planilha mostra a subcategoria atual do produto e ela ainda é essa;
 *  - só vale se a categoria do produto ainda é a que a planilha mostrava;
 *  - só mexe em `subcategoryId` (e cria subcategorias que faltam): categoria, DRE, estoque, setor, natureza,
 *    unidade, nome e situação dos produtos tocados são conferidos dentro da transação;
 *  - grava o arquivo de reversão com o PLANO antes de mudar qualquer coisa e o completa depois;
 *  - a planilha e a pasta de saída têm nomes reais de produtos: ficam FORA do repositório (público).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { lerCsv } from "../src/modules/products/taxonomy-csv.js";
import { chaveDaSubcategoria, planejarSubcategorias, type LinhaDeSubcategoria } from "../src/modules/products/subcategory-plan.js";

const prisma = new PrismaClient();

function dentroDeRepositorio(caminho: string): boolean {
  let atual = existsSync(caminho) ? realpathSync(caminho) : caminho;
  for (;;) {
    if (existsSync(join(atual, ".git"))) return true;
    const acima = dirname(atual);
    if (acima === atual) return false;
    atual = acima;
  }
}

const CAMPOS_PROTEGIDOS = {
  id: true, name: true, categoryId: true, dreCategoryId: true, controlsStock: true, inventorySectorId: true,
  unit: true, unitMeasureId: true, isActive: true, nature: true
} as const;

const ordenado = (produtos: Array<Record<string, unknown>>) =>
  JSON.stringify([...produtos].sort((a, b) => String(a.id).localeCompare(String(b.id))));

type Planejado = {
  atribuir: Array<{ productId: string; categoryId: string; name: string | null; antes?: string | null }>;
  criar: Array<{ categoryId: string; name: string }>;
};
type Atribuido = { productId: string; subcategoryId: string | null; /** subcategoria anterior (nula se não tinha; ausente em arquivos antigos) */ antes?: string | null };
type Reversao = { criadoEm: string; planejado: Planejado; atribuidos: Atribuido[]; criadas: string[] };

function mostrarBanco() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://?");
  console.log(`Banco: ${url.hostname}${url.pathname}`);
}

function lerPlanilha(arquivo: string): LinhaDeSubcategoria[] {
  const linhas = lerCsv(readFileSync(arquivo, "utf8"));
  if (linhas.length === 0) throw new Error("A planilha está vazia.");
  const [cabecalho, ...dados] = linhas;
  const coluna = (nome: string) => cabecalho.findIndex((c) => c.trim().toLowerCase() === nome);
  const iCodigo = coluna("codigo");
  const iSub = coluna("subcategoria proposta");
  const iCategoria = coluna("categoria atual");
  const iSubAtual = coluna("subcategoria atual");
  const iAcao = coluna("acao");
  if (iCodigo < 0 || iSub < 0) throw new Error('A planilha precisa das colunas "codigo" e "subcategoria proposta" (salve como CSV com ponto e vírgula).');
  return dados
    .filter((linha) => linha.length > Math.max(iCodigo, iSub))
    .map((linha) => ({
      codigo: linha[iCodigo],
      subcategoria: linha[iSub],
      categoria: iCategoria >= 0 ? linha[iCategoria] : undefined,
      subcategoriaAtual: iSubAtual >= 0 ? linha[iSubAtual] : undefined,
      acao: iAcao >= 0 ? linha[iAcao] : undefined
    }));
}

async function aplicar(arquivo: string, saida: string | null, gravar: boolean, trocar: boolean) {
  if (gravar && !saida) throw new Error("Com --aplicar é obrigatório --saida <pasta> para o arquivo de reversão.");
  if (saida && dentroDeRepositorio(saida)) throw new Error(`A pasta de saída (${saida}) está dentro de um repositório git. Use uma pasta fora dele.`);
  if (dentroDeRepositorio(resolve(arquivo))) throw new Error("A planilha tem nomes reais de produtos e não pode estar dentro de um repositório git.");
  mostrarBanco();
  if (trocar) console.log("Modo TROCAR: troca a subcategoria atual quando a planilha a confirma.");

  const linhas = lerPlanilha(arquivo);
  const produtos = await prisma.product.findMany({
    select: { id: true, externalCode: true, categoryId: true, subcategoryId: true, category: { select: { name: true } }, subcategory: { select: { name: true } } }
  });
  const existentes = await prisma.subcategory.findMany({ select: { id: true, name: true, categoryId: true, isActive: true } });
  const plano = planejarSubcategorias(
    linhas,
    produtos.map((p) => ({
      id: p.id,
      externalCode: p.externalCode,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      subcategoryId: p.subcategoryId,
      subcategoryName: p.subcategory?.name ?? null
    })),
    existentes,
    { trocar }
  );

  const esvaziar = plano.atribuir.filter((a) => a.name === null).length;
  console.log(`Produtos a mudar: ${plano.atribuir.length} (a esvaziar: ${esvaziar}) | subcategorias a criar: ${plano.criar.length} | ignoradas: ${plano.ignorados.length}`);
  for (const nova of plano.criar) console.log(`  criar: ${nova.categoryName} > ${nova.name}`);
  for (const ignorado of plano.ignorados.slice(0, 20)) console.log(`  ignorado ${ignorado.codigo}: ${ignorado.motivo}`);
  if (!gravar) {
    console.log("\nSIMULAÇÃO: nada foi gravado. Use --aplicar para gravar.");
    return;
  }
  if (plano.atribuir.length === 0) {
    console.log("Nada a fazer.");
    return;
  }

  const pasta = saida as string;
  mkdirSync(pasta, { recursive: true });
  const arquivoDeReversao = join(pasta, `reversao-subcategorias-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const reversao: Reversao = {
    criadoEm: new Date().toISOString(),
    planejado: {
      atribuir: plano.atribuir.map((a) => ({ productId: a.productId, categoryId: a.categoryId, name: a.name, antes: a.antesId })),
      criar: plano.criar.map((c) => ({ categoryId: c.categoryId, name: c.name }))
    },
    atribuidos: [],
    criadas: []
  };
  writeFileSync(arquivoDeReversao, JSON.stringify(reversao, null, 2), "utf8");

  const ids = plano.atribuir.map((a) => a.productId);
  await prisma.$transaction(
    async (tx) => {
      const antes = ordenado(await tx.product.findMany({ where: { id: { in: ids } }, select: CAMPOS_PROTEGIDOS }));
      const idPorChave = new Map(existentes.map((s) => [chaveDaSubcategoria(s.categoryId, s.name), s.id]));
      for (const nova of plano.criar) {
        const criada = await tx.subcategory.create({ data: { name: nova.name, categoryId: nova.categoryId } });
        idPorChave.set(chaveDaSubcategoria(nova.categoryId, nova.name), criada.id);
        reversao.criadas.push(criada.id);
      }
      const grupos = new Map<string, { categoryId: string; antes: string | null; novo: string | null; ids: string[] }>();
      for (const item of plano.atribuir) {
        const novo = item.chave === null ? null : (idPorChave.get(item.chave) ?? null);
        if (item.chave !== null && novo === null) throw new Error(`Subcategoria "${item.name}" não encontrada para o produto ${item.codigo}.`);
        const chave = `${item.categoryId}|${item.antesId ?? ""}|${novo ?? ""}`;
        const grupo = grupos.get(chave) ?? { categoryId: item.categoryId, antes: item.antesId, novo, ids: [] };
        grupo.ids.push(item.productId);
        grupos.set(chave, grupo);
      }
      for (const grupo of grupos.values()) {
        const r = await tx.product.updateMany({
          where: { id: { in: grupo.ids }, subcategoryId: grupo.antes, categoryId: grupo.categoryId },
          data: { subcategoryId: grupo.novo }
        });
        if (r.count !== grupo.ids.length) throw new Error("Algum produto mudou desde a leitura: nada foi gravado. Rode a simulação de novo.");
        for (const id of grupo.ids) reversao.atribuidos.push({ productId: id, subcategoryId: grupo.novo, antes: grupo.antes });
      }
      const depois = ordenado(await tx.product.findMany({ where: { id: { in: ids } }, select: CAMPOS_PROTEGIDOS }));
      if (depois !== antes) throw new Error("Um campo protegido (categoria, DRE, estoque, setor, natureza, unidade, nome ou situação) mudou: nada foi gravado.");
    },
    { timeout: 120000, maxWait: 30000 }
  );

  writeFileSync(arquivoDeReversao, JSON.stringify(reversao, null, 2), "utf8");
  console.log(`\nAPLICADO: ${ids.length} produtos. Reversão em ${arquivoDeReversao}`);
}

function lerReversao(arquivo: string): Reversao {
  const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<Reversao>;
  if (!bruto || !Array.isArray(bruto.atribuidos) || !Array.isArray(bruto.criadas) || !bruto.planejado) {
    throw new Error("Arquivo de reversão em formato inesperado.");
  }
  return bruto as Reversao;
}

async function reverter(arquivo: string, gravar: boolean) {
  mostrarBanco();
  const reversao = lerReversao(arquivo);

  // Se o processo caiu depois do commit e antes de completar o arquivo, `atribuidos` está vazio: o plano
  // gravado antes permite achar a subcategoria pelo nome dentro da categoria.
  let atribuidos = reversao.atribuidos;
  if (atribuidos.length === 0 && reversao.planejado.atribuir.length > 0) {
    const subcategorias = await prisma.subcategory.findMany({ select: { id: true, name: true, categoryId: true } });
    const porChave = new Map(subcategorias.map((s) => [chaveDaSubcategoria(s.categoryId, s.name), s.id]));
    atribuidos = reversao.planejado.atribuir.flatMap((a) => {
      if (a.name === null) return [{ productId: a.productId, subcategoryId: null, antes: a.antes ?? null }];
      const subcategoryId = porChave.get(chaveDaSubcategoria(a.categoryId, a.name));
      return subcategoryId ? [{ productId: a.productId, subcategoryId, antes: a.antes ?? null }] : [];
    });
  }
  console.log(`Produtos a devolver: ${atribuidos.length} | subcategorias criadas a remover (se vazias): ${reversao.criadas.length}`);
  if (!gravar) {
    console.log("\nSIMULAÇÃO: nada foi gravado. Use --aplicar para reverter.");
    return;
  }
  await prisma.$transaction(
    async (tx) => {
      // Só devolve quem ainda está como a aplicação deixou: produto editado depois fica como está.
      for (const item of atribuidos) {
        await tx.product.updateMany({ where: { id: item.productId, subcategoryId: item.subcategoryId }, data: { subcategoryId: item.antes ?? null } });
      }
      // deleteMany: rodar a reversão duas vezes, ou a subcategoria já ter sumido, não derruba a transação.
      for (const id of reversao.criadas) {
        await tx.subcategory.deleteMany({ where: { id, products: { none: {} } } });
      }
    },
    { timeout: 120000, maxWait: 30000 }
  );
  console.log("REVERTIDO.");
}

async function main() {
  const args = process.argv.slice(2);
  const valor = (nome: string) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : null);
  const gravar = args.includes("--aplicar");
  const reversao = valor("--reverter");
  if (reversao) return reverter(resolve(reversao), gravar);
  const arquivo = args.find((a) => !a.startsWith("--") && a !== valor("--saida"));
  if (!arquivo) throw new Error("Informe a planilha (.csv) ou --reverter <reversao.json>.");
  const saida = valor("--saida");
  return aplicar(resolve(arquivo), saida ? resolve(saida) : null, gravar, args.includes("--trocar"));
}

main()
  .catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
