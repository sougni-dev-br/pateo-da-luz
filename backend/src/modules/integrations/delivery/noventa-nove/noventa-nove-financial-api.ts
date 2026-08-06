import { prisma } from "../../../../config/database.js";
import { NoventaNoveApiException } from "./noventa-nove-http-client.js";

// Cliente da Financial API do 99 Food (DiDi).
//
// ATENÇÃO — este cliente é SEPARADO do noventa-nove-http-client.ts:
//   - Host diferente: `openapi.99food.com` (os endpoints de pedido usam
//     `openapi.didi-food.com`).
//   - Auth diferente: Bearer accessToken de NÍVEL DE APP, obtido via
//     /v3/auth/authtoken/signIn — NÃO é o auth_token por-loja dos pedidos.
//     (Confirmado pela 99 em chamado 2026-08: "o token exigido é diferente
//     do token requerido pelos endpoints de pedidos".)
//
// Whitelist: a doc marca os endpoints como "WhiteList", mas a 99 confirmou
// que para lojas vinculadas somente ao nosso app nenhuma liberação é
// necessária — basta consumir com o token financeiro.
//
// Doc completa capturada em docs/99food/financial-api.md.
//
// Unidades: todos os valores monetários vêm em INT (centavos). commissionRate
// vem em base 10000 (3500 = 35,00%). Este cliente NÃO converte — devolve o
// payload cru; a conversão fica no serviço de sync/DRE (passo 2).

const NOVENTA_NOVE_FINANCE_BASE_URL = "https://openapi.99food.com";
const FINANCE_REQUEST_TIMEOUT_MS = 30_000;
const FINANCE_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // renova 5min antes de expirar
const FINANCE_DEFAULT_PAGE_SIZE = 200; // máximo permitido pela 99
const FINANCE_MAX_PAGES = 200; // guarda contra loop de paginação infinito

// ---------------------------------------------------------------------------
// Tipos — resposta
// ---------------------------------------------------------------------------

// Data model do getShopBillWeek (repasse semanal). Campos vêm em camelCase.
// ⚠️ shopId vem como number 64-bit no JSON — pode perder precisão em
// JSON.parse. NÃO usar shopId numérico como chave; a chave estável é o
// acceptor_code (app_shop_id) que NÓS enviamos, ou weekPaymentId (string).
export type NoventaNoveSettlement = {
  weekPaymentId: string;
  withdrawDate: string; // ISO-8601
  withdrawAmount: number; // centavos
  liability: string;
  shopId: number;
  settleStartDate: string; // YYYYMMDD
  settleEndDate: string; // YYYYMMDD
  currency: string;
  dayPaymentIDList: string[];
};

// Data model do getShopBillDetail (detalhe diário por pedido). Só campos
// relevantes p/ reconciliação e DRE estão tipados; os demais da doc ficam
// como opcionais quando necessário. Valores em centavos.
export type NoventaNoveBillDetail = {
  shopId: number; // ⚠️ ver aviso de precisão acima
  shopName?: string;
  contractorId?: number;
  contractorName?: string;
  orderId: string; // chave de reconciliação com o callback orderNew
  orderIndex?: string;
  orderType: number; // 1-receita; 2-refund total; 3-refund parcial; 4-refund pós-venda; 5-non-accompanying/monthly fee
  deliveryType?: number;
  businessTs?: number;
  businessDateTime?: string;
  mealOriginalAmount?: number;
  shopActivityOutcome?: number; // custo da loja em descontos de item (negativo)
  commissionBaseAmount?: number;
  commissionRate?: number; // base 10000 → 3500 = 35,00%
  commissionAmount?: number; // comissão cobrada pela plataforma
  commissionSubsidyAmount?: number;
  b2pDeliveryAmount?: number;
  payCommissionAmount?: number;
  orderAmount?: number;
  paymentMethod?: number;
  paymentChannel?: number;
  settlementAmount: number; // valor final a repassar à loja nesta transação
  expectSettleDate?: string; // ISO-8601
  dayPaymentId?: string; // liga com dayPaymentIDList do settlement
  vatAmount?: number;
  mealLossDeductAmount?: number;
  merchantAppealAmount?: number;
  cancelTs?: number;
  cancelDateTime?: string;
  cancelReason?: number;
};

