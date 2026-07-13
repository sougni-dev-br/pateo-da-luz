import { Router } from "express";
import { requireRole } from "../security/security-utils.js";
import {
  cancelReceivable,
  createReceivable,
  listReceivables,
  markReceived
} from "./receivable.service.js";
import {
  createReceivableSchema,
  listQuerySchema,
  markReceivedSchema
} from "./receivable.types.js";

export const receivableRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const WRITE_ROLES = ["ADMIN", "GESTAO_COMPLETA"] as const;

receivableRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const rows = await listReceivables(parsed.data);
  response.json(rows);
});

receivableRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = createReceivableSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  const created = await createReceivable(parsed.data);
  response.status(201).json(created);
});

receivableRouter.post("/:id/receive", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = markReceivedSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  try {
    const updated = await markReceived(request.params.id, parsed.data, user.id ?? null);
    response.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao dar baixa";
    response.status(400).json({ message });
  }
});

receivableRouter.post("/:id/cancel", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const reason = typeof request.body?.reason === "string" ? request.body.reason : null;
  try {
    const updated = await cancelReceivable(request.params.id, reason, user.id ?? null);
    response.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao cancelar";
    response.status(400).json({ message });
  }
});
