import { prisma } from "../../../../config/database.js";

// Cliente HTTP para a DiDi Food Open Platform (99 Food no Brasil).
// Base URL: openapi.didi-food.com (produção). Sandbox só depois de
// aprovação em developer-food.99app.com.
//
// Modelo de auth da DiDi difere do iFood:
//   - app_id + app_secret: credencial global do integrador (nossa) —
//     armazenada em NoventaNoveCredential
//   - authtoken por loja: gerado por (app_id, app_secret, app_shop_id),
//     com validade e refresh — armazenado em NoventaNoveShopAuthToken
//
// ATENÇÃO — TODOs até sandbox liberar:
//   1. Algoritmo de assinatura (sign+timestamp) usado em rotas como
//      /v1/shop/shop/list ainda não está mapeado neste código. Está
//      documentado na página HTML "Before Coding" do portal, não no YAML.
//      Marcar como TODO — implementar quando sandbox der 401.
//   2. IDs long 64-bit (app_id, shop_id, order_id) circulam SEMPRE como
//      string. Nunca converter pra Number no TS (perde precisão >2^53).

const DIDI_FOOD_BASE_URL = "https://openapi.didi-food.com";
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // renova 5min antes do expirar

export type NoventaNoveApiError = {
  status: number;
  errno: number | null;
  message: string;
  detail: string | null;
  isAuthError: boolean;
  isRateLimit: boolean;
};

export class NoventaNoveApiException extends Error {
  public readonly info: NoventaNoveApiError;
  constructor(info: NoventaNoveApiError) {
    super(info.message);
    this.name = "NoventaNoveApiException";
    this.info = info;
  }
}

// StandardResponse do DiDi tem sempre { errno, errmsg, requestId, time }.
// errno === 0 significa sucesso.
type StandardResponse<T> = {
  errno: number;
  errmsg: string;
  requestId?: string;
  time?: number;
  data?: T;
};

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const isHttpError = !response.ok;

  let payload: StandardResponse<T> | null = null;
  if (text && text.trim().length > 0) {
    try {
      payload = JSON.parse(text) as StandardResponse<T>;
    } catch {
      // Fall through — trata como erro HTTP puro abaixo
    }
  }

  if (isHttpError || (payload && payload.errno !== 0)) {
    const errno = payload?.errno ?? null;
    const errmsg = payload?.errmsg ?? `HTTP ${response.status}`;
    const isAuthError = response.status === 401 || response.status === 403 || errno === 1001 || errno === 1002;
    const isRateLimit = response.status === 429;
    throw new NoventaNoveApiException({
      status: response.status,
      errno,
      message: isAuthError
        ? "Autenticação 99 Food falhou. Verifique app_id/app_secret ou o authtoken da loja."
        : isRateLimit
          ? "99 Food retornou 429 (rate limit). Tente novamente em instantes."
          : `99 Food retornou erro: ${errmsg}`,
      detail: text.slice(0, 500) || null,
      isAuthError,
      isRateLimit
    });
  }

  if (!payload) {
    return [] as unknown as T;
  }
  return (payload.data ?? ([] as unknown as T));
}

async function loadCredential() {
  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (!cred) {
    throw new NoventaNoveApiException({
      status: 412,
      errno: null,
      message: "Credencial 99 Food não configurada.",
      detail: "Cadastre app_id (clientId) e app_secret em Configurações → Delivery → 99 Food.",
      isAuthError: true,
      isRateLimit: false
    });
  }
  return cred;
}

export async function hasValidCredential(): Promise<boolean> {
  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  return Boolean(cred?.clientId && cred?.clientSecret);
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

// GET /v1/auth/authtoken/get — retorna o token corrente pra loja.
// Se estiver expirado ou não existir, o backend responde com errno específico
// e chamamos /refresh antes. Chamamos sempre com params na query.
export async function fetchAuthToken(appShopId: string): Promise<{ authToken: string; expirationTime: Date }> {
  const cred = await loadCredential();
  const params = new URLSearchParams({
    app_id: cred.clientId,
    app_secret: cred.clientSecret,
    app_shop_id: appShopId
  });
  const url = `${DIDI_FOOD_BASE_URL}/v1/auth/authtoken/get?${params.toString()}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });
  const data = await parseResponse<{
    app_id?: number | string;
    app_shop_id?: string;
    auth_token?: string;
    token_expiration_time?: number;
  }>(response);
  if (!data.auth_token || typeof data.token_expiration_time !== "number") {
    throw new NoventaNoveApiException({
      status: 502,
      errno: null,
      message: "Resposta authtoken/get do 99 Food veio em formato inesperado.",
      detail: JSON.stringify(data).slice(0, 300),
      isAuthError: false,
      isRateLimit: false
    });
  }
  return {
    authToken: data.auth_token,
    expirationTime: new Date(data.token_expiration_time * 1000)
  };
}

// GET /v1/auth/authtoken/refresh — sempre gera token novo. Após refresh
// precisa chamar /get pra pegar o token.
export async function refreshAuthToken(appShopId: string): Promise<void> {
  const cred = await loadCredential();
  const params = new URLSearchParams({
    app_id: cred.clientId,
    app_secret: cred.clientSecret,
    app_shop_id: appShopId
  });
  const url = `${DIDI_FOOD_BASE_URL}/v1/auth/authtoken/refresh?${params.toString()}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });
  await parseResponse<unknown>(response);
}

