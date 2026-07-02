import { PrismaClient } from "@prisma/client";
import { normalizeText } from "../src/shared/utils/normalize-text.js";

const prisma = new PrismaClient();

type SupplierUsage = {
  id: string;
  externalCode: string | null;
  name: string;
  document: string | null;
  isActive: boolean;
  createdAt: Date;
  purchaseCount: number;
  purchaseOrderCount: number;
  billingCycleCount: number;
  totalRefs: number;
};

async function run() {
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, externalCode: true, name: true, document: true, isActive: true, createdAt: true }
  });

  const groups = new Map<string, typeof suppliers>();
  for (const s of suppliers) {
    const key = normalizeText(s.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const duplicated = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (duplicated.length === 0) {
    console.log("Nenhuma duplicata de nome encontrada.");
    return;
  }

  console.log(`Encontrei ${duplicated.length} grupo(s) de nomes duplicados (${suppliers.length} fornecedores no total):\n`);

  for (const [normalizedName, list] of duplicated) {
    console.log(`# "${normalizedName}" (${list.length} registros)`);
    const usages: SupplierUsage[] = [];
    for (const s of list) {
      const [purchaseCount, purchaseOrderCount, billingCycleCount] = await Promise.all([
        prisma.purchase.count({ where: { supplierId: s.id } }),
        prisma.purchaseOrder.count({ where: { supplierId: s.id } }),
        prisma.supplierBillingCycle.count({ where: { supplierId: s.id } })
      ]);
      usages.push({
        ...s,
        purchaseCount,
        purchaseOrderCount,
        billingCycleCount,
        totalRefs: purchaseCount + purchaseOrderCount + billingCycleCount
      });
    }
    usages.sort((a, b) => b.totalRefs - a.totalRefs || a.createdAt.getTime() - b.createdAt.getTime());

    for (let i = 0; i < usages.length; i++) {
      const u = usages[i];
      const marker = i === 0 ? "  KEEP?" : "  DROP?";
      console.log(
        `${marker} code=${u.externalCode ?? "(null)"} | id=${u.id} | active=${u.isActive} | doc=${u.document ?? "-"} | createdAt=${u.createdAt.toISOString().slice(0, 10)} | purchases=${u.purchaseCount} | orders=${u.purchaseOrderCount} | cycles=${u.billingCycleCount} | totalRefs=${u.totalRefs}`
      );
    }
    console.log();
  }

  console.log("Legenda:");
  console.log("  KEEP? = candidato a manter (mais refs vinculados; empate → mais antigo)");
  console.log("  DROP? = candidato a remover (revise ANTES de deletar)");
  console.log("Nenhuma alteração foi feita — script somente leitura.");
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
