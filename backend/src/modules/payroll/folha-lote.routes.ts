// Ações do título do lote de pagamento da folha no Contas a Pagar: dar baixa, estornar,
// retirar uma pessoa (vai para a folha à parte) e devolver. Montado em /payroll/folha-lotes:
// vale a permissão da Folha, como a baixa individual (pay = editar, reverse = excluir).
import { Router, type Request, type Response } from "express";
import { getSessionUser, requestIp } from "../security/security-utils.js";
import { RecusaFolha } from "./folha-lancamento.routes.js";
import { devolverAoLote, estornarLote, pagarLote, retirarDoLote } from "./folha-lote.service.js";

export const folhaLoteRouter = Router();

// Quem fez e de onde: vai para a auditoria de cada membro e do título.
const usuarioDe = (u: { id: string; name: string }, request: Request) => ({
  id: u.id, name: u.name, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
});

function recusar(err: unknown, response: Response) {
  if (err instanceof RecusaFolha) return response.status(err.status).json(err.corpo);
  throw err;
}

folhaLoteRouter.patch("/:id/pay", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    response.json(await pagarLote(request.params.id, (request.body ?? {}) as Record<string, unknown>, usuarioDe(user, request)));
  } catch (err) { recusar(err, response); }
});

folhaLoteRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const motivo = typeof request.body?.reason === "string" ? request.body.reason : "";
  try {
    response.json(await estornarLote(request.params.id, motivo, usuarioDe(user, request)));
  } catch (err) { recusar(err, response); }
});

folhaLoteRouter.patch("/:id/membros/:itemId/retirar", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    response.json(await retirarDoLote(request.params.id, request.params.itemId, usuarioDe(user, request)));
  } catch (err) { recusar(err, response); }
});

folhaLoteRouter.patch("/:id/membros/:itemId/devolver", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    response.json(await devolverAoLote(request.params.id, request.params.itemId, usuarioDe(user, request)));
  } catch (err) { recusar(err, response); }
});
