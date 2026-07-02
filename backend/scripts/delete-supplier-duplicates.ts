/**
 * Uso: npx tsx scripts/delete-supplier-duplicates.ts --confirm
 *
 * Sem --confirm: dry-run (só lista o que seria feito).
 * Com --confirm: executa DELETE.
 *
 * Só apaga registros que casem TODOS os critérios:
 *   - IDs constam na lista TARGET_IDS abaixo
 *   - purchases + purchase orders + billing cycles = 0
 *
 * Se algum ID falhar a checagem de refs, o script aborta sem apagar nada.
 * Ajuste a lista TARGET_IDS conforme o output de scripts/list-duplicate-supplier-names.ts.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmqsollu90020yavnfy8y6v03", // code 25201 (GIV ONLINE... duplicata)
  "cmqsollv30028yavn2s65adfl"  // code 25213 (FEIRA - RICAO... duplicata)
];

async function run() {
  const confirmed = process.argv.includes("--confirm");

  for (const id of TARGET_IDS) {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, externalCode: true, name: true }
    });
    if (!supplier) {
      console.log(`[skip] id=${id} não existe.`);
      continue;
    }
    const [purchases, orders, cycles] = await Promise.all([
      prisma.purchase.count({ where: { supplierId: id } }),
      prisma.purchaseOrder.count({ where: { supplierId: id } }),
      prisma.supplierBillingCycle.count({ where: { supplierId: id } })
    ]);
    const total = purchases + orders + cycles;
    if (total > 0) {
      console.error(
        `[ABORT] id=${id} code=${supplier.externalCode} "${supplier.name}" tem ${total} refs vinculados. Abortando SEM apagar nada.`
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[ok] id=${id} code=${supplier.externalCode} "${supplier.name}" tem 0 refs — ${confirmed ? "DELETANDO" : "seria deletado"}.`
    );
  }

  if (!confirmed) {
    console.log("\nDry-run apenas. Rode com --confirm para executar.");
    return;
  }

  for (const id of TARGET_IDS) {
    await prisma.supplier.delete({ where: { id } });
    console.log(`  DELETED id=${id}`);
  }
  console.log("\nConcluído.");
}

run()
  .catch((e) => { console.error(e); process.exitCode = 2; })
  .finally(() => prisma.$disconnect());
