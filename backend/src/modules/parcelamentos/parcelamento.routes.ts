import { Router, type Request, type Response } from "express";
import { requireRole } from "../security/security-utils.js";
import {
  cancelarParcelamento,
  criarParcelamento,
  detalharParcelamento,
  listarParcelamentos,
  ParcelamentoError,
  renegociarParcelamento
} from "./parcelamento.service.js";

export const parcelamentoRouter = Router();

const PAPEIS: Array<"ADMIN" | "GESTAO_COMPLETA"> = ["ADMIN", "GESTAO_COMPLETA"];

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function numero(valor: unknown): number {
  return Number(valor);
}

function informadas(valor: unknown) {
  if (!Array.isArray(valor)) return undefined;
  return valor.map((p: Record<string, unknown>) => ({ valor: numero(p?.valor), vencimento: texto(p?.vencimento) }));
}

function responderErro(response: Response, error: unknown): boolean {
  if (error instanceof ParcelamentoError) {
    response.status(error.status).json({ message: error.message });
    return true;
  }
  return false;
}

async function gerenciar(request: Request, response: Response) {
  return requireRole(request, response, PAPEIS);
}

parcelamentoRouter.get("/", async (request, response) => {
  if (!(await requireRole(request, response, [...PAPEIS, "VISUALIZACAO"]))) return;
  response.json(await listarParcelamentos());
});

parcelamentoRouter.get("/:id", async (request, response) => {
  if (!(await requireRole(request, response, [...PAPEIS, "VISUALIZACAO"]))) return;
  try {
    response.json(await detalharParcelamento(request.params.id));
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});

parcelamentoRouter.post("/", async (request, response) => {
  const user = await gerenciar(request, response);
  if (!user) return;
  const body = request.body ?? {};
  try {
    const resultado = await criarParcelamento({
      supplierId: texto(body.supplierId),
      companyId: texto(body.companyId),
      productId: texto(body.productId),
      description: texto(body.description),
      total: numero(body.total),
      quantidade: numero(body.quantidade),
      primeiroVencimento: texto(body.primeiroVencimento) || undefined,
      informadas: informadas(body.parcelas),
      paymentMethodId: texto(body.paymentMethodId) || null,
      notes: texto(body.notes) || null,
      excludeFromDre: body.foraDoDre === true || body.foraDoDre === "true"
    }, user.id);
    response.status(201).json(await detalharParcelamento(resultado.planId));
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});

parcelamentoRouter.post("/:id/renegociar", async (request, response) => {
  const user = await gerenciar(request, response);
  if (!user) return;
  const body = request.body ?? {};
  try {
    const resultado = await renegociarParcelamento(request.params.id, {
      quantidade: numero(body.quantidade),
      primeiroVencimento: texto(body.primeiroVencimento) || undefined,
      informadas: informadas(body.parcelas),
      total: body.total === undefined || body.total === null || body.total === "" ? undefined : numero(body.total),
      motivo: texto(body.motivo),
      notes: texto(body.notes) || null
    }, user.id);
    response.status(201).json({ ...resultado, plano: await detalharParcelamento(resultado.planId) });
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});

parcelamentoRouter.post("/:id/cancelar", async (request, response) => {
  const user = await gerenciar(request, response);
  if (!user) return;
  try {
    const resultado = await cancelarParcelamento(request.params.id, texto(request.body?.motivo), user.id);
    response.json({ ...resultado, plano: await detalharParcelamento(request.params.id) });
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});
