// Refaz as compras marcadas "sem conversao" (conversionMissing) cujo produto JA tem a
// conversao cadastrada hoje. Cadastrar a conversao pela tela vale para as proximas notas;
// as linhas antigas ficam como estavam ate alguem reprocessa-las, e e isso que este script faz.
//
// Padrao: SIMULACAO (nao escreve nada). Para gravar: --aplicar.
// Rode sempre com TZ=UTC e confira o host impresso na primeira linha antes de --aplicar:
//   TZ=UTC DATABASE_URL=... npx tsx scripts/reprocessar-compras-sem-conversao.ts
//   TZ=UTC DATABASE_URL=... npx tsx scripts/reprocessar-compras-sem-conversao.ts --aplicar
//
// So toca linha cuja conversao ja existe (nao cria conversao nenhuma). Altera apenas as colunas
// convertedQuantity/convertedUnit/convertedUnitPrice/conversionFactorUsed/conversionMissing da
// linha; totalPrice e estoque nao mudam. Compra em periodo travado ou CMV fechado fica como esta
// (assertPeriodWritableForDate).

import { prisma } from "../src/config/database.js";
import { gravarConversaoDoItemDeCompra } from "../src/modules/inventory/inventory.routes.js";
import { assertPeriodWritableForDate } from "../src/modules/cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../src/modules/cmv-real/period-locked-error.js";
import { resolveUnitFactor } from "../src/shared/unidades/conversao.js";

const aplicar = process.argv.includes("--aplicar");
const url = new URL(process.env.DATABASE_URL ?? "postgresql://indefinido/");
console.log(`HOST: ${url.host}${url.pathname}  modo: ${aplicar ? "APLICAR (escreve)" : "simulacao (nao escreve)"}`);

type Linha = { id: string; productId: string; codigo: string | null; nome: string; contagem: string; quantity: unknown; unit: string | null; totalPrice: unknown; data: Date };
const linhas = await prisma.$queryRaw<Linha[]>`
  SELECT pi."id", pi."productId", pr."externalCode" AS codigo, pr."name" AS nome, COALESCE(pr."stockUnit", pr."unit") AS contagem,
         pi."quantity", pi."unit", pi."totalPrice", COALESCE(p."receivedAt", p."purchaseDate") AS data
  FROM "PurchaseItem" pi
  JOIN "Purchase" p ON p."id" = pi."purchaseId"
  JOIN "Product" pr ON pr."id" = pi."productId"
  WHERE p."status" = 'ACTIVE' AND pi."conversionMissing" = true AND pi."unit" IS NOT NULL
  ORDER BY pr."name", data
`;
console.log(`Linhas de compra sem conversao: ${linhas.length}`);

const conversoes = new Map<string, Array<{ fromUnit: string; toUnit: string; factor: number }>>();
let refeitas = 0;
let semConversao = 0;
let travadas = 0;
for (const l of linhas) {
  if (!conversoes.has(l.productId)) {
    const rows = await prisma.$queryRaw<Array<{ fromUnit: string; toUnit: string; factor: number }>>`
      SELECT "fromUnit", "toUnit", "factor"::float8 AS factor FROM "ProductUnitConversion" WHERE "productId" = ${l.productId} AND "isActive" = true
    `;
    conversoes.set(l.productId, rows);
  }
  const fator = resolveUnitFactor(l.unit, l.contagem, conversoes.get(l.productId) ?? []);
  if (fator == null) {
    semConversao++;
    console.log(`  SEM CONVERSAO  ${l.codigo} ${l.nome}: ${Number(l.quantity)} ${l.unit} (conta em ${l.contagem}); cadastre a conversao pela tela`);
    continue;
  }
  console.log(`  REFAZ  ${l.codigo} ${l.nome}: ${Number(l.quantity)} ${l.unit} x${fator} = ${Number(l.quantity) * fator} ${l.contagem} (R$ ${Number(l.totalPrice).toFixed(2)}, ${l.data.toISOString().slice(0, 10)})`);
  if (!aplicar) continue;
  try {
    await assertPeriodWritableForDate(l.data, "Reprocessamento de conversao");
  } catch (error) {
    if (!(error instanceof PeriodLockedError)) throw error;
    travadas++;
    console.log("    periodo fechado: a linha fica como esta");
    continue;
  }
  const gravado = await gravarConversaoDoItemDeCompra({
    productId: l.productId, purchaseItemId: l.id, quantity: Number(l.quantity), unit: l.unit, totalCost: Number(l.totalPrice)
  });
  if (gravado && !gravado.conversao.conversionMissing) refeitas++;
}

console.log(`Resumo: ${aplicar ? `refeitas ${refeitas}` : "a refazer " + (linhas.length - semConversao)}; sem conversao cadastrada: ${semConversao}; em periodo fechado: ${travadas}.`);
if (!aplicar) console.log("Nada foi gravado. Para gravar, rode de novo com --aplicar.");
process.exit(0);
