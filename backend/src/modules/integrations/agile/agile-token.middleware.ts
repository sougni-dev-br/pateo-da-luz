import type { NextFunction, Request, Response } from "express";

// O agente que roda na máquina PDVTOUCH não é um usuário — é uma máquina.
// Autenticamos por header X-Agile-Token contra a env var AGILE_INGEST_TOKEN.
// Isso vive fora do JWT / requireMenuAccess: qualquer request para /sync ou
// /heartbeat que não trouxer o token correto é rejeitada com 401 antes de
// qualquer trabalho.
export function requireAgileToken(request: Request, response: Response, next: NextFunction) {
  const expected = process.env.AGILE_INGEST_TOKEN;
  if (!expected || expected.trim().length < 16) {
    response.status(503).json({
      message: "Integração Agile PDV não configurada no servidor. Defina AGILE_INGEST_TOKEN."
    });
    return;
  }
  const provided = String(request.header("x-agile-token") ?? "").trim();
  // Comparação constante-no-tempo para não vazar o token via timing attack.
  const ok = provided.length === expected.length
    && provided.length > 0
    && timingSafeEqualString(provided, expected);
  if (!ok) {
    response.status(401).json({ message: "Token de integração inválido." });
    return;
  }
  next();
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
