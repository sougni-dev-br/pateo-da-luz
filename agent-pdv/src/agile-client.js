// Cliente HTTP do AgileReport (portal ASP.NET MVC rodando local no PDVTOUCH
// em porta 8091). Faz login via Forms Auth preservando cookie e antiforgery
// token, e baixa os 3 CSVs que já vêm em UTF-16 LE com BOM.
//
// Não usamos nenhuma dependência externa: fetch é nativo do Node 20+ e o
// gerenciamento de cookies é manual e minimalista (o AgileReport só precisa
// de `.ASPXAUTH` / `__RequestVerificationToken`; nada de multi-domain).

import { logger } from "./logger.js";

// Regex simples para extrair o token AntiForgery do HTML da página de login.
// ASP.NET MVC renderiza como:
//   <input name="__RequestVerificationToken" type="hidden" value="XYZ..." />
const ANTIFORGERY_RE = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i;

// URL de MM/DD/YYYY 00:00:00 URL-encoded (formato que o AgileReport aceita —
// herança do parser de datas americano do ASP.NET no controller).
function toAgileDateParam(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return encodeURIComponent(`${m}/${d}/${y} 00:00:00`);
}

// Cookie jar minimalista: só o par nome=valor, sem domain/path (fica implícito
// pelo escopo do AgileReport). Serializa como header Cookie manual.
class CookieJar {
  constructor() {
    this.jar = new Map();
  }
  ingest(setCookieHeader) {
    if (!setCookieHeader) return;
    // fetch retorna Set-Cookie concatenado com vírgula em Node — precisa
    // separar corretamente evitando quebrar em vírgulas dentro de `expires=`.
    const cookies = splitSetCookie(setCookieHeader);
    for (const raw of cookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      this.jar.set(name, value);
    }
  }
  header() {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function splitSetCookie(header) {
  const out = [];
  let cur = "";
  let inExpires = false;
  for (let i = 0; i < header.length; i += 1) {
    const c = header[i];
    if (c === "," && !inExpires) {
      out.push(cur);
      cur = "";
      inExpires = false;
      continue;
    }
    cur += c;
    // Heurística: `expires=Wed, DD Mon...` — só ignora vírgula quando
    // sabemos que estamos no meio de um expires.
    const tail = cur.slice(-10).toLowerCase();
    if (tail.includes("expires=")) inExpires = true;
    if (c === ";") inExpires = false;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export class AgileClient {
  constructor({ baseUrl, usuario, senha }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.usuario = usuario;
    this.senha = senha;
    this.jar = new CookieJar();
    this.loggedIn = false;
  }

  async #request(pathOrUrl, init = {}) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const headers = new Headers(init.headers ?? {});
    const cookieHeader = this.jar.header();
    if (cookieHeader) headers.set("Cookie", cookieHeader);
    // Segue redirects manualmente pra preservar cookies em cada hop.
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    this.jar.ingest(response.headers.get("set-cookie"));
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (location) {
        const next = location.startsWith("http") ? location : `${this.baseUrl}${location}`;
        return this.#request(next, { method: "GET" });
      }
    }
    return response;
  }

  async login() {
    if (this.loggedIn) return;
    logger.info("Agile: obtendo página de login para AntiForgery token");
    const loginPageRes = await this.#request("/Conta/Login", { method: "GET" });
    if (loginPageRes.status !== 200) {
      throw new Error(`Falha ao abrir /Conta/Login: HTTP ${loginPageRes.status}`);
    }
    const html = await loginPageRes.text();
    const tokenMatch = ANTIFORGERY_RE.exec(html);
    const token = tokenMatch?.[1] ?? null;

    // O AgileReport aceita um <select> de usuários — o valor postado é o
    // nome do usuário. Mantemos "SISTEMA" por padrão (mesma opção default
    // que apareceu no formulário).
    const body = new URLSearchParams();
    body.set("Usuario", this.usuario);
    body.set("Senha", this.senha);
    if (token) body.set("__RequestVerificationToken", token);

    logger.info("Agile: enviando credenciais");
    const loginRes = await this.#request("/Conta/Login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    // Login bem-sucedido sempre redireciona (302 → home). Nosso #request
    // segue o redirect, então o status final é 200 na home ou em qualquer
    // outra página. Erro de credencial retorna 200 com a mesma página de
    // login recarregada (com mensagem). Detectamos por presença do cookie
    // de sessão .ASPXAUTH ou similar.
    const hasAuthCookie = Array.from(this.jar.jar.keys()).some((name) =>
      /ASPXAUTH|ASP\.NET_SessionId/i.test(name)
    );
    if (loginRes.status >= 400 || !hasAuthCookie) {
      const text = await loginRes.text().catch(() => "");
      throw new Error(`Login no AgileReport falhou (HTTP ${loginRes.status}). ${text.slice(0, 200)}`);
    }
    this.loggedIn = true;
    logger.info("Agile: sessão autenticada");
  }

  async downloadCsv(kind, isoStart, isoEnd) {
    await this.login();
    const gerarParam = { faturamento: "gerarFaturamento", meios: "gerarMeios", produtos: "gerarProdutos" }[kind];
    if (!gerarParam) throw new Error(`kind inválido: ${kind}`);
    const url = `${this.baseUrl}/Relatorios/RelExportarDadosDeVendas`
      + `?dataInicial=${toAgileDateParam(isoStart)}`
      + `&dataFinal=${toAgileDateParam(isoEnd)}`
      + `&${gerarParam}=True`;

    logger.info(`Agile: baixando CSV ${kind}`, { isoStart, isoEnd });
    const response = await this.#request(url, { method: "GET" });
    if (response.status !== 200) {
      throw new Error(`Download ${kind} falhou: HTTP ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    // UTF-16 LE com BOM (0xFF 0xFE nos 2 primeiros bytes).
    const text = new TextDecoder("utf-16le").decode(buffer).replace(/^﻿/, "");
    return text;
  }
}
