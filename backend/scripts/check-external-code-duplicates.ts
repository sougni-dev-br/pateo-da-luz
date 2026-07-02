import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type DuplicateRow = { externalCode: string; count: bigint };

async function check(entity: "Supplier" | "Product") {
  const table = entity === "Supplier" ? '"Supplier"' : '"Product"';
  const rows = await prisma.$queryRawUnsafe<DuplicateRow[]>(
    `SELECT "externalCode", COUNT(*)::bigint AS count
       FROM ${table}
      WHERE "externalCode" IS NOT NULL AND "externalCode" <> ''
      GROUP BY "externalCode"
      HAVING COUNT(*) > 1
      ORDER BY count DESC, "externalCode" ASC`
  );

  if (rows.length === 0) {
    console.log(`[OK] ${entity}: nenhuma duplicata em externalCode.`);
    return { entity, duplicates: [] as DuplicateRow[] };
  }

  console.log(`[FALHA] ${entity}: ${rows.length} externalCode(s) duplicado(s):`);
  for (const row of rows) {
    console.log(`  - "${row.externalCode}" aparece ${row.count} vezes`);
  }
  return { entity, duplicates: rows };
}

async function main() {
  console.log("=== Checagem de duplicatas em externalCode ===\n");
  const [suppliers, products] = await Promise.all([check("Supplier"), check("Product")]);
  const total = suppliers.duplicates.length + products.duplicates.length;
  if (total > 0) {
    console.log(`\n[ATENCAO] ${total} conflito(s) precisam ser resolvidos ANTES de criar o indice unico.`);
    process.exitCode = 1;
    return;
  }
  console.log("\n[SUCESSO] Seguro criar UNIQUE parcial em Supplier.externalCode e Product.externalCode.");
}

main()
  .catch((error) => {
    console.error("[ERRO] Falha ao checar duplicatas:", error);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
