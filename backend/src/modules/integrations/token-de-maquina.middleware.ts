import { createHash, timingSafeEqual } from "node:crypto";
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
  /**
   * Env vars de OUTROS agentes. Se o valor for igual ao de algum deles, este agente fica desligado (503):
   * com o mesmo token, um agente poderia gravar no lugar do outro.
   */
  diferenteDe?: string[];
};

const TAMANHO_MINIMO_DO_TOKEN = 16;

const sha256 = (texto: string) => createHash("sha256").update(texto).digest();

/** Compara os HASHES em tempo constante: não revela nem o tamanho do token pelo tempo de resposta. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function criarTokenDeMaquina(opcoes: OpcoesDoToken): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const esperado = (process.env[opcoes.envVar] ?? "").trim();
    const repetido = (opcoes.diferenteDe ?? []).some((nome) => (process.env[nome] ?? "").trim() === esperado);
    if (esperado.length < TAMANHO_MINIMO_DO_TOKEN || repetido) {
      response.status(503).json({ message: opcoes.mensagemNaoConfigurado });
      return;
    }
    const enviado = String(request.header(opcoes.header) ?? "").trim();
    if (enviado.length === 0 || !iguaisEmTempoConstante(enviado, esperado)) {
      response.status(401).json({ message: "Token de integração inválido." });
      return;
    }
    next();
  };
}
