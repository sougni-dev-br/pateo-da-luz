import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../../config/database.js";
import { deleteFromR2, getR2SignedUrl, r2Enabled, uploadToR2 } from "../../lib/storage.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { previewTaxImport } from "./tax-payment-import.service.js";

export const taxPaymentRouter = Router();

// ─── upload multer ────────────────────────────────────────────────────────────
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype.includes("spreadsheetml") ||
      file.mimetype.includes("excel") ||
      file.mimetype === "application/octet-stream" ||
      file.originalname.match(/\.(xlsx|xls)$/i) != null;
    cb(null, ok);
  },
});

const attachmentUpload = multer({
  dest: "uploads/attachments/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── helpers ──────────────────────────────────────────────────────────────────
function computeStatus(paymentDate: Date | null, dueDate: Date): string {
  if (paymentDate) return "PAID";
  if (dueDate < new Date()) return "OVERDUE";
  return "PENDING";
}

type TaxPaymentRow = {
  id: string;
  companyId: string | null;
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  documentType: string;
  description: string | null;
  competenceDate: Date | null;
  dueDate: Date;
  amount: string;
  paymentDate: Date | null;
  paidAmount: string | null;
  status: string;
  comments: string | null;
  source: string;
  importBatchId: string | null;
  dreCategoryId: string | null;
  dreCategoryName: string | null;
  createdById: string;
  updatedById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachmentCount: number;
};

// ─── GET /tax-payments ────────────────────────────────────────────────────────
taxPaymentRouter.get("/", async (request, response) => {
  const {
    companyId,
    cnpj,
    documentType,
    status,
    competenceStart,
    competenceEnd,
    dueStart,
    dueEnd,
    paymentStart,
    paymentEnd,
    search,
    hasAttachment,
    dreCategoryId,
    page = "1",
    pageSize = "50",
  } = request.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * size;

  const conditions: string[] = [`tp."deletedAt" IS NULL`];
  const params: unknown[] = [];

  function addParam(val: unknown) {
    params.push(val);
    return `$${params.length}`;
  }

  if (companyId) conditions.push(`tp."companyId" = ${addParam(companyId)}`);
  if (cnpj) conditions.push(`tp."cnpj" = ${addParam(cnpj.replace(/\D/g, ""))}`);
  if (documentType) conditions.push(`tp."documentType" ILIKE ${addParam(`%${documentType}%`)}`);
  if (dreCategoryId) conditions.push(`tp."dreCategoryId" = ${addParam(dreCategoryId)}`);

  if (status) {
    if (status === "OVERDUE") {
      conditions.push(`tp."paymentDate" IS NULL AND tp."dueDate" < NOW() AND tp."status" != 'CANCELED'`);
    } else {
      conditions.push(`tp."status" = ${addParam(status)}`);
    }
  }

  if (competenceStart) conditions.push(`tp."competenceDate" >= ${addParam(new Date(competenceStart))}`);
  if (competenceEnd) conditions.push(`tp."competenceDate" <= ${addParam(new Date(competenceEnd + "T23:59:59"))}`);
  if (dueStart) conditions.push(`tp."dueDate" >= ${addParam(new Date(dueStart))}`);
  if (dueEnd) conditions.push(`tp."dueDate" <= ${addParam(new Date(dueEnd + "T23:59:59"))}`);
  if (paymentStart) conditions.push(`tp."paymentDate" >= ${addParam(new Date(paymentStart))}`);
  if (paymentEnd) conditions.push(`tp."paymentDate" <= ${addParam(new Date(paymentEnd + "T23:59:59"))}`);

  if (search) {
    const like = addParam(`%${search}%`);
    conditions.push(`(tp."legalName" ILIKE ${like} OR tp."tradeName" ILIKE ${like} OR tp."description" ILIKE ${like} OR tp."cnpj" ILIKE ${like})`);
  }

  if (hasAttachment === "true") {
    conditions.push(`EXISTS (SELECT 1 FROM "TaxPaymentAttachment" a WHERE a."taxPaymentId" = tp.id)`);
  } else if (hasAttachment === "false") {
    conditions.push(`NOT EXISTS (SELECT 1 FROM "TaxPaymentAttachment" a WHERE a."taxPaymentId" = tp.id)`);
  }

  const where = conditions.join(" AND ");

  const [rows, countResult, summary] = await Promise.all([
    prisma.$queryRawUnsafe<TaxPaymentRow[]>(`
      SELECT
        tp.*,
        dc.name AS "dreCategoryName",
        (SELECT COUNT(*)::int FROM "TaxPaymentAttachment" a WHERE a."taxPaymentId" = tp.id) AS "attachmentCount"
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
      WHERE ${where}
      ORDER BY tp."dueDate" ASC, tp."createdAt" DESC
      LIMIT ${size} OFFSET ${offset}
    `, ...params),
    prisma.$queryRawUnsafe<[{ total: string }]>(`
      SELECT COUNT(*)::text AS total
      FROM "TaxPayment" tp
      WHERE ${where}
    `, ...params),
    prisma.$queryRawUnsafe<Array<{
      total: string;
      paid: string;
      pending: string;
      overdue: string;
      withoutReceipt: string;
    }>>(`
      SELECT
        COALESCE(SUM(tp.amount), 0)::text AS total,
        COALESCE(SUM(CASE WHEN tp."paymentDate" IS NOT NULL THEN tp.amount ELSE 0 END), 0)::text AS paid,
        COALESCE(SUM(CASE WHEN tp."paymentDate" IS NULL AND tp."dueDate" >= NOW() AND tp.status != 'CANCELED' THEN tp.amount ELSE 0 END), 0)::text AS pending,
        COALESCE(SUM(CASE WHEN tp."paymentDate" IS NULL AND tp."dueDate" < NOW() AND tp.status != 'CANCELED' THEN tp.amount ELSE 0 END), 0)::text AS overdue,
        COALESCE(SUM(CASE WHEN tp.status = 'WITHOUT_RECEIPT' THEN tp.amount ELSE 0 END), 0)::text AS "withoutReceipt"
      FROM "TaxPayment" tp
      WHERE ${where}
    `, ...params),
  ]);

  const total = parseInt(countResult[0]?.total ?? "0", 10);

  response.json({
    data: rows,
    pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
    summary: summary[0] ?? { total: "0", paid: "0", pending: "0", overdue: "0", withoutReceipt: "0" },
  });
});

// ─── GET /tax-payments/:id ────────────────────────────────────────────────────
taxPaymentRouter.get("/:id", async (request, response) => {
  const { id } = request.params;
  const row = await prisma.taxPayment.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: { select: { id: true, tradeName: true, legalName: true, cnpj: true } },
      dreCategory: { select: { id: true, name: true, dreGroup: true } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) return response.status(404).json({ message: "Lançamento não encontrado." });
  return response.json(row);
});

// ─── POST /tax-payments ───────────────────────────────────────────────────────
taxPaymentRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const {
    companyId, cnpj, legalName, tradeName, documentType, description,
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId,
  } = request.body as Record<string, unknown>;

  if (!documentType || typeof documentType !== "string" || !documentType.trim()) {
    return response.status(400).json({ message: "Tipo de documento obrigatório." });
  }
  if (!dueDate) return response.status(400).json({ message: "Vencimento obrigatório." });
  if (amount == null) return response.status(400).json({ message: "Valor obrigatório." });

  const parsedDueDate = new Date(dueDate as string);
  const parsedPaymentDate = paymentDate ? new Date(paymentDate as string) : null;
  const status = computeStatus(parsedPaymentDate, parsedDueDate);

  const created = await prisma.taxPayment.create({
    data: {
      id: crypto.randomUUID(),
      companyId: (companyId as string) || null,
      cnpj: cnpj ? String(cnpj).replace(/\D/g, "") : null,
      legalName: (legalName as string) || null,
      tradeName: (tradeName as string) || null,
      documentType: String(documentType).trim(),
      description: (description as string) || null,
      competenceDate: competenceDate ? new Date(competenceDate as string) : null,
      dueDate: parsedDueDate,
      amount: Number(amount),
      paymentDate: parsedPaymentDate,
      paidAmount: paidAmount != null ? Number(paidAmount) : null,
      status: status as "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT",
      comments: (comments as string) || null,
      source: "MANUAL",
      dreCategoryId: (dreCategoryId as string) || null,
      createdById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: created.id,
    newValue: created,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.status(201).json(created);
});

// ─── PUT /tax-payments/:id ────────────────────────────────────────────────────
taxPaymentRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  const {
    companyId, cnpj, legalName, tradeName, documentType, description,
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId, status,
  } = request.body as Record<string, unknown>;

  const parsedDueDate = dueDate ? new Date(dueDate as string) : existing.dueDate;
  const parsedPaymentDate = paymentDate !== undefined
    ? (paymentDate ? new Date(paymentDate as string) : null)
    : existing.paymentDate;

  const effectiveStatus = (status as string) || computeStatus(parsedPaymentDate, parsedDueDate);

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      companyId: companyId !== undefined ? ((companyId as string) || null) : existing.companyId,
      cnpj: cnpj !== undefined ? (cnpj ? String(cnpj).replace(/\D/g, "") : null) : existing.cnpj,
      legalName: legalName !== undefined ? ((legalName as string) || null) : existing.legalName,
      tradeName: tradeName !== undefined ? ((tradeName as string) || null) : existing.tradeName,
      documentType: documentType ? String(documentType).trim() : existing.documentType,
      description: description !== undefined ? ((description as string) || null) : existing.description,
      competenceDate: competenceDate !== undefined ? (competenceDate ? new Date(competenceDate as string) : null) : existing.competenceDate,
      dueDate: parsedDueDate,
      amount: amount != null ? Number(amount) : existing.amount,
      paymentDate: parsedPaymentDate,
      paidAmount: paidAmount !== undefined ? (paidAmount != null ? Number(paidAmount) : null) : existing.paidAmount,
      status: effectiveStatus as "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT",
      comments: comments !== undefined ? ((comments as string) || null) : existing.comments,
      dreCategoryId: dreCategoryId !== undefined ? ((dreCategoryId as string) || null) : existing.dreCategoryId,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── DELETE /tax-payments/:id (soft delete) ───────────────────────────────────
taxPaymentRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  await prisma.taxPayment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: "DELETE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ ok: true });
});

// ─── PATCH /tax-payments/:id/pay ─────────────────────────────────────────────
taxPaymentRouter.patch("/:id/pay", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const paymentDate = request.body.paymentDate ? new Date(String(request.body.paymentDate)) : null;
  const paidAmount = Number(request.body.paidAmount ?? 0);
  const comments = request.body.comments != null ? String(request.body.comments) : undefined;

  if (!paymentDate || isNaN(paymentDate.getTime()) || paidAmount <= 0) {
    return response.status(400).json({ message: "Data do pagamento e valor pago (> 0) são obrigatórios." });
  }

  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      paymentDate,
      paidAmount,
      status: "PAID",
      ...(comments !== undefined ? { comments } : {}),
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "PAY_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, status: updated.status });
});

