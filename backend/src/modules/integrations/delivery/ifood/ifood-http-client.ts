import { prisma } from "../../../../config/database.js";

// Cliente HTTP para a API iFood Merchant/Financial.
// Escopo Fase 2: OAuth2 client_credentials + cache de token em memória e no DB.
// Base URL única: iFood usa o mesmo endpoint pra sandbox e produção — o ambiente
// é definido pelo app cadastrado no developer.ifood.com.br.

const IFOOD_BASE_URL = "https://merchant-api.ifood.com.br";
const TOKEN_ENDPOINT = "/authentication/v1.0/oauth/token";
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000; // renovar 1min antes do expirar

// Cache em memória — sobrevive entre chamadas do mesmo processo Node.
// Não é distribuído (ok pra 1 instância Render), mas espelha o DB pra fallback.
type CachedToken = {
  accessToken: string;
  expiresAt: number; // epoch ms
};
let inMemoryToken: CachedToken | null = null;

export type IfoodApiError = {
  status: number;
  message: string;
  detail: string | null;
  isAuthError: boolean;
  isRateLimit: boolean;
};

export class IfoodApiException extends Error {
  public readonly info: IfoodApiError;
  constructor(info: IfoodApiError) {
    super(info.message);
    this.name = "IfoodApiException";
    this.info = info;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readError(response: Response): Promise<IfoodApiError> {
  const rawText = await response.text().catch(() => "");
  let detail: string | null = null;
  if (rawText) {
    try {
      const body = JSON.parse(rawText) as Record<string, unknown>;
      // iFood usa vários formatos: {error_description}, {message}, {error},
      // {errors:[{code,message}]}, {detail}. Coletamos tudo relevante.
      const parts: string[] = [];
      if (typeof body.error_description === "string") parts.push(body.error_description);
      if (typeof body.message === "string") parts.push(body.message);
      if (typeof body.error === "string") parts.push(body.error);
      if (typeof body.detail === "string") parts.push(body.detail);
      if (Array.isArray(body.errors)) {
        for (const err of body.errors) {
          if (err && typeof err === "object") {
            const e = err as { code?: string; message?: string; field?: string };
            const chunk = [e.code, e.field, e.message].filter(Boolean).join(": ");
            if (chunk) parts.push(chunk);
          } else if (typeof err === "string") {
            parts.push(err);
          }
        }
      }
      detail = parts.length > 0 ? parts.join(" | ") : JSON.stringify(body).slice(0, 500);
    } catch {
      detail = rawText.slice(0, 500);
    }
  }
  const isAuthError = response.status === 401 || response.status === 403;
  const isRateLimit = response.status === 429;
  const message = isAuthError
    ? "Credencial iFood inválida ou sem permissão para este recurso."
    : isRateLimit
      ? "iFood retornou 429 (rate limit). Tente novamente em instantes."
      : `iFood retornou HTTP ${response.status}.`;
  return { status: response.status, message, detail, isAuthError, isRateLimit };
}

async function requestAccessToken(clientId: string, clientSecret: string): Promise<CachedToken> {
  // iFood exige application/x-www-form-urlencoded neste endpoint, NÃO JSON.
  const body = new URLSearchParams({
    grantType: "client_credentials",
    clientId,
    clientSecret
  });
  const response = await fetchWithTimeout(`${IFOOD_BASE_URL}${TOKEN_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: body.toString()
  });
  if (!response.ok) {
    throw new IfoodApiException(await readError(response));
  }
  const payload = await response.json() as { accessToken?: string; expiresIn?: number };
  if (!payload.accessToken || typeof payload.expiresIn !== "number") {
    throw new IfoodApiException({
      status: 502,
      message: "Resposta OAuth do iFood veio em formato inesperado.",
      detail: JSON.stringify(payload).slice(0, 300),
      isAuthError: false,
      isRateLimit: false
    });
  }
  return {
    accessToken: payload.accessToken,
    expiresAt: Date.now() + payload.expiresIn * 1000
  };
}

async function loadCredential() {
  const cred = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  if (!cred) {
    throw new IfoodApiException({
      status: 412,
      message: "Credencial iFood não configurada.",
      detail: "Cadastre clientId e clientSecret em /configuracoes/integracoes/ifood antes de sincronizar.",
      isAuthError: true,
      isRateLimit: false
    });
  }
  return cred;
}

export async function hasValidCredential(): Promise<boolean> {
  const cred = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  return Boolean(cred?.clientId && cred?.clientSecret);
}

export async function getAccessToken(force = false): Promise<string> {
  if (!force && inMemoryToken && inMemoryToken.expiresAt - Date.now() > TOKEN_SAFETY_MARGIN_MS) {
    return inMemoryToken.accessToken;
  }
  const cred = await loadCredential();
  const token = await requestAccessToken(cred.clientId, cred.clientSecret);
  inMemoryToken = token;
  await prisma.ifoodCredential.update({
    where: { id: cred.id },
    data: { lastTokenAt: new Date() }
  });
  return token.accessToken;
}

export type IfoodRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

// Enquanto a credencial estiver em SANDBOX o iFood exige o header
// `x-request-homologation: true` — é como eles contabilizam as chamadas
// da homologação e validam os cenários. Em PRODUCTION o header não vai.
async function homologationHeaders(): Promise<Record<string, string>> {
  const cred = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  if (cred?.environment === "SANDBOX") {
    return { "x-request-homologation": "true" };
  }
  return {};
}

export async function callIfood<T>(options: IfoodRequestOptions): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${IFOOD_BASE_URL}${options.path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const homologHeaders = await homologationHeaders();
  const response = await fetchWithTimeout(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...homologHeaders,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 401) {
    // Token pode ter expirado antes da margem — tenta 1x com token novo.
    inMemoryToken = null;
    const retryToken = await getAccessToken(true);
    const retry = await fetchWithTimeout(url.toString(), {
      method: options.method ?? "GET",
      headers: {
        "Authorization": `Bearer ${retryToken}`,
        "Accept": "application/json",
        ...homologHeaders,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!retry.ok) throw new IfoodApiException(await readError(retry));
    return parseIfoodBody<T>(retry);
  }
  if (!response.ok) throw new IfoodApiException(await readError(response));
  return parseIfoodBody<T>(response);
}

// iFood às vezes devolve 200/204 com corpo vazio quando não há dados no período.
// response.json() nesse caso lança "Unexpected end of JSON input". Normalizamos
// pra array vazio (o chamador espera lista ou objeto {sales:[]}).
async function parseIfoodBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return [] as T;
  const text = await response.text();
  if (!text || text.trim().length === 0) return [] as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return [] as T;
  }
}

// Diagnóstico de conexão: tenta autenticar e devolve resultado estruturado.
// Não persiste nada — só valida se as credenciais salvas conseguem obter token.
export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  tokenPreview: string | null;
  expiresInSeconds: number | null;
  errorDetail: string | null;
  environment: "PRODUCTION" | "SANDBOX" | null;
};

export async function testIfoodConnection(): Promise<ConnectionTestResult> {
  const cred = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  if (!cred) {
    return {
      ok: false,
      message: "Credencial iFood não configurada. Preencha clientId e clientSecret primeiro.",
      tokenPreview: null,
      expiresInSeconds: null,
      errorDetail: null,
      environment: null
    };
  }
  try {
    inMemoryToken = null; // força ida ao iFood, ignora cache
    const token = await requestAccessToken(cred.clientId, cred.clientSecret);
    inMemoryToken = token;
    await prisma.ifoodCredential.update({
      where: { id: cred.id },
      data: { lastTokenAt: new Date() }
    });
    return {
      ok: true,
      message: "Conexão OK. iFood aceitou as credenciais e devolveu token de acesso.",
      tokenPreview: `${token.accessToken.slice(0, 12)}...${token.accessToken.slice(-4)}`,
      expiresInSeconds: Math.floor((token.expiresAt - Date.now()) / 1000),
      errorDetail: null,
      environment: cred.environment as "PRODUCTION" | "SANDBOX"
    };
  } catch (error: unknown) {
    if (error instanceof IfoodApiException) {
      return {
        ok: false,
        message: error.info.message,
        tokenPreview: null,
        expiresInSeconds: null,
        errorDetail: error.info.detail,
        environment: cred.environment as "PRODUCTION" | "SANDBOX"
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Erro desconhecido ao testar conexão.",
      tokenPreview: null,
      expiresInSeconds: null,
      errorDetail: null,
      environment: cred.environment as "PRODUCTION" | "SANDBOX"
    };
  }
}
