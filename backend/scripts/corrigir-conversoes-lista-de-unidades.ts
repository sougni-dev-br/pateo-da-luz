// Corrige as conversoes gravadas com uma LISTA no lugar da unidade ("PCT, CX, FD" nos dois
// campos) e refaz as compras que ficaram sem conversao por causa delas.
//
// Padrao: SIMULACAO (nao escreve nada). Para gravar: --aplicar.
// Rode sempre com TZ=UTC e confira o host impresso na primeira linha antes de --aplicar:
//   TZ=UTC DATABASE_URL=... npx tsx scripts/corrigir-conversoes-lista-de-unidades.ts
//   TZ=UTC DATABASE_URL=... npx tsx scripts/corrigir-conversoes-lista-de-unidades.ts --aplicar
//
// So corrige o que esta na tabela CORRECAO (codigo do produto -> fator esperado): se o fator
// gravado for outro, o produto fica de fora e aparece no relatorio. totalPrice nunca muda.
// Compra em periodo travado ou CMV fechado nao e refeita (assertPeriodWritableForDate).

import { prisma } from "../src/config/database.js";
import { gravarConversaoDoItemDeCompra } from "../src/modules/inventory/inventory.routes.js";
import { assertPeriodWritableForDate } from "../src/modules/cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../src/modules/cmv-real/period-locked-error.js";

const CORRECAO: Record<string, { fromUnit: string; toUnit: string; factor: number }> = {
  "304": { fromUnit: "CX", toUnit: "UN", factor: 12 },
  "305": { fromUnit: "CX", toUnit: "UN", factor: 12 },
  "462": { fromUnit: "CX", toUnit: "UN", factor: 6 },
  "743": { fromUnit: "CX", toUnit: "UN", factor: 6 },
  "761": { fromUnit: "CX", toUnit: "UN", factor: 6 }
};

const aplicar = process.argv.includes("--aplicar");
const url = new URL(process.env.DATABASE_URL ?? "postgresql://indefinido/");
console.log(`HOST: ${url.host}${url.pathname}  modo: ${aplicar ? "APLICAR (escreve)" : "simulacao (nao escreve)"}`);

type Conversao = { id: string; productId: string; codigo: string | null; nome: string; fromUnit: string; toUnit: string; factor: number };
const quebradas = await prisma.$queryRaw<Conversao[]>`
  SELECT c."id", c."productId", pr."externalCode" AS codigo, pr."name" AS nome, c."fromUnit", c."toUnit", c."factor"::float8 AS factor
  FROM "ProductUnitConversion" c JOIN "Product" pr ON pr."id" = c."productId"
  WHERE c."fromUnit" ~ '[\s,;]' OR c."toUnit" ~ '[\s,;]'
  ORDER BY pr."externalCode"
`;
console.log(`Conversoes com lista no lugar da unidade: ${quebradas.length}`);

let corrigidas = 0;
let refeitas = 0;
let travadas = 0;
for (const c of quebradas) {
  const certa = c.codigo ? CORRECAO[c.codigo] : undefined;
  if (!certa || certa.factor !== c.factor) {
    console.log(`  PULADA  ${c.codigo} ${c.nome}: ${c.fromUnit} -> ${c.toUnit} x${c.factor} (fora da tabela ou fator diferente do esperado)`);
    continue;
  }
  const jaExiste = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ProductUnitConversion" WHERE "productId" = ${c.productId} AND "fromUnit" = ${certa.fromUnit} AND "toUnit" = ${certa.toUnit}
  `;
  if (jaExiste.length) {
    console.log(`  PULADA  ${c.codigo} ${c.nome}: ja existe ${certa.fromUnit} -> ${certa.toUnit}; apague a linha quebrada pela tela`);
    continue;
  }
  const itens = await prisma.$queryRaw<Array<{ id: string; quantity: unknown; unit: string | null; totalPrice: unknown; data: Date }>>`
    SELECT pi."id", pi."quantity", pi."unit", pi."totalPrice", COALESCE(p."receivedAt", p."purchaseDate") AS data
    FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchaseId"
    WHERE pi."productId" = ${c.productId} AND p."status" = 'ACTIVE' AND pi."conversionMissing" = true
      AND UPPER(BTRIM(pi."unit")) IN ('CX', 'CAIXA')
  `;
  console.log(`  CORRIGE ${c.codigo} ${c.nome}: "${c.fromUnit}" -> ${certa.fromUnit}/${certa.toUnit} x${certa.factor}; compras sem conversao a refazer: ${itens.length}`);
  corrigidas++;
  if (!aplicar) continue;

  await prisma.$executeRaw`UPDATE "ProductUnitConversion" SET "fromUnit" = ${certa.fromUnit}, "toUnit" = ${certa.toUnit}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${c.id}`;
  for (const item of itens) {
    try {
      await assertPeriodWritableForDate(item.data, "Correcao de conversao");
    } catch (error) {
      if (!(error instanceof PeriodLockedError)) throw error;
      travadas++;
      console.log(`    periodo fechado: compra ${item.id} fica como esta`);
      continue;
    }
    const gravado = await gravarConversaoDoItemDeCompra({
      productId: c.productId, purchaseItemId: item.id, quantity: Number(item.quantity), unit: item.unit, totalCost: Number(item.totalPrice)
    });
    if (gravado && !gravado.conversao.conversionMissing) refeitas++;
  }
}

console.log(`Resumo: ${corrigidas} conversoes ${aplicar ? "corrigidas" : "a corrigir"}; compras refeitas: ${refeitas}; em periodo fechado: ${travadas}.`);
if (!aplicar) console.log("Nada foi gravado. Para gravar, rode de novo com --aplicar.");
process.exit(0);