// POST /v1/auth/authorizationpage/getUrl — gera URL que a loja abre no
// navegador pra autorizar o bind (loja → nosso app_shop_id). É o
// equivalente ao "authorization code" do OAuth2 do iFood, mas em URL única
// que o dono da loja acessa e confirma.
export async function fetchAuthorizationPageUrl(appShopId: string): Promise<string> {
  const cred = await loadCredential();
  const response = await fetchWithTimeout(`${DIDI_FOOD_BASE_URL}/v1/auth/authorizationpage/getUrl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      app_id: cred.clientId,
      app_shop_id: appShopId
    })
  });
  const data = await parseResponse<string | string[]>(response);
  // YAML mostra que "data" pode vir como array de 1 URL. Normalizamos.
  const url = Array.isArray(data) ? data[0] : data;
  if (typeof url !== "string" || url.length === 0) {
    throw new NoventaNoveApiException({
      status: 502,
      errno: null,
      message: "Resposta authorizationpage/getUrl veio em formato inesperado.",
      detail: JSON.stringify(data).slice(0, 300),
      isAuthError: false,
      isRateLimit: false
    });
  }
  return url;
}

// ---------------------------------------------------------------------------
// Token cache por loja
// ---------------------------------------------------------------------------

// Retorna authtoken válido pra loja. Se estiver expirado (ou por expirar
// em <5min), tenta /get primeiro (caso token já exista no servidor). Só
// chama /refresh se o /get falhar por token inexistente ou expirado —
// evita "The store authorization information does not exist" em lojas
// recém-criadas onde /refresh não tem authorization pra refreshar.
export async function getShopAuthToken(deliveryStoreId: string, appShopId: string): Promise<string> {
  const cached = await prisma.noventaNoveShopAuthToken.findUnique({
    where: { deliveryStoreId }
  });
  const now = Date.now();
  if (cached && cached.expiresAt.getTime() - now > TOKEN_REFRESH_MARGIN_MS) {
    return cached.authToken;
  }
  // Precisa novo token — tenta /get direto; se falhar, refresh + get
  let authToken: string;
  let expirationTime: Date;
  try {
    ({ authToken, expirationTime } = await fetchAuthToken(appShopId));
  } catch (getError: unknown) {
    if (getError instanceof NoventaNoveApiException && !getError.info.isAuthError) {
      throw getError;
    }
    await refreshAuthToken(appShopId);
    ({ authToken, expirationTime } = await fetchAuthToken(appShopId));
  }
  await prisma.noventaNoveShopAuthToken.upsert({
    where: { deliveryStoreId },
    create: {
      deliveryStoreId,
      authToken,
      expiresAt: expirationTime,
      refreshedAt: new Date()
    },
    update: {
      authToken,
      expiresAt: expirationTime,
      refreshedAt: new Date()
    }
  });
  return authToken;
}

// ---------------------------------------------------------------------------
// Chamada genérica por loja
// ---------------------------------------------------------------------------

export type NoventaNoveRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

// Chama qualquer endpoint que usa auth_token na query string.
// Rotas que usam sign+timestamp+app_id (list all stores, etc.) NÃO passam
// por aqui — precisam do algoritmo de assinatura que ainda está pendente
// de doc HTML.
// Alguns endpoints da DiDi (ex: /v1/item/item/upload) exigem auth_token
// no BODY, não na query. Se o body for objeto, injetamos automaticamente.
function bodyWithAuthToken(body: unknown, token: string): unknown {
  if (body === null || body === undefined) return undefined;
  if (typeof body !== "object") return body;
  return { auth_token: token, ...(body as Record<string, unknown>) };
}

export async function callNoventaNoveShop<T>(
  deliveryStoreId: string,
  appShopId: string,
  options: NoventaNoveRequestOptions
): Promise<T> {
  const token = await getShopAuthToken(deliveryStoreId, appShopId);
  const url = new URL(`${DIDI_FOOD_BASE_URL}${options.path}`);
  url.searchParams.set("auth_token", token);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const requestBody = bodyWithAuthToken(options.body, token);
  const response = await fetchWithTimeout(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "Accept": "application/json",
      ...(requestBody ? { "Content-Type": "application/json" } : {})
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined
  });
  // Se 401, invalida cache e tenta 1x mais
  if (response.status === 401) {
    await prisma.noventaNoveShopAuthToken.deleteMany({ where: { deliveryStoreId } });
    const freshToken = await getShopAuthToken(deliveryStoreId, appShopId);
    const retryUrl = new URL(`${DIDI_FOOD_BASE_URL}${options.path}`);
    retryUrl.searchParams.set("auth_token", freshToken);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) retryUrl.searchParams.set(key, String(value));
      }
    }
    const retryBody = bodyWithAuthToken(options.body, freshToken);
    const retry = await fetchWithTimeout(retryUrl.toString(), {
      method: options.method ?? "GET",
      headers: {
        "Accept": "application/json",
        ...(retryBody ? { "Content-Type": "application/json" } : {})
      },
      body: retryBody ? JSON.stringify(retryBody) : undefined
    });
    return parseResponse<T>(retry);
  }
  return parseResponse<T>(response);
}

// ---------------------------------------------------------------------------
// Teste de conexão — usado pela tela de settings
// ---------------------------------------------------------------------------

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  tokenPreview: string | null;
  expiresInSeconds: number | null;
  errorDetail: string | null;
  environment: "PRODUCTION" | "SANDBOX" | null;
  testedShopId: string | null;
};

// Testa a credencial global tentando gerar authtoken pra primeira loja
// ativa com externalId real (não PENDENTE-*). Se todas estão PENDENTE,
// avisa que precisa cadastrar app_shop_id primeiro.
export async function testNoventaNoveConnection(): Promise<ConnectionTestResult> {
  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (!cred) {
    return {
      ok: false,
      message: "Credencial 99 Food não configurada. Preencha app_id e app_secret primeiro.",
      tokenPreview: null,
      expiresInSeconds: null,
      errorDetail: null,
      environment: null,
      testedShopId: null
    };
  }
  const testStore = await prisma.deliveryStore.findFirst({
    where: {
      platform: "NOVENTA_NOVE",
      active: true,
      NOT: { externalId: { startsWith: "PENDENTE-" } }
    },
    orderBy: { createdAt: "asc" }
  });
  if (!testStore) {
    return {
      ok: false,
      message: "Nenhuma loja com app_shop_id real cadastrada. Substitua os PENDENTE-99-* pelos IDs reais depois de vincular no portal do 99 Food.",
      tokenPreview: null,
      expiresInSeconds: null,
      errorDetail: null,
      environment: cred.environment as "PRODUCTION" | "SANDBOX",
      testedShopId: null
    };
  }
  try {
    // Ordem correta:
    //   1. Tenta /authtoken/get — se a loja já tem token válido (caso de
    //      estabelecimento de teste criado pelo portal, ou loja em prod
    //      já bindada), retorna direto.
    //   2. Se /get falhar por token expirado/inexistente, tenta /refresh
    //      + /get. Se /refresh falhar com "The store authorization
    //      information does not exist", significa que a loja não está
    //      bindada — precisa passar por /authorizationpage/getUrl.
    let authToken: string;
    let expirationTime: Date;
    try {
      ({ authToken, expirationTime } = await fetchAuthToken(testStore.externalId));
    } catch (getError: unknown) {
      // /get pode falhar por várias razões:
      //   - token expirado ("The store authorization information has expired")
      //   - token nunca gerado
      //   - loja recém-bindada sem token corrente
      // Em qualquer caso o /refresh cria/renova o token, e /get retorna.
      // Se /refresh também falhar (ex: loja não bindada), propaga.
      await refreshAuthToken(testStore.externalId);
      ({ authToken, expirationTime } = await fetchAuthToken(testStore.externalId));
      // Se getError era irrecuperável (loja não bindada), /refresh já
      // teria falhado com "authorization does not exist" e essa linha
      // nunca é alcançada.
      void getError;
    }
    await prisma.noventaNoveShopAuthToken.upsert({
      where: { deliveryStoreId: testStore.id },
      create: {
        deliveryStoreId: testStore.id,
        authToken,
        expiresAt: expirationTime,
        refreshedAt: new Date()
      },
      update: {
        authToken,
        expiresAt: expirationTime,
        refreshedAt: new Date()
      }
    });
    await prisma.noventaNoveCredential.update({
      where: { id: cred.id },
      data: { lastTokenAt: new Date() }
    });
    return {
      ok: true,
      message: `Conexão OK. 99 Food emitiu authtoken válido para a loja "${testStore.nickname}".`,
      tokenPreview: `${authToken.slice(0, 12)}...${authToken.slice(-4)}`,
      expiresInSeconds: Math.max(0, Math.floor((expirationTime.getTime() - Date.now()) / 1000)),
      errorDetail: null,
      environment: cred.environment as "PRODUCTION" | "SANDBOX",
      testedShopId: testStore.externalId
    };
  } catch (error: unknown) {
    if (error instanceof NoventaNoveApiException) {
      return {
        ok: false,
        message: error.info.message,
        tokenPreview: null,
        expiresInSeconds: null,
        errorDetail: error.info.detail,
        environment: cred.environment as "PRODUCTION" | "SANDBOX",
        testedShopId: testStore.externalId
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Erro desconhecido ao testar conexão.",
      tokenPreview: null,
      expiresInSeconds: null,
      errorDetail: null,
      environment: cred.environment as "PRODUCTION" | "SANDBOX",
      testedShopId: testStore.externalId
    };
  }
}
