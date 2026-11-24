import { Router } from "express";
import { z } from "zod";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { listarMetas, MetaInvalidaError, montarPainel, removerMeta, salvarMeta } from "./cmv-metas.service.js";

// Montado em /monthly/cmv-real/metas: o controle de acesso resolve pelo prefixo /monthly/cmv-real
// (módulo "CMV Real"), então quem enxerga o CMV enxerga as metas, sem permissão nova nem checagem de cargo.
export const cmvMetasRouter = Router();

const auditoria = (request: Parameters<typeof requestIp>[0]) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") || null });
const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (use aaaa-mm).");

const metaSchema = z.object({
  escopo: z.enum(["GERAL", "SETOR"]),
  sectorId: z.string().min(1).nullish().transform((v) => v ?? null),
  alvoPercentual: z.number().finite(),
  alertaPercentual: z.number().finite(),
  inicio: mesSchema,
  observacao: z.string().trim().max(300).nullish().transform((v) => (v ? v : null)),
});

cmvMetasRouter.get("/", async (_request, response) => {
  response.json(await listarMetas());
});

cmvMetasRouter.get("/painel", async (request, response) => {
  const consulta = mesSchema.safeParse(request.query.mes);
  if (!consulta.success) return response.status(400).json({ message: consulta.error.issues[0]?.message ?? "Mês inválido." });
  const [ano, mes] = consulta.data.split("-").map(Number);
  return response.json(await montarPainel(ano, mes));
});

cmvMetasRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = metaSchema.safeParse(request.body);
  if (!dados.success) return response.status(400).json({ message: dados.error.issues[0]?.message ?? "Dados inválidos." });
  try {
    const salva = await salvarMeta({ ...dados.data, userId: user.id });
    await auditLog({ userId: user.id, action: "SAVE_CMV_GOAL", entity: "CmvMeta", entityId: salva.id, newValue: dados.data, ...auditoria(request) });
    return response.status(201).json({ id: salva.id });
  } catch (error) {
    if (error instanceof MetaInvalidaError) return response.status(400).json({ message: error.message });
    throw error;
  }
});

cmvMetasRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const removida = await removerMeta(String(request.params.id));
  if (!removida) return response.status(404).json({ message: "Meta não encontrada." });
  await auditLog({ userId: user.id, action: "DELETE_CMV_GOAL", entity: "CmvMeta", entityId: removida.id, previousValue: { escopo: removida.escopo, sectorId: removida.sectorId, alvo: Number(removida.alvoPercentual) }, ...auditoria(request) });
  return response.json({ ok: true });
});
