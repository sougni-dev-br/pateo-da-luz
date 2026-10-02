// Limite de requisições por IP, em memória (o backend roda numa instância só). Serve às
// rotas públicas, que não têm sessão para segurar abuso.
import type { NextFunction, Request, Response } from "express";

// No Render o proxy ACRESCENTA o IP de quem conectou ao fim do X-Forwarded-For; o começo da
// lista é o que o cliente mandou e pode ser inventado para fugir do limite.
export function ipConfiavel(request: Request): string {
  const lista = String(request.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.at(-1) ?? request.socket?.remoteAddress ?? "desconhecido";
}

export function limiteDeRequisicoes(opcoes: { janelaMs: number; maximo: number; chave?: string }) {
  const contagens = new Map<string, { inicio: number; total: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const agora = Date.now();
    const chave = `${opcoes.chave ?? ""}:${ipConfiavel(request)}`;
    const atual = contagens.get(chave);
    if (!atual || agora - atual.inicio >= opcoes.janelaMs) {
      contagens.set(chave, { inicio: agora, total: 1 });
      // Limpeza preguiçosa: o mapa não cresce sem fim.
      if (contagens.size > 5000) {
        for (const [k, v] of contagens) if (agora - v.inicio >= opcoes.janelaMs) contagens.delete(k);
      }
      next();
      return;
    }
    atual.total += 1;
    if (atual.total > opcoes.maximo) {
      const segundos = Math.ceil((atual.inicio + opcoes.janelaMs - agora) / 1000);
      response.setHeader("Retry-After", String(segundos));
      response.status(429).json({ message: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." });
      return;
    }
    next();
  };
}

/**
 * Fila com no máximo `maximo` requisições ao mesmo tempo; as outras esperam a vez. A vaga é
 * devolvida quando a conexão fecha — inclusive de quem desistiu ainda na fila (sai da fila sem
 * ocupar vaga) e de quem trava mandando o corpo devagar (derrubado depois de `tempoMaximoMs`).
 * Sem isso, celular que perde o sinal na fila consumia uma vaga para sempre.
 */
export function filaLimitada(opcoes: { maximo: number; tempoMaximoMs: number }) {
  let ativos = 0;
  const fila: Array<() => void> = [];
  const andar = () => {
    while (ativos < opcoes.maximo && fila.length > 0) fila.shift()!();
  };
  const middleware = (request: Request, response: Response, next: NextFunction) => {
    let situacao: "fila" | "ativo" | "fim" = "fila";
    const comecar = () => {
      if (situacao !== "fila") return;
      situacao = "ativo";
      ativos += 1;
      request.setTimeout(opcoes.tempoMaximoMs, () => request.destroy());
      next();
    };
    response.once("close", () => {
      if (situacao === "ativo") {
        ativos -= 1;
        situacao = "fim";
        andar();
        return;
      }
      if (situacao === "fila") {
        const i = fila.indexOf(comecar);
        if (i >= 0) fila.splice(i, 1);
      }
      situacao = "fim";
    });
    if (ativos < opcoes.maximo) comecar();
    else fila.push(comecar);
  };
  return Object.assign(middleware, { situacao: () => ({ ativos, naFila: fila.length }) });
}
