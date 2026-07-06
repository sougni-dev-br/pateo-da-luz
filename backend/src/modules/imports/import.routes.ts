import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import {
  readFirstWorksheetRows,
  readWorkbookSheetNames
} from "./excel-reader.service.js";
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
const PURCHASE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const purchasePreviewUpload = multer({
  dest: "uploads/",
  limits: { fileSize: PURCHASE_UPLOAD_MAX_BYTES }
}).single("file");

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

type UploadHandler = (request: Request, response: Response, callback: (error?: unknown) => void) => void;

function runUpload(
  handler: UploadHandler,
  request: Request,
  response: Response
) {
  return new Promise<void>((resolve, reject) => {
    handler(request, response, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function collectPurchasePreviewDiagnostics(filePath: string) {
  try {
    const [sheetNames, preview] = await Promise.all([
      readWorkbookSheetNames(filePath).catch(() => []),
      readFirstWorksheetRows(filePath).catch(() => ({ sheetName: null, rows: [] as Record<string, unknown>[] }))
    ]);
    const headerSample = preview.rows[0]
      ? Object.keys(preview.rows[0]).filter((header) => header !== "__rowNumber").slice(0, 20)
      : [];

    return {
      sheetName: preview.sheetName ?? null,
      sheetNames,
      headerSample
    };
  } catch {
    return null;
  }
}

function classifyPurchasePreviewError(error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return {
        status: 400,
        message: `Arquivo muito grande para preview. Limite: ${Math.round(PURCHASE_UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`
      };
    }
    return {
      status: 400,
      message: "Falha ao receber o arquivo enviado para preview."
    };
  }

  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  const knownInputError =
    normalized.includes("zip file")
    || normalized.includes("worksheet")
    || normalized.includes("workbook")
    || normalized.includes("sheet")
    || normalized.includes("planilha")
    || normalized.includes("coluna")
    || normalized.includes("arquivo");

  if (knownInputError) {
    return {
      status: 400,
      message: normalized.includes("zip file")
        ? "Arquivo Excel invalido ou formato nao suportado. Se a planilha estiver em .xls, salve como .xlsx e tente novamente."
        : message || "Nao foi possivel interpretar a planilha enviada."
    };
  }

  return {
    status: 500,
    message: "Erro interno ao gerar preview da planilha."
  };
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

importRouter.post("/purchases/preview", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  try {
    await runUpload(purchasePreviewUpload, request, response);

    if (!request.file) {
      response.status(400).json({ message: "Arquivo nao enviado." });
      return;
    }

    console.info("[imports:purchases:preview:start]", {
      fileName: request.file.originalname,
      sizeBytes: request.file.size,
      historicalMode: isTruthyOption(request.body.historicalMode),
      ignoreRowsWithoutProduct: isTruthyOption(request.body.ignoreRowsWithoutProduct)
    });

    const preview = await previewPurchaseSpreadsheet(request.file.path, request.file.originalname, {
      historicalMode: isTruthyOption(request.body.historicalMode),
      ignoreRowsWithoutProduct: isTruthyOption(request.body.ignoreRowsWithoutProduct)
    });

    console.info("[imports:purchases:preview:success]", {
      fileName: request.file.originalname,
      sizeBytes: request.file.size,
      sheetName: preview.sheetName,
      totalRows: preview.totalRows,
      detectedColumns: Object.keys(preview.detectedColumns),
      previewWarnings: preview.warnings.length,
      conflictsFound: preview.conflictSummary.conflictsFound
    });

    response.json(preview);
  } catch (error) {
    const diagnostics = request.file?.path
      ? await collectPurchasePreviewDiagnostics(request.file.path)
      : null;
    const classified = classifyPurchasePreviewError(error);
    console.error("[imports:purchases:preview:error]", {
      fileName: request.file?.originalname ?? null,
      sizeBytes: request.file?.size ?? null,
      previewStage: error instanceof Error ? (error as Error & { previewStage?: string }).previewStage ?? null : null,
      diagnostics,
      error: error instanceof Error ? error.message : error
    });
    response.status(classified.status).json({
      message: classified.message
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
        companyId: request.body.companyId ? String(request.body.companyId) : null,
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