// ---------------------------------------------------------------------------
// Tipos — parâmetros
// ---------------------------------------------------------------------------

// Ambos os endpoints financeiros usam o mesmo shape de body.
export type NoventaNoveFinancePeriodParams = {
  appShopId: string; // acceptor_code
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD
};

// ---------------------------------------------------------------------------
// Infra HTTP
// ---------------------------------------------------------------------------

// Envelope padrão dos endpoints /v3/finance: { errno, errmsg, requestId,
// time, data: { data: [], total_num, total_page, page_size, page_no } }.
type FinanceEnvelope<T> = {
  errno?: number;
  errmsg?: string;
  requestId?: string;
  time?: number;
  data?: {
    data?: T[];
    total_num?: number;
    total_page?: number;
    page_size?: number;
    page_no?: number;
  };
};

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FINANCE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadActiveCredential() {
  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (!cred?.clientId || !cred?.clientSecret) {
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

// Mapeia errno conhecido da Financial API para mensagem PT amigável.
function financeErrorMessage(errno: number | null, errmsg: string): string {
  switch (errno) {
    case 110004:
      return "99 Food: consulta fora do intervalo — só há dados dos últimos 3 meses.";
    case 110005:
      return "99 Food: intervalo máximo por consulta é de 31 dias.";
    case 110006:
      return "99 Food: a data inicial do período não pode ser maior que a final.";
    case 110002:
    case 110003:
      return "99 Food: formato de data inválido (esperado YYYYMMDD).";
    case 10002:
      return "99 Food: parâmetro inválido na consulta financeira.";
    case 10001:
      return "99 Food: erro interno da plataforma na consulta financeira.";
    default:
      return `99 Food retornou erro financeiro: ${errmsg}`;
  }
}

// ---------------------------------------------------------------------------
// Auth — accessToken de nível de app (cacheado em memória)
// ---------------------------------------------------------------------------

// O accessToken financeiro é único por app (não por loja) e expira em ~6h.
// Cache em memória (processo único no Render Starter) evita bater no signIn
// a cada chamada. Se o backend escalar p/ múltiplas instâncias, migrar p/
// tabela dedicada.
let cachedFinanceToken: { accessToken: string; expiresAt: number } | null = null;

async function signInFinancial(): Promise<{ accessToken: string; expiresIn: number }> {
  const cred = await loadActiveCredential();
  const response = await fetchWithTimeout(`${NOVENTA_NOVE_FINANCE_BASE_URL}/v3/auth/authtoken/signIn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ retailer: cred.clientId, secret: cred.clientSecret })
  });
  const text = await response.text();
  let payload: { accessToken?: string; expiresIn?: number; errno?: number; errmsg?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.accessToken) {
    const errno = payload?.errno ?? null;
    const isAuthError = response.status === 401 || response.status === 403;
    throw new NoventaNoveApiException({
      status: response.status,
      errno,
      message: isAuthError
        ? "Autenticação da Financial API 99 Food falhou. Verifique app_id/app_secret."
        : `Falha ao obter accessToken financeiro do 99 Food: ${payload?.errmsg ?? `HTTP ${response.status}`}`,
      detail: text.slice(0, 300) || null,
      isAuthError,
      isRateLimit: response.status === 429
    });
  }
  return { accessToken: payload.accessToken, expiresIn: payload.expiresIn ?? 21600 };
}

// Retorna um accessToken financeiro válido, renovando quando faltar <5min
// para expirar. `forceRefresh` ignora o cache (usado em retry pós-401).
export async function getFinancialAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedFinanceToken && cachedFinanceToken.expiresAt - now > FINANCE_TOKEN_REFRESH_MARGIN_MS) {
    return cachedFinanceToken.accessToken;
  }
  const { accessToken, expiresIn } = await signInFinancial();
  cachedFinanceToken = { accessToken, expiresAt: now + expiresIn * 1000 };
  return accessToken;
}

// ---------------------------------------------------------------------------
// Chamada genérica a um endpoint /v3/finance com paginação agregada
// ---------------------------------------------------------------------------

// Faz POST autenticado e devolve UMA página do envelope financeiro. Em 401,
// renova o token uma vez e repete. Erro de negócio (errno !== 0) vira exceção.
async function fetchFinancePage<T>(
  path: string,
  body: Record<string, unknown>,
  pageNo: number,
  pageSize: number
): Promise<FinanceEnvelope<T>["data"]> {
  const requestBody = { ...body, page_no: pageNo, page_size: pageSize };

  const doRequest = async (token: string): Promise<Response> =>
    fetchWithTimeout(`${NOVENTA_NOVE_FINANCE_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(requestBody)
    });

  let token = await getFinancialAccessToken();
  let response = await doRequest(token);
  if (response.status === 401) {
    token = await getFinancialAccessToken(true);
    response = await doRequest(token);
  }

  const text = await response.text();
  let payload: FinanceEnvelope<T> | null = null;
  if (text && text.trim().length > 0) {
    try {
      payload = JSON.parse(text) as FinanceEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  const errno = payload?.errno ?? null;
  if (!response.ok || (payload && errno !== 0 && errno !== null)) {
    const isAuthError = response.status === 401 || response.status === 403;
    const isRateLimit = response.status === 429;
    throw new NoventaNoveApiException({
      status: response.status,
      errno,
      message: isRateLimit
        ? "99 Food retornou 429 (rate limit) na Financial API. Tente novamente em instantes."
        : financeErrorMessage(errno, payload?.errmsg ?? `HTTP ${response.status}`),
      detail: text.slice(0, 500) || null,
      isAuthError,
      isRateLimit
    });
  }

  return payload?.data ?? { data: [], total_num: 0, total_page: 0, page_size: pageSize, page_no: pageNo };
}

// Percorre todas as páginas de um endpoint financeiro e agrega os itens.
async function fetchAllPages<T>(path: string, body: Record<string, unknown>): Promise<T[]> {
  const items: T[] = [];
  let pageNo = 1;
  let totalPage = 1;
  do {
    const page = await fetchFinancePage<T>(path, body, pageNo, FINANCE_DEFAULT_PAGE_SIZE);
    if (page?.data?.length) items.push(...page.data);
    totalPage = page?.total_page ?? 1;
    pageNo += 1;
  } while (pageNo <= totalPage && pageNo <= FINANCE_MAX_PAGES);
  return items;
}

// ---------------------------------------------------------------------------
// Endpoints públicos do cliente
// ---------------------------------------------------------------------------

// Get Settlements Data — repasse semanal por loja (getShopBillWeek).
// Agrega todas as páginas do período. Janela máx 31 dias / 3 meses.
export async function getSettlements(params: NoventaNoveFinancePeriodParams): Promise<NoventaNoveSettlement[]> {
  return fetchAllPages<NoventaNoveSettlement>("/v3/finance/finance/getShopBillWeek", {
    acceptor_code: params.appShopId,
    start_date: params.startDate,
    end_date: params.endDate
  });
}

// Get Bill Data — detalhe diário por pedido (getShopBillDetail). Só retorna
// pedidos confirmados pela loja. Agrega todas as páginas do período.
export async function getBillDetails(params: NoventaNoveFinancePeriodParams): Promise<NoventaNoveBillDetail[]> {
  return fetchAllPages<NoventaNoveBillDetail>("/v3/finance/finance/getShopBillDetail", {
    acceptor_code: params.appShopId,
    start_date: params.startDate,
    end_date: params.endDate
  });
}

// Reexport pra quem só importa o cliente financeiro.
export { NoventaNoveApiException };
