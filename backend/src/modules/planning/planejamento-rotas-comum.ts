import type { Request, Response } from "express";
import type { z } from "zod";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";

// Helpers compartilhados pelas rotas do Planejamento (cenários e comentários).

export const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });

// A gravação já foi confirmada: falha ao registrar a auditoria não pode virar 500 e fazer a pessoa repetir o que já valeu.
export async function registrarAuditoria(id: string, dados: Parameters<typeof auditLog>[0], rotulo = "cenário") {
  try {
    await auditLog(dados);
  } catch (e) {
    console.error(`[planejamento] auditoria não gravada para o ${rotulo} ${id}`, e);
  }
}

export function mensagemDoZod(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}

export async function usuario(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (!user) response.status(401).json({ message: "Sessao obrigatoria." });
  return user;
}
