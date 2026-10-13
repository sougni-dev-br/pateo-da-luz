import type { NextFunction, Request, Response } from "express";

// Colapsa barras repetidas ("//", "///") do CAMINHO da requisicao antes de qualquer roteamento.
//
// Por que existe: o portao global de acesso (requireMenuAccess) decide o modulo olhando o prefixo
// do caminho. O Express, porem, roteia "/integrations/agile//analise/x" como se fosse
// "/integrations/agile/analise/x". Resultado: o portao nao reconhecia o prefixo, nao exigia sessao
// nem permissao, e a requisicao chegava ao handler. Qualquer rota protegida SO pelo portao ficava
// aberta com uma barra a mais (auditoria de 13/10/2026; provado em producao).
//
// Normalizar na entrada, uma vez, fecha a classe inteira: portao e roteador passam a enxergar
// exatamente o mesmo caminho. A consulta (?a=//b) e o fragmento NAO sao tocados.
const FORMA_ABSOLUTA = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)([\s\S]*)$/i;

export function colapsarBarras(url: string): string {
  const partes = FORMA_ABSOLUTA.exec(url);
  if (!partes) return url;
  const [, origem = "", caminho, resto] = partes;
  const limpo = caminho.replace(/\/{2,}/g, "/");
  return limpo === caminho ? url : `${origem}${limpo}${resto}`;
}

export function normalizarBarrasDuplas(request: Request, _response: Response, next: NextFunction) {
  const url = colapsarBarras(request.url);
  if (url !== request.url) request.url = url;
  next();
}
