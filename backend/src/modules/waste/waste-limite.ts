// Limite de ritmo por usuário para quem lança desperdício e foto. Janela deslizante em memória:
// serve a uma instância só (a do Render), que é o caso. Protege o banco (as fotos moram nele) de um
// laço no cliente ou de uso indevido, sem atrapalhar quem lança vários itens seguidos no fechamento.
import type { NextFunction, Request, Response } from "express";
import { getSessionUser } from "../security/security-utils.js";

type Janela = { quantidade: number; porMinuto: number };

export const LIMITE_DE_LANCAMENTOS: Janela = { quantidade: 60, porMinuto: 1 };
export const LIMITE_DE_FOTOS: Janela = { quantidade: 30, porMinuto: 1 };

const MINUTO_MS = 60_000;

/** Contador injetável (o relógio vem de fora) para testar sem esperar. */
export function criarLimitador(regra: Janela, agora: () => number = Date.now) {
  const registros = new Map<string, number[]>();
  const janelaMs = regra.porMinuto * MINUTO_MS;

  return {
    /** Devolve segundos para tentar de novo, ou 0 se pode passar. */
    tentar(chave: string): number {
      const t = agora();
      const recentes = (registros.get(chave) ?? []).filter((momento) => t - momento < janelaMs);
      if (recentes.length >= regra.quantidade) {
        registros.set(chave, recentes);
        return Math.max(1, Math.ceil((recentes[0] + janelaMs - t) / 1000));
      }
      registros.set(chave, [...recentes, t]);
      // Não deixa o mapa crescer com quem passou uma vez e sumiu.
      if (registros.size > 5000) for (const [k, v] of registros) if (v.every((m) => t - m >= janelaMs)) registros.delete(k);
      return 0;
    },
  };
}

/** Middleware: conta só as chamadas que gravam (POST). A identidade é a sessão; sem sessão o gate global já recusou. */
export function limitarGravacoes(regra: Janela, limitador = criarLimitador(regra)) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== "POST") return next();
    const usuario = await getSessionUser(request);
    const espera = limitador.tentar(usuario?.id ?? request.ip ?? "anonimo");
    if (espera > 0) {
      response.setHeader("Retry-After", String(espera));
      return void response.status(429).json({ message: `Muitos lançamentos em pouco tempo. Aguarde ${espera}s e tente de novo.` });
    }
    return next();
  };
}
