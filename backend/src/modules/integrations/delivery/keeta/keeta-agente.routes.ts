import { Router } from "express";
import multer from "multer";
import { requireRole } from "../../../security/security-utils.js";
import { heartbeatPayloadSchema } from "../../agile/agile-heartbeat.types.js";
import { obterSaudeAgente, registrarHeartbeat } from "../../agile/agile-heartbeat.service.js";
import { criarTokenDeMaquina } from "../../token-de-maquina.middleware.js";
import { ErroDeImportacao } from "./erro-de-importacao.js";
import { PLATAFORMA_DO_AGENTE, ROTULO_DO_AGENTE } from "./keeta-agente.constantes.js";
import { confirmarImportacaoKeeta } from "./keeta-import.service.js";

// Agente da Keeta, que roda na PDVTOUCH (a mesma máquina do agente do Agile). Ele entra no portal da
// Keeta, baixa o relatório "Dados do restaurante" e o envia aqui. A Keeta não tem integração oficial,
// então o ERP recebe o MESMO arquivo que a tela de importação recebe e usa a mesma importação (idempotente).
export const keetaAgenteRouter = Router();

const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;

const requireKeetaToken = criarTokenDeMaquina({
  envVar: "KEETA_INGEST_TOKEN",
  header: "x-keeta-token",
  mensagemNaoConfigurado: "Agente da Keeta não configurado no servidor. Defina KEETA_INGEST_TOKEN."
});
const uploadMemoria = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANHO_MAXIMO_BYTES } });

// O token vem ANTES do multer: sem ele, nem o corpo do upload é lido para a memória.
keetaAgenteRouter.post("/sync", requireKeetaToken, uploadMemoria.single("file"), async (request, response) => {
  if (!request.file?.buffer) {
    response.status(400).json({ message: "Arquivo não enviado." });
    return;
  }
  try {
    const resultado = await confirmarImportacaoKeeta(request.file.buffer, request.file.originalname, {
      userId: null,
      ipAddress: request.ip ?? null,
      userAgent: String(request.headers["user-agent"] ?? "") || "keeta-agente"
    });
    response.json({
      gravados: resultado.gravados,
      totais: resultado.totais,
      avisos: resultado.avisos,
      mesesTravados: resultado.mesesTravados
    });
  } catch (error: unknown) {
    if (error instanceof ErroDeImportacao) {
      response.status(400).json({ message: error.message });
      return;
    }
    // 5xx é retentável: o detalhe (host/porta do banco, por exemplo) fica só no log do servidor.
    console.error("[Keeta agente] falha ao importar o relatório", error);
    response.status(500).json({ message: "Erro interno na sincronização. Tente novamente." });
  }
});

// Sinal de vida ao fim de cada execução. "Login necessário" chega como status "erro" com mensagem.
keetaAgenteRouter.post("/heartbeat", requireKeetaToken, async (request, response) => {
  const parsed = heartbeatPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    const campo = primeiro?.path.join(".") || "corpo";
    response.status(400).json({ erro: `Heartbeat inválido (${campo}): ${primeiro?.message ?? "formato incorreto"}` });
    return;
  }
  try {
    response.json(await registrarHeartbeat(parsed.data, new Date(), PLATAFORMA_DO_AGENTE));
  } catch (error: unknown) {
    console.error("[Keeta agente] falha ao registrar heartbeat", error);
    response.status(500).json({ erro: "Não foi possível registrar o heartbeat." });
  }
});

// Para a tela: usuário com sessão e permissão do módulo (mapeado em menu-permissions). O token da máquina NÃO vale aqui.
keetaAgenteRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  response.json(await obterSaudeAgente(new Date(), PLATAFORMA_DO_AGENTE, ROTULO_DO_AGENTE));
});
