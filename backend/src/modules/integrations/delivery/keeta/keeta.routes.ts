import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requestIp, requireRole } from "../../../security/security-utils.js";
import { getKeetaSummary } from "./keeta.service.js";
import { confirmarImportacaoKeeta, preverImportacaoKeeta } from "./keeta-import.service.js";

// Router da Keeta. A plataforma não tem integração, então não há credencial para salvar
// nem sincronização para disparar — o faturamento entra por arquivo do portal.
export const keetaDeliveryRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const WRITE_ROLES = ["ADMIN", "GESTAO_COMPLETA"] as const;
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const uploadMemoria = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANHO_MAXIMO_BYTES } });

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

// Prévia e confirmação recebem o MESMO arquivo: o servidor recalcula na confirmação,
// então o que a tela mostrou nunca é a entrada da gravação.
async function tratarImportacao(
  request: Request,
  response: Response,
  executar: (buffer: Buffer, nome: string, userId: string) => Promise<unknown>
) {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  if (!request.file?.buffer) {
    response.status(400).json({ message: "Arquivo não enviado." });
    return;
  }
  try {
    response.json(await executar(request.file.buffer, request.file.originalname, user.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao importar a Keeta." });
  }
}

keetaDeliveryRouter.post("/import/preview", uploadMemoria.single("file"), (request, response) =>
  tratarImportacao(request, response, (buffer, nome) => preverImportacaoKeeta(buffer, nome))
);

keetaDeliveryRouter.post("/import/confirm", uploadMemoria.single("file"), (request, response) =>
  tratarImportacao(request, response, (buffer, nome, userId) =>
    confirmarImportacaoKeeta(buffer, nome, {
      userId,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "") || null
    })
  )
);