// ─── PATCH /tax-payments/:id/reverse ─────────────────────────────────────────
taxPaymentRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  if (!existing.paymentDate) {
    return response.status(400).json({ message: "Este lançamento ainda não possui pagamento para estornar." });
  }

  const now = new Date();
  const reversedStatus = existing.dueDate && existing.dueDate < now ? "OVERDUE" : "PENDING";

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      paymentDate: null,
      paidAmount: null,
      status: reversedStatus,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "REVERSE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, status: updated.status });
});

// ─── GET /tax-payments/:id/history ───────────────────────────────────────────
taxPaymentRouter.get("/:id/history", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a.*, u."name" AS "userName", u."email" AS "userEmail"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE a."entity" = 'TaxPayment' AND a."entityId" = ${request.params.id}
    ORDER BY a."createdAt" DESC
    LIMIT 50
  `;
  return response.json(rows);
});

// ─── POST /tax-payments/import-xlsx/preview ───────────────────────────────────
taxPaymentRouter.post("/import-xlsx/preview", upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: "Arquivo XLSX obrigatório." });

  // Buscar chaves de deduplicação já existentes no banco
  const existingKeys = await prisma.$queryRaw<Array<{ key: string }>>`
    SELECT ENCODE(
      DIGEST(
        CONCAT_WS('|', tp."cnpj", tp."documentType",
          LOWER(TRIM(COALESCE(tp.description, ''))),
          TO_CHAR(tp."competenceDate", 'YYYY-MM-DD'),
          TO_CHAR(tp."dueDate", 'YYYY-MM-DD'),
          tp.amount::text
        ),
        'sha256'
      ),
      'hex'
    ) AS key
    FROM "TaxPayment" tp
    WHERE tp."deletedAt" IS NULL
      AND tp."cnpj" IS NOT NULL
      AND tp."dueDate" IS NOT NULL
  `.catch(() => [] as Array<{ key: string }>);

  const existingKeySet = new Set(existingKeys.map((r) => r.key.slice(0, 32)));

  try {
    const preview = await previewTaxImport(request.file.path, existingKeySet);
    return response.json(preview);
  } catch (error) {
    fs.unlink(request.file.path, () => undefined);
    return response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao processar arquivo." });
  }
});

// ─── POST /tax-payments/import-xlsx/confirm ───────────────────────────────────
taxPaymentRouter.post("/import-xlsx/confirm", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { filePath, importBatchId, skipDuplicates = true } = request.body as {
    filePath: string;
    importBatchId?: string;
    skipDuplicates?: boolean;
  };

  if (!filePath) return response.status(400).json({ message: "filePath obrigatório." });
  if (!fs.existsSync(filePath)) return response.status(400).json({ message: "Arquivo não encontrado. Faça o upload novamente." });

  const existingKeys = await prisma.$queryRaw<Array<{ key: string }>>`
    SELECT ENCODE(
      DIGEST(
        CONCAT_WS('|', tp."cnpj", tp."documentType",
          LOWER(TRIM(COALESCE(tp.description, ''))),
          TO_CHAR(tp."competenceDate", 'YYYY-MM-DD'),
          TO_CHAR(tp."dueDate", 'YYYY-MM-DD'),
          tp.amount::text
        ),
        'sha256'
      ),
      'hex'
    ) AS key
    FROM "TaxPayment" tp
    WHERE tp."deletedAt" IS NULL
      AND tp."cnpj" IS NOT NULL
      AND tp."dueDate" IS NOT NULL
  `.catch(() => [] as Array<{ key: string }>);

  const existingKeySet = new Set(existingKeys.map((r) => r.key.slice(0, 32)));
  const preview = await previewTaxImport(filePath, existingKeySet);

  const toImport = preview.rows.filter((r) => r.valid && (!skipDuplicates || !r.isDuplicate));
  const batchId = importBatchId ?? crypto.randomUUID();

  const created = await prisma.$transaction(async (tx) => {
    const records = [];
    for (const row of toImport) {
      const parsedPaymentDate = row.paymentDate;
      const parsedDueDate = row.dueDate!;
      const status = computeStatus(parsedPaymentDate, parsedDueDate);

      const record = await tx.taxPayment.create({
        data: {
          id: crypto.randomUUID(),
          cnpj: row.cnpj,
          legalName: row.legalName,
          tradeName: row.tradeName,
          documentType: row.documentType!,
          description: row.description,
          competenceDate: row.competenceDate,
          dueDate: parsedDueDate,
          amount: row.amount!,
          paymentDate: parsedPaymentDate,
          paidAmount: parsedPaymentDate ? row.amount : null,
          status: status as "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT",
          comments: row.comments,
          source: "IMPORT_XLSX",
          importBatchId: batchId,
          createdById: user.id,
        },
      });
      records.push(record);
    }
    return records;
  });

  fs.unlink(filePath, () => undefined);

  await auditLog({
    userId: user.id,
    action: "IMPORT_TAX_PAYMENTS",
    entity: "TaxPayment",
    newValue: { importBatchId: batchId, imported: created.length, total: preview.totalRows },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({
    importBatchId: batchId,
    imported: created.length,
    skipped: preview.rows.length - toImport.length,
    total: preview.totalRows,
  });
});

// ─── POST /tax-payments/:id/attachments ──────────────────────────────────────
taxPaymentRouter.post("/:id/attachments", attachmentUpload.single("file"), async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  // Em produção, bloquear upload se R2 não estiver configurado
  if (!r2Enabled && process.env.NODE_ENV === "production") {
    if (request.file) {
      try { fs.unlinkSync(request.file.path); } catch { /* ignora */ }
    }
    return response.status(503).json({
      message: "Storage persistente não configurado. Configure Cloudflare R2 antes de anexar comprovantes fiscais.",
      code: "R2_NOT_CONFIGURED",
    });
  }

  const { id } = request.params;
  const taxPayment = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!taxPayment) return response.status(404).json({ message: "Lançamento não encontrado." });
  if (!request.file) return response.status(400).json({ message: "Arquivo obrigatório." });

  const fileBuffer = fs.readFileSync(request.file.path);
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  let storagePath: string | null = null;
  let storageKey: string | null = null;
  const provider = r2Enabled ? ("R2" as const) : ("LOCAL" as const);

  if (r2Enabled) {
    // Chave no bucket: tax-payments/<taxPaymentId>/<attachmentId>/<originalname>
    const attachmentId = crypto.randomUUID();
    const safeFileName = path.basename(request.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    storageKey = `tax-payments/${id}/${attachmentId}/${safeFileName}`;
    await uploadToR2(storageKey, fileBuffer, request.file.mimetype);
    // Remover arquivo temporário do multer
    fs.unlinkSync(request.file.path);

    const attachment = await prisma.taxPaymentAttachment.create({
      data: {
        id: attachmentId,
        taxPaymentId: id,
        fileName: request.file.originalname,
        storagePath: null,
        storageProvider: provider,
        storageKey,
        mimeType: request.file.mimetype,
        fileSize: request.file.size,
        sha256,
        uploadedById: user.id,
      },
    });

    await auditLog({
      userId: user.id,
      action: "UPLOAD_TAX_PAYMENT_ATTACHMENT",
      entity: "TaxPaymentAttachment",
      entityId: attachment.id,
      newValue: { taxPaymentId: id, fileName: attachment.fileName, fileSize: attachment.fileSize, storageProvider: provider },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? ""),
    });

    return response.status(201).json(attachment);
  }

  // Fallback: disco local (somente para desenvolvimento sem R2)
  storagePath = request.file.path;
  const attachment = await prisma.taxPaymentAttachment.create({
    data: {
      id: crypto.randomUUID(),
      taxPaymentId: id,
      fileName: request.file.originalname,
      storagePath,
      storageProvider: provider,
      storageKey: null,
      mimeType: request.file.mimetype,
      fileSize: request.file.size,
      sha256,
      uploadedById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPLOAD_TAX_PAYMENT_ATTACHMENT",
    entity: "TaxPaymentAttachment",
    entityId: attachment.id,
    newValue: { taxPaymentId: id, fileName: attachment.fileName, fileSize: attachment.fileSize, storageProvider: provider },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.status(201).json(attachment);
});

// ─── DELETE /tax-payments/:id/attachments/:attachmentId ──────────────────────
taxPaymentRouter.delete("/:id/attachments/:attachmentId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id, attachmentId } = request.params;
  const attachment = await prisma.taxPaymentAttachment.findFirst({
    where: { id: attachmentId, taxPaymentId: id },
  });
  if (!attachment) return response.status(404).json({ message: "Comprovante não encontrado." });

  // Deletar do storage correspondente
  if (attachment.storageProvider === "R2" && attachment.storageKey) {
    await deleteFromR2(attachment.storageKey);
  } else if (attachment.storagePath && fs.existsSync(attachment.storagePath)) {
    fs.unlinkSync(attachment.storagePath);
  }

  await prisma.taxPaymentAttachment.delete({ where: { id: attachmentId } });

  await auditLog({
    userId: user.id,
    action: "DELETE_TAX_PAYMENT_ATTACHMENT",
    entity: "TaxPaymentAttachment",
    entityId: attachmentId,
    previousValue: { taxPaymentId: id, fileName: attachment.fileName, storageProvider: attachment.storageProvider },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ ok: true });
});

// ─── GET /tax-payments/:id/attachments/:attachmentId/download ─────────────────
taxPaymentRouter.get("/:id/attachments/:attachmentId/download", async (request, response) => {
  const { id, attachmentId } = request.params;
  const attachment = await prisma.taxPaymentAttachment.findFirst({
    where: { id: attachmentId, taxPaymentId: id },
  });
  if (!attachment) return response.status(404).json({ message: "Comprovante não encontrado." });

  if (attachment.storageProvider === "R2") {
    if (!attachment.storageKey) {
      return response.status(500).json({ message: "storageKey ausente no registro." });
    }
    // Redireciona para URL pré-assinada válida por 1 hora
    const signedUrl = await getR2SignedUrl(attachment.storageKey, 3600);
    return response.redirect(302, signedUrl);
  }

  // Fallback: disco local
  if (!attachment.storagePath || !fs.existsSync(attachment.storagePath)) {
    return response.status(404).json({ message: "Arquivo não encontrado no servidor." });
  }
  response.setHeader("Content-Disposition", `inline; filename="${attachment.fileName}"`);
  if (attachment.mimeType) response.setHeader("Content-Type", attachment.mimeType);
  return response.sendFile(path.resolve(attachment.storagePath));
});
