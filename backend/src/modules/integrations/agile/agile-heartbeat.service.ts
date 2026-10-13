import { prisma } from "../../../config/database.js";
import { avaliarSaudeAgente, type SaudeAgente } from "./agile-heartbeat.health.js";
import type { HeartbeatPayload } from "./agile-heartbeat.types.js";

const SOURCE_PLATFORM = "AGILE_PDV";
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;

// Grava o sinal de vida do agente (upsert por máquina). Rápido de propósito: o
// agente faz uma tentativa com timeout de 15 s e ignora falha.
//
// Hora de recebimento = hora do SERVIDOR. O relógio da PDV pode estar errado e
// as regras de atraso não podem acreditar nele. O relógio do agente
// (`ocorridoEm`) só serve para uma coisa: um heartbeat "ok" mais antigo que o já
// guardado (atrasado na rede, reenviado fora de ordem) não pode recuar o último OK.
export async function registrarHeartbeat(payload: HeartbeatPayload, agora: Date = new Date()): Promise<{ recebidoEm: string }> {
  const chave = { sourcePlatform_agenteHost: { sourcePlatform: SOURCE_PLATFORM, agenteHost: payload.agenteHost } };
  const existente = await prisma.agileAgentHeartbeat.findUnique({
    where: chave,
    select: { ultimoOkOcorridoEm: true }
  });

  // Relógio da PDV adiantado não pode "congelar" o último OK: se gravássemos uma data
  // futura, todo OK seguinte (já com a hora certa) pareceria antigo e o alerta de
  // atraso ficaria falso para sempre. Passou da tolerância, vale a hora do servidor.
  const declarado = new Date(payload.ocorridoEm);
  const ocorridoEm = declarado.getTime() > agora.getTime() + TOLERANCIA_RELOGIO_MS ? agora : declarado;
  const ehOkMaisNovo = payload.status === "ok"
    && (!existente?.ultimoOkOcorridoEm || ocorridoEm.getTime() >= existente.ultimoOkOcorridoEm.getTime());

  const camposOk = ehOkMaisNovo
    ? {
        ultimoOkEm: agora,
        ultimoOkOcorridoEm: ocorridoEm,
        ultimoOkBatchId: payload.batchId ?? null,
        ultimoOkPeriodoFim: payload.periodoFim
      }
    : {};

  const comuns = {
    ultimoStatus: payload.status,
    ultimaMensagem: payload.status === "erro" ? (payload.mensagem ?? null) : null,
    ultimoHeartbeatEm: agora
  };

  await prisma.agileAgentHeartbeat.upsert({
    where: chave,
    create: {
      sourcePlatform: SOURCE_PLATFORM,
      agenteHost: payload.agenteHost,
      agenteVersion: payload.agenteVersion ?? null,
      ...comuns,
      ...camposOk
    },
    update: {
      // undefined = não mexe: um heartbeat sem versão não apaga a versão conhecida.
      agenteVersion: payload.agenteVersion ?? undefined,
      ...comuns,
      ...camposOk
    }
  });

  return { recebidoEm: agora.toISOString() };
}

// Estado do agente para a tela. Considera a máquina com o heartbeat mais recente
// (hoje só existe a PDVTOUCH).
export async function obterSaudeAgente(agora: Date = new Date()): Promise<SaudeAgente> {
  const registro = await prisma.agileAgentHeartbeat.findFirst({
    where: { sourcePlatform: SOURCE_PLATFORM },
    orderBy: { ultimoHeartbeatEm: "desc" }
  });
  return avaliarSaudeAgente(registro, agora);
}
