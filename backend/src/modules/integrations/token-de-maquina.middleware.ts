import type { NextFunction, Request, RequestHandler, Response } from "express";

// Agentes que rodam numa máquina do restaurante (PDVTOUCH, etc.) não são usuários: autenticam por
// um header com um token compartilhado, guardado numa env var do servidor. Isso vive fora do JWT e
// do requireMenuAccess, então a rota PRECISA ter este middleware antes de qualquer trabalho.
export type OpcoesDoToken = {
  /** Nome da env var que guarda o token esperado. */
  envVar: string;
  /** Header que o agente envia (comparado sem diferenciar caixa pelo Express). */
  header: string;
  /** Mensagem do 503 quando o servidor não tem o token configurado. */
  mensagemNaoConfigurado: string;
};

const TAMANHO_MINIMO_DO_TOKEN = 16;

function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function criarTokenDeMaquina(opcoes: OpcoesDoToken): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const esperado = process.env[opcoes.envVar];
    if (!esperado || esperado.trim().length < TAMANHO_MINIMO_DO_TOKEN) {
      response.status(503).json({ message: opcoes.mensagemNaoConfigurado });
      return;
    }
    const enviado = String(request.header(opcoes.header) ?? "").trim();
    // Comparação em tempo constante para não vazar o token por timing.
    if (enviado.length === 0 || !iguaisEmTempoConstante(enviado, esperado)) {
      response.status(401).json({ message: "Token de integração inválido." });
      return;
    }
    next();
  };
}
