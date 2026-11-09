import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requestIp, requireRole } from "../../../security/security-utils.js";
import { ErroDeImportacao } from "../keeta/erro-de-importacao.js";
import { confirmarImportacaoIfood, preverImportacaoIfood } from "./ifood-conciliacao-import.service.js";
import {
  createStore,
  getPeriodSummary,
  getStatus,
  listStores,
  runMockSync,
  runSmartSync,
  saveCredential,
  updateStore
} from "./ifood.service.js";
import {
  ifoodCredentialInputSchema,
  ifoodStoreInputSchema,
  periodQuerySchema
} from "./ifood.types.js";
import { getPainelDonoInsights } from "./ifood-insights.service.js";
import { testIfoodConnection } from "./ifood-http-client.js";

export const ifoodDeliveryRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const WRITE_ROLES = ["ADMIN", "GESTAO_COMPLETA"] as const;

ifoodDeliveryRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const status = await getStatus();
  response.json(status);
});

ifoodDeliveryRouter.get("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const stores = await listStores();
  response.json(stores);
});

ifoodDeliveryRouter.post("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodStoreInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  const created = await createStore(parsed.data);
  response.status(201).json(created);
});

ifoodDeliveryRouter.put("/stores/:id", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodStoreInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  try {
    const updated = await updateStore(request.params.id, parsed.data);
    response.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar loja";
    response.status(400).json({ message });
  }
});

ifoodDeliveryRouter.post("/credential", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodCredentialInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Credencial inválida", errors: parsed.error.flatten() });
    return;
  }
  const status = await saveCredential(parsed.data);
  response.json(status);
});

ifoodDeliveryRouter.get("/summary", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const summary = await getPeriodSummary(parsed.data);
  response.json(summary);
});

ifoodDeliveryRouter.get("/insights", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const insights = await getPainelDonoInsights({ year: parsed.data.year, month: parsed.data.month });
  response.json(insights);
});

ifoodDeliveryRouter.post("/test-connection", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await testIfoodConnection();
  response.status(result.ok ? 200 : 400).json(result);
});

ifoodDeliveryRouter.post("/sync", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const now = new Date();
  const year = Number(request.body?.year) || now.getFullYear();
  const month = Number(request.body?.month) || (now.getMonth() + 1);
  const result = await runSmartSync(user.id ?? null, year, month);
  response.json(result);
});

ifoodDeliveryRouter.post("/sync-mock-only", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await runMockSync(user.id ?? null);
  response.json(result);
});

// Importação do Relatório de Conciliação do portal (Análise → Relatórios). Prévia e confirmação
// recebem o MESMO arquivo: o servidor recalcula na confirmação, então o que a tela mostrou nunca
// é a entrada da gravação.
const TAMANHO_MAXIMO_IMPORTACAO_BYTES = 5 * 1024 * 1024;
const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_IMPORTACAO_BYTES, files: 1, fields: 1, parts: 3 }
});
const MENSAGEM_GENERICA = "Não foi possível processar o arquivo. Confira se é o Relatório de Conciliação exportado do portal do iFood.";
const MENSAGEM_ERRO_INTERNO = "Erro ao processar a importação. Nada foi gravado; tente de novo em instantes.";

/** O papel é checado ANTES de o multer ler até 5 MB para a memória. */
async function exigirPapelDeEscrita(request: Request, response: Response, next: NextFunction) {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  response.locals.userId = user.id;
  next();
}

/** Upload com mensagem amigável: erro do multer (tamanho, campo a mais) não cai no handler global. */
function receberArquivo(request: Request, response: Response, next: NextFunction) {
  uploadMemoria.single("file")(request, response, (erro: unknown) => {
    if (!erro) return next();
    const grande = erro instanceof multer.MulterError && erro.code === "LIMIT_FILE_SIZE";
    response.status(400).json({ message: grande ? "Arquivo maior que 5 MB. Exporte um mês e uma loja por vez." : MENSAGEM_GENERICA });
  });
}

async function tratarImportacao(
  request: Request,
  response: Response,
  executar: (buffer: Buffer, nome: string, userId: string) => Promise<unknown>
) {
  if (!request.file?.buffer) {
    response.status(400).json({ message: "Arquivo não enviado." });
    return;
  }
  try {
    response.json(await executar(request.file.buffer, request.file.originalname, String(response.locals.userId)));
  } catch (error) {
    // Só mensagem escrita para o usuário sai daqui; erro de Prisma/exceljs/banco fica no log.
    if (error instanceof ErroDeImportacao) {
      response.status(400).json({ message: error.message });
      return;
    }
    console.error("[iFood] falha na importação:", error);
    response.status(500).json({ message: MENSAGEM_ERRO_INTERNO });
  }
}

ifoodDeliveryRouter.post("/import/preview", exigirPapelDeEscrita, receberArquivo, (request, response) =>
  tratarImportacao(request, response, (buffer, nome) => preverImportacaoIfood(buffer, nome))
);

ifoodDeliveryRouter.post("/import/confirm", exigirPapelDeEscrita, receberArquivo, (request, response) =>
  tratarImportacao(request, response, (buffer, nome, userId) =>
    confirmarImportacaoIfood(buffer, nome, {
      userId,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "") || null,
      confirmouAlertas: request.body?.confirmouAlertas === "true"
    })
  )
);
