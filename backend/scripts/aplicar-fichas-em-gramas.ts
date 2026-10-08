/**
 * Refaz as fichas técnicas em g/ml — SÓ as conversões exatas (decisão "MUDA" do relatório).
 *
 * Sem `--aplicar` é somente leitura (mostra o que faria). Com `--aplicar`, em UMA transação:
 *   1. confere, item a item, que a quantidade/unidade no banco ainda é a que o plano viu;
 *   2. troca quantidade e unidade (kg→g, l→ml, UN→g/ml pela conversão do produto);
 *   3. recalcula o custo de cada ficha com o mesmo cálculo da tela e compara com o de antes;
 *      qualquer ficha que mude acima da tolerância faz a transação inteira DESFAZER.
 * Ingredientes PENDENTE (sem conversão) e CONFERIR ficam como estão. Antes de gravar, o plano
 * (valores de antes) é salvo em arquivo local, para ser possível desfazer à mão.
 *
 *   TZ=UTC DATABASE_URL="postgresql://..." npx tsx scripts/aplicar-fichas-em-gramas.ts [--desde=AAAA-MM-DD] [--aplicar]
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { lerPlano, moeda, type Linha } from "./fichas-gramas-plano.js";
import { normalizarUnidade } from "../src/shared/unidades/conversao.js";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, ...resto] = a.replace(/^--/, "").split("=");
    return [chave, resto.length ? resto.join("=") : "true"];
  })
);

/** Custo total da ficha pode oscilar só pelo arredondamento da quantidade em 4 casas. */
const TOLERANCIA_POR_FICHA = 0.001;

const somaPorFicha = (linhas: Linha[], campo: "custoHoje" | "custoNovo") => {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.dishId, (mapa.get(l.dishId) ?? 0) + (l[campo] ?? 0));
  return mapa;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Defina DATABASE_URL. Nada foi lido.");
    process.exit(1);
  }
  const aplicar = argumentos.aplicar === "true";
  const desde = argumentos.desde ? new Date(`${argumentos.desde}T00:00:00.000Z`) : null;
  if (desde && Number.isNaN(desde.getTime())) {
    console.error(`--desde inválido: ${argumentos.desde}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const { linhas } = await lerPlano(prisma, desde);
  const mudancas = linhas.filter((l) => l.decisao === "MUDA");
  const deixadas = linhas.filter((l) => l.decisao === "PENDENTE" || l.decisao === "CONFERIR");

  console.log(aplicar ? "MODO APLICAR — vai gravar em uma transação." : "SIMULAÇÃO — nada será gravado (use --aplicar).");
  console.log(`Ingredientes a converter: ${mudancas.length} · ficam como estão (pendentes/conferir): ${deixadas.length}`);
  if (mudancas.length === 0) {
    await prisma.$disconnect();
    return;
  }

  if (!aplicar) {
    for (const l of mudancas) {
      console.log(`  ${l.prato} · ${l.produto}: ${l.quantidadeHoje} ${l.unidadeHoje} → ${l.quantidadeNova} ${l.unidadeNova}  (${moeda(l.custoHoje)} → ${moeda(l.custoNovo)})`);
    }
    await prisma.$disconnect();
    return;
  }

  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivoDeAntes = `fichas-gramas-antes-${carimbo}.json`;
  fs.writeFileSync(arquivoDeAntes, JSON.stringify(mudancas, null, 2), "utf8");
  console.log(`Plano com os valores de ANTES salvo em ${arquivoDeAntes}`);

  const antesPorFicha = somaPorFicha(linhas, "custoHoje");

  await prisma.$transaction(
    async (tx) => {
      for (const l of mudancas) {
        const atual = await tx.dishItem.findUnique({ where: { id: l.itemId }, select: { quantity: true, unit: true, dishId: true } });
        if (!atual || atual.dishId !== l.dishId) throw new Error(`Item ${l.itemId} (${l.produto}) sumiu ou mudou de ficha; nada foi gravado.`);
        if (Number(atual.quantity) !== l.quantidadeHoje || normalizarUnidade(atual.unit) !== l.unidadeHoje) {
          throw new Error(`Item ${l.itemId} (${l.produto} em ${l.prato}) foi alterado depois do plano: agora ${atual.quantity} ${atual.unit}. Gere o plano de novo; nada foi gravado.`);
        }
        await tx.dishItem.update({ where: { id: l.itemId }, data: { quantity: l.quantidadeNova!, unit: l.unidadeNova! } });
      }

      // Recalcula tudo dentro da própria transação e compara ficha a ficha.
      const { linhas: depois } = await lerPlano(tx as unknown as PrismaClient, desde);
      const depoisPorFicha = somaPorFicha(depois, "custoHoje");
      for (const [dishId, custoAntes] of antesPorFicha) {
        const custoDepois = depoisPorFicha.get(dishId) ?? 0;
        const diferenca = custoAntes > 0 ? Math.abs(custoDepois - custoAntes) / custoAntes : Math.abs(custoDepois - custoAntes);
        if (diferenca > TOLERANCIA_POR_FICHA) {
          const nome = linhas.find((l) => l.dishId === dishId)?.prato ?? dishId;
          throw new Error(`Custo da ficha "${nome}" mudaria ${(diferenca * 100).toFixed(3)}% (${moeda(custoAntes)} → ${moeda(custoDepois)}). Transação desfeita; nada foi gravado.`);
        }
      }
      const aindaMudam = depois.filter((l) => l.decisao === "MUDA").length;
      if (aindaMudam > 0) throw new Error(`${aindaMudam} ingredientes ainda aparecem para converter depois da troca; transação desfeita.`);
    },
    { timeout: 120_000, maxWait: 30_000 }
  );

  const fichas = new Set(mudancas.map((l) => l.dishId)).size;
  console.log(`\nOK: ${mudancas.length} ingredientes em ${fichas} fichas convertidos para g/ml; custo de cada ficha conferido dentro de ${(TOLERANCIA_POR_FICHA * 100).toFixed(1)}%.`);
  if (deixadas.length > 0) {
    console.log("Ficaram como estavam (precisam de \"1 unidade = ? g\" no produto):");
    for (const l of deixadas) console.log(`  - ${l.prato} · ${l.produto}: ${l.quantidadeHoje} ${l.unidadeHoje}`);
  }
  await prisma.$disconnect();
}

main().catch((erro) => {
  console.error(`\nERRO: ${erro instanceof Error ? erro.message : erro}`);
  process.exit(1);
});
