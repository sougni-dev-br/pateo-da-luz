import { Router, type Request, type Response } from "express";
import { auditLog, requestIp, requireMenuPermission } from "../security/security-utils.js";
import {
  cancelReceivable,
  createReceivable,
  getReceivable,
  listReceivables,
  markReceived,
  ReceivableError,
  reverseReceipt,
  summarizeReceivables
} from "./receivable.service.js";
import {
  createReceivableSchema,
  listQuerySchema,
  markReceivedSchema,
  reasonSchema
} from "./receivable.types.js";

export const receivableRouter = Router();

// Quem pode o quê é decidido por usuário, pela tela de Permissões: o middleware global
// (requireMenuAccess) mapeia GET→ver, POST→criar, /cancel e /reverse→excluir. Nada aqui é por cargo.

function primeiraMensagem(erro: { issues: Array<{ message: string }> }): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}

function responderInvalido(response: Response, erro: { issues: Array<{ message: string }> }) {
  response.status(400).json({ message: primeiraMensagem(erro), errors: erro.issues });
}

function trataErro(response: Response, erro: unknown) {
  if (erro instanceof ReceivableError) {
    response.status(erro.status).json({ message: erro.message });
    return;
  }
  throw erro;
}

async function auditar(request: Request, userId: string | null, action: string, entityId: string, previousValue: unknown, newValue: unknown) {
  await auditLog({
    userId,
    action,
    entity: "Receivable",
    entityId,
    previousValue,
    newValue,
    ipAddress: requestIp(request),
    userAgent: request.headers["user-agent"]?.toString() ?? null
  });
}

receivableRouter.get("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    responderInvalido(response, parsed.error);
    return;
  }
  const { rows, total } = await listReceivables(parsed.data);
  response.setHeader("X-Total-Count", String(total));
  response.json(rows);
});

// Antes de "/:id" para não ser lido como um id.
receivableRouter.get("/summary", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  response.json(await summarizeReceivables());
});

receivableRouter.get("/:id", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  try {
    response.json(await getReceivable(request.params.id));
  } catch (erro) {
    trataErro(response, erro);
  }
});

receivableRouter.post("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  const parsed = createReceivableSchema.safeParse(request.body);
  if (!parsed.success) {
    responderInvalido(response, parsed.error);
    return;
  }
  const created = await createReceivable(parsed.data);
  await auditar(request, user.id ?? null, "CREATE_RECEIVABLE", created.id, null, created);
  response.status(201).json(created);
});

receivableRouter.post("/:id/receive", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  const parsed = markReceivedSchema.safeParse(request.body);
  if (!parsed.success) {
    responderInvalido(response, parsed.error);
    return;
  }
  try {
    const { view, antes, receiptId } = await markReceived(request.params.id, parsed.data, user.id ?? null);
    await auditar(request, user.id ?? null, "RECEIVE_RECEIVABLE", view.id, antes, {
      receiptId,
      receivedDate: parsed.data.receivedDate,
      amount: parsed.data.paidAmount,
      status: view.status,
      paidAmount: view.paidAmount
    });
    response.json(view);
  } catch (erro) {
    trataErro(response, erro);
  }
});

receivableRouter.post("/:id/receipts/:receiptId/reverse", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  const parsed = reasonSchema.safeParse(request.body);
  if (!parsed.success) {
    responderInvalido(response, parsed.error);
    return;
  }
  try {
    const { view, antes, receiptId } = await reverseReceipt(request.params.id, request.params.receiptId, parsed.data.reason, user.id ?? null);
    await auditar(request, user.id ?? null, "REVERSE_RECEIVABLE_RECEIPT", view.id, antes, {
      receiptId,
      reason: parsed.data.reason,
      status: view.status,
      paidAmount: view.paidAmount
    });
    response.json(view);
  } catch (erro) {
    trataErro(response, erro);
  }
});

receivableRouter.post("/:id/cancel", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;
  const parsed = reasonSchema.safeParse(request.body);
  if (!parsed.success) {
    responderInvalido(response, parsed.error);
    return;
  }
  try {
    const { view, antes } = await cancelReceivable(request.params.id, parsed.data.reason, user.id ?? null);
    await auditar(request, user.id ?? null, "CANCEL_RECEIVABLE", view.id, antes, { status: view.status, reason: parsed.data.reason });
    response.json(view);
  } catch (erro) {
    trataErro(response, erro);
  }
});
