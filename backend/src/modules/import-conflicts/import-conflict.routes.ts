import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { requireRole } from "../security/security-utils.js";
import type { ConflictAction, ConflictEntityType, ConflictType } from "./conflict-detection.service.js";

export const importConflictRouter = Router();

const actions = new Set<ConflictAction>([
  "KEEP_CURRENT",
  "UPDATE_CURRENT",
  "CREATE_ALIAS",
  "CREATE_NEW",
  "IGNORE"
]);

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asAction(value: unknown): ConflictAction {
  const action = String(value ?? "").trim().toUpperCase() as ConflictAction;
  if (!actions.has(action)) {
    throw new Error("Acao de conflito invalida.");
  }
  return action;
}

async function saveDecision(input: {
  conflictKey: string;
  entityType: ConflictEntityType;
  conflictType: ConflictType;
  action: ConflictAction;
  targetId: string | null;
  code: string | null;
  normalizedName: string | null;
  incomingName: string | null;
  notes: string | null;
}) {
  const id = crypto.randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "ImportConflictDecision" (
      "id",
      "conflictKey",
      "entityType",
      "conflictType",
      "action",
      "targetId",
      "code",
      "normalizedName",
      "incomingName",
      "notes",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${input.conflictKey},
      ${input.entityType},
      ${input.conflictType},
      ${input.action},
      ${input.targetId},
      ${input.code},
      ${input.normalizedName},
      ${input.incomingName},
      ${input.notes},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("conflictKey") DO UPDATE SET
      "entityType" = EXCLUDED."entityType",
      "conflictType" = EXCLUDED."conflictType",
      "action" = EXCLUDED."action",
      "targetId" = EXCLUDED."targetId",
      "code" = EXCLUDED."code",
      "normalizedName" = EXCLUDED."normalizedName",
      "incomingName" = EXCLUDED."incomingName",
      "notes" = EXCLUDED."notes",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  const [decision] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ImportConflictDecision" WHERE "conflictKey" = ${input.conflictKey}
  `;

  return decision;
}

async function applyProductAction(input: {
  action: ConflictAction;
  targetId: string | null;
  incomingName: string | null;
  code: string | null;
}) {
  if (!input.incomingName) return input.targetId;

  if (input.action === "UPDATE_CURRENT" && input.targetId) {
    const product = await prisma.product.update({
      where: { id: input.targetId },
      data: {
        name: input.incomingName,
        normalizedName: normalizeText(input.incomingName)
      }
    });
    return product.id;
  }

  if (input.action === "CREATE_ALIAS" && input.targetId) {
    const aliases = input.incomingName
      .split(/\s+(?:\/|\|)\s+|\|/)
      .map((alias) => alias.trim())
      .filter(Boolean);
    for (const alias of aliases) {
      await prisma.productAlias.upsert({
        where: { normalizedAlias: normalizeText(alias) },
        create: {
          alias,
          normalizedAlias: normalizeText(alias),
          productId: input.targetId
        },
        update: {
          alias,
          productId: input.targetId
        }
      });
    }
    return input.targetId;
  }

  if (input.action === "CREATE_NEW") {
    const product = await prisma.product.create({
      data: {
        externalCode: input.code,
        name: input.incomingName,
        normalizedName: normalizeText(input.incomingName),
        aliases: {
          create: {
            alias: input.incomingName,
            normalizedAlias: normalizeText(input.incomingName)
          }
        }
      }
    });
    return product.id;
  }

  return input.targetId;
}

async function applySupplierAction(input: {
  action: ConflictAction;
  targetId: string | null;
  incomingName: string | null;
  code: string | null;
}) {
  if (!input.incomingName) return input.targetId;

  if (input.action === "UPDATE_CURRENT" && input.targetId) {
    const supplier = await prisma.supplier.update({
      where: { id: input.targetId },
      data: {
        name: input.incomingName,
        ...(input.code ? { externalCode: input.code } : {})
      }
    });
    return supplier.id;
  }

  if (input.action === "CREATE_NEW") {
    const supplier = await prisma.supplier.create({
      data: {
        externalCode: input.code,
        name: input.incomingName
      }
    });
    return supplier.id;
  }

  return input.targetId;
}

importConflictRouter.post("/decisions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  try {
    const conflictKey = asText(request.body.conflictKey);
    const entityType = asText(request.body.entityType) as ConflictEntityType | null;
    const conflictType = asText(request.body.conflictType) as ConflictType | null;
    const action = asAction(request.body.action);
    const incomingName = asText(request.body.incomingName);
    const code = asText(request.body.code);
    const normalizedName = asText(request.body.normalizedName) ?? (incomingName ? normalizeText(incomingName) : null);
    let targetId = asText(request.body.targetId);

    if (!conflictKey || !entityType || !conflictType) {
      response.status(400).json({ message: "Conflito incompleto." });
      return;
    }

    if (action !== "KEEP_CURRENT" && action !== "IGNORE") {
      targetId =
        entityType === "product"
          ? await applyProductAction({ action, targetId, incomingName, code })
          : await applySupplierAction({ action, targetId, incomingName, code });
    }

    const decision = await saveDecision({
      conflictKey,
      entityType,
      conflictType,
      action,
      targetId,
      code,
      normalizedName,
      incomingName,
      notes: asText(request.body.notes)
    });

    response.status(201).json(decision);
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao salvar decisao de conflito."
    });
  }
});

importConflictRouter.get("/decisions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const decisions = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ImportConflictDecision" ORDER BY "updatedAt" DESC
  `;
  response.json(decisions);
});
