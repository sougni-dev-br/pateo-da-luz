/**
 * Backfill: cria StockCountSession para InventorySnapshot importados via planilha
 * que ainda não têm uma sessão correspondente (linkedSnapshotId).
 *
 * Uso:
 *   node scripts/backfill-import-count-sessions.mjs          # dry-run (sem gravar)
 *   node scripts/backfill-import-count-sessions.mjs --apply  # aplica no banco
 *
 * Idempotência: a chave de guarda é StockCountSession.linkedSnapshotId.
 * O script nunca insere se já existir uma session com linkedSnapshotId = snapshot.id.
 * Pode ser rodado N vezes sem criar duplicatas.
 *
 * Pré-requisitos: as migrations abaixo devem ter sido aplicadas no banco alvo:
 *   - 20260626180000_add_source_to_inventory_snapshot
 *   - 20260626190000_add_source_to_stock_count_session
 *   - 20260626200000_add_linked_snapshot_id_to_stock_count_session
 */

import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const shouldApply = process.argv.includes("--apply");

// ─── helpers ────────────────────────────────────────────────────────────────

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function nextCntCode(year, tx = prisma) {
  const [row] = await tx.$queryRaw`
    SELECT "code" FROM "StockCountSession"
    WHERE "code" LIKE ${`CNT-${year}-%`}
    ORDER BY "code" DESC
    LIMIT 1
  `;
  const current = Number(String(row?.code ?? "").split("-").pop() ?? 0);
  return `CNT-${year}-${String(current + 1).padStart(4, "0")}`;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Backfill: import StockCountSessions ===`);
  console.log(`Modo: ${shouldApply ? "APLICAR (--apply)" : "DRY-RUN (sem alterações)"}\n`);

  // 1. Encontrar todos os InventorySnapshot importados sem StockCountSession vinculada
  const orphanSnapshots = await prisma.$queryRaw`
    SELECT
      s."id",
      s."competenceYear",
      s."competenceMonth",
      s."type",
      s."countDate",
      s."originalFileName",
      s."source",
      s."isAutoLinkedInitial",
      s."notes",
      s."createdByUserId",
      s."status"
    FROM "InventorySnapshot" s
    WHERE
      s."isAutoLinkedInitial" = false
      AND s."status" <> 'CANCELLED'
      AND (
        s."source" = 'IMPORTACAO_PLANILHA'
        OR (
          s."originalFileName" IS NOT NULL
          AND (
            s."originalFileName" ILIKE '%.xlsx'
            OR s."originalFileName" ILIKE '%.xls'
            OR s."originalFileName" ILIKE '%.csv'
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "StockCountSession" cs
        WHERE cs."linkedSnapshotId" = s."id"
      )
    ORDER BY s."competenceYear" ASC, s."competenceMonth" ASC, s."countDate" ASC
  `;

  if (orphanSnapshots.length === 0) {
    console.log("Nenhum InventorySnapshot importado sem StockCountSession correspondente. Nada a fazer.");
    return;
  }

  console.log(`Encontrados ${orphanSnapshots.length} snapshot(s) sem StockCountSession:\n`);
  for (const snap of orphanSnapshots) {
    console.log(
      `  [${snap.source ?? "?"}] ${snap.competenceYear}-${String(snap.competenceMonth).padStart(2, "0")} ` +
      `| type=${snap.type} | countDate=${isoDate(snap.countDate)} ` +
      `| arquivo=${snap.originalFileName ?? "-"} ` +
      `| status=${snap.status} ` +
      `| id=${snap.id}`
    );
  }

  if (!shouldApply) {
    console.log(`\nDRY-RUN: nenhuma alteração foi gravada. Use --apply para aplicar.`);
    return;
  }

  // 2. Para cada snapshot orphan, criar StockCountSession + itens
  let created = 0;
  let failed = 0;

  for (const snap of orphanSnapshots) {
    try {
      // Buscar os itens do snapshot
      const items = await prisma.$queryRaw`
        SELECT
          "productId", "productCode", "productName",
          "sectorName", "categoryName", "subcategoryName",
          "unit", "quantity", "resolutionStatus"
        FROM "InventorySnapshotItem"
        WHERE "snapshotId" = ${snap.id}
        ORDER BY "sectorName", "productName"
      `;

      const countDate = new Date(snap.countDate);
      const year = countDate.getFullYear();

      const sessionNotes = [
        `Contagem importada via planilha${snap.originalFileName ? `: ${snap.originalFileName}` : ""}`,
        snap.notes?.trim() ? `Obs: ${snap.notes.trim()}` : null,
        `[Backfill retroativo — snapshot: ${snap.id}]`
      ].filter(Boolean).join(" — ");

      // Sem $transaction — Render usa PgBouncer em transaction mode que não suporta
      // interactive transactions. Idempotência garantida pelo WHERE NOT EXISTS acima
      // e pelo UNIQUE INDEX em linkedSnapshotId.
      const code = await nextCntCode(year);
      const sessionId = randomUUID();
      const isMonthEnd = snap.type === "INVENTARIO_FINAL";

      await prisma.$executeRaw`
        INSERT INTO "StockCountSession" (
          "id", "code", "type", "status", "referenceDate", "periodMonth", "periodYear",
          "isMonthEnd", "notes", "source", "linkedSnapshotId", "concludedAt", "updatedAt"
        )
        VALUES (
          ${sessionId}, ${code}, 'IMPORTACAO_PLANILHA', 'CONCLUIDA',
          ${countDate}, ${snap.competenceMonth}, ${snap.competenceYear},
          ${isMonthEnd}, ${sessionNotes}, 'IMPORTACAO_PLANILHA',
          ${snap.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;

      // Bulk INSERT — um único round-trip por snapshot (evita timeout em snapshots com 700+ itens)
      if (items.length > 0) {
        const BATCH = 200;
        for (let start = 0; start < items.length; start += BATCH) {
          const batch = items.slice(start, start + BATCH);
          const rows = batch.map((item) => {
            const qty = Number(item.quantity ?? 0);
            const itemStatus = qty === 0 ? "ZERO" : "CONTADO";
            return Prisma.sql`(
              ${randomUUID()}, ${sessionId}, ${item.productId ?? null},
              ${item.productCode ?? null}, ${item.productName},
              ${item.sectorName ?? null}, ${item.categoryName ?? null}, ${item.subcategoryName ?? null},
              ${item.unit ?? null}, 0, ${qty}, ${qty}, ${itemStatus}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`;
          });
          await prisma.$executeRaw`
            INSERT INTO "StockCountSessionItem" (
              "id", "stockCountSessionId", "productId", "productCodeSnapshot", "productNameSnapshot",
              "sectorSnapshot", "categorySnapshot", "subcategorySnapshot", "unitSnapshot",
              "expectedQuantity", "countedQuantity", "differenceQuantity", "status", "countedAt", "updatedAt"
            )
            VALUES ${Prisma.join(rows)}
          `;
        }
      }

      console.log(
        `  [OK] Criado ${code} (${sessionId}) para snapshot ${snap.id} ` +
        `— ${items.length} item(s) | ${snap.competenceYear}-${String(snap.competenceMonth).padStart(2, "0")}`
      );
      created++;
    } catch (err) {
      console.error(`  [ERRO] Snapshot ${snap.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nConcluído: ${created} session(s) criada(s), ${failed} erro(s).`);
  if (failed > 0) {
    console.warn("Revise os erros acima antes de re-executar.");
    process.exit(1);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
