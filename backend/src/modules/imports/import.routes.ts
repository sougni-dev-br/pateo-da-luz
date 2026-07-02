import { Router } from "express";
import multer from "multer";
import {
  confirmProductCatalogImport,
  confirmSupplierCatalogImport,
  previewProductCatalog,
  previewSupplierCatalog,
  undoCatalogImportBatch
} from "./catalog-import.service.js";
import { previewPurchaseSpreadsheet } from "./excel-preview.service.js";
import { confirmPurchaseImport, deleteImportBatch } from "./purchase-import.service.js";
import { requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import { prisma } from "../../config/database.js";

const upload = multer({ dest: "uploads/" });

export const importRouter = Router();

function isTruthyOption(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1 || value === "on";
}

function importErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("already exists")
    || message.includes("duplicate key")
    || message.includes("23505")
    || message.includes("importFileId")
  ) {
    return "Este arquivo ja possui uma previa/importacao registrada. Gere uma nova previa ou desfaça o lote anterior antes de importar novamente.";
  }
  return message || fallback;
}

importRouter.get("/history", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      a."id",
      a."action" AS "type",
      a."entity",
      a."entityId",
      a."createdAt",
      a."userId",
      u."name" AS "userName",
      u."email" AS "userEmail",
      COALESCE(a."entityId", a."newValue"->>'importBatchId', a."newValue"->>'importFileId') AS "importId",
      COALESCE(a."newValue"->>'originalFileName', a."newValue"->>'sheetName', a."newValue"->>'type', '-') AS "fileName",
      COALESCE(a."newValue"->>'totalRows', a."newValue"->>'spreadsheetTotal', a."newValue"->>'importedRows', '0') AS "totalRows",
      COALESCE(a."newValue"->>'importedRows', a."newValue"->>'createdRows', a."newValue"->>'updatedRows', '0') AS "importedRows",
      CASE
        WHEN a."action" LIKE 'UNDO_%' THEN 'DESFEITO'
        WHEN a."action" = 'IMPORT_REVENUE_EXCEL' AND EXISTS (
          SELECT 1
          FROM "RevenueImportBatch" rib
          WHERE rib."id" = a."entityId"
        ) THEN 'CONCLUIDO'
        WHEN a."action" = 'IMPORT_REVENUE_EXCEL' THEN 'DESFEITO'
        WHEN a."action" LIKE 'IMPORT_%' THEN 'CONCLUIDO'
        ELSE 'REGISTRADO'
      END AS "status",
      CASE
        WHEN a."action" = 'IMPORT_REVENUE_EXCEL' AND EXISTS (
          SELECT 1
          FROM "RevenueImportBatch" rib
          WHERE rib."id" = a."entityId"
        ) THEN true
        ELSE false
      END AS "undoAvailable"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE a."action" LIKE 'IMPORT_%' OR a."action" LIKE 'UNDO_%'
    ORDER BY a."createdAt" DESC
    LIMIT 200
  `;

  response.json(rows);
});

importRouter.post("/purchases/preview", upload.single("file"), async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  if (!request.file) {
    response.status(400).json({ message: "Arquivo nao enviado." });
    return;
  }

  try {
    response.json(
      await previewPurchaseSpreadsheet(request.file.path, request.file.originalname, {
        historicalMode: isTruthyOption(request.body.historicalMode),
        ignoreRowsWithoutProduct: isTruthyOption(request.body.ignoreRowsWithoutProduct)
      })
    );
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao processar planilha."
    });
  }
});

importRouter.post("/purchases/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const importFileId = String(request.body.importFileId ?? "").trim();
  const originalFileName = request.body.originalFileName
    ? String(request.body.originalFileName)
    : null;

  if (!importFileId) {
    response.status(400).json({ message: "importFileId nao informado." });
    return;
  }

  try {
    response.json(
      await confirmPurchaseImport(importFileId, originalFileName, {
        historicalMode: isTruthyOption(request.body.historicalMode),
        ignoreRowsWithoutProduct: isTruthyOption(request.body.ignoreRowsWithoutProduct),
        authorizedByUserId: user.id,
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      })
    );
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao confirmar importacao."
    });
  }
});

importRouter.delete("/purchases/:importBatchId", async (request, response) => {
  try {
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    response.json(await deleteImportBatch(request.params.importBatchId));
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao excluir importacao."
    });
  }
});

importRouter.post("/suppliers/preview", upload.single("file"), async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  if (!request.file) {
    response.status(400).json({ message: "Arquivo nao enviado." });
    return;
  }

  try {
    response.json(
      await previewSupplierCatalog(
        request.file.path,
        request.file.originalname,
        request.body.sheetName ? String(request.body.sheetName) : null
      )
    );
  } catch (error) {
    response.status(400).json({
      message: importErrorMessage(error, "Erro ao processar cadastro de fornecedores.")
    });
  }
});

importRouter.post("/suppliers/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const importFileId = String(request.body.importFileId ?? "").trim();
  if (!importFileId) {
    response.status(400).json({ message: "importFileId nao informado." });
    return;
  }

  try {
    response.json(
      await confirmSupplierCatalogImport(
        importFileId,
        request.body.originalFileName ? String(request.body.originalFileName) : null,
        request.body.sheetName ? String(request.body.sheetName) : null
      )
    );
  } catch (error) {
    response.status(400).json({
      message: importErrorMessage(error, "Erro ao confirmar cadastro de fornecedores.")
    });
  }
});

importRouter.post("/products/preview", upload.single("file"), async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  if (!request.file) {
    response.status(400).json({ message: "Arquivo nao enviado." });
    return;
  }

  try {
    response.json(
      await previewProductCatalog(
        request.file.path,
        request.file.originalname,
        request.body.sheetName ? String(request.body.sheetName) : null
      )
    );
  } catch (error) {
    response.status(400).json({
      message: importErrorMessage(error, "Erro ao processar cadastro de produtos.")
    });
  }
});

importRouter.post("/products/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const importFileId = String(request.body.importFileId ?? "").trim();
  if (!importFileId) {
    response.status(400).json({ message: "importFileId nao informado." });
    return;
  }

  try {
    response.json(
      await confirmProductCatalogImport(
        importFileId,
        request.body.originalFileName ? String(request.body.originalFileName) : null,
        request.body.sheetName ? String(request.body.sheetName) : null
      )
    );
  } catch (error) {
    response.status(400).json({
      message: importErrorMessage(error, "Erro ao confirmar cadastro de produtos.")
    });
  }
});

importRouter.delete("/catalog/:importBatchId", async (request, response) => {
  try {
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    response.json(await undoCatalogImportBatch(request.params.importBatchId));
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao desfazer importacao de cadastro."
    });
  }
});
