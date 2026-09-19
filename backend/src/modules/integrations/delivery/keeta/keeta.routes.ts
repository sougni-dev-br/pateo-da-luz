import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../../security/security-utils.js";
import { getKeetaSummary } from "./keeta.service.js";

// Router da Keeta. Só leitura: a plataforma não tem integração, então não há
// credencial para salvar nem sincronização para disparar — o faturamento entra
// pelo import do portal.
export const keetaDeliveryRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;

const periodQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

keetaDeliveryRouter.get("/summary", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  response.json(await getKeetaSummary(parsed.data));
});
