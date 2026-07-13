import { callIfood, IfoodApiException } from "./ifood-http-client.js";

// Wrappers tipados sobre as Financial APIs v3 do iFood.
// v2.0 e v2.1 foram descontinuadas em 17/06/2025 — sempre usar v3.
// Documentação: https://developer.ifood.com.br/en-US/docs/guides/financial/v3/
// Se o iFood mudar schemas, a normalização aqui isola o restante do módulo.

export type IfoodSaleResponse = {
  id?: string;
  orderId?: string;
  createdAt?: string;
  billingType?: string;
  paymentType?: string;
  orderStatus?: string;
  competence?: string;
  billingBalance?: {
    total?: number;
    grossValue?: number;
    ifoodCommission?: number;
    promotionDiscount?: number;
    deliveryFee?: number;
    marketingIncentive?: number;
    net?: number;
    netValue?: number;
    liquidValue?: number;
  };
};

export type IfoodSettlementResponse = {
  id?: string;
  externalId?: string;
  bankReference?: string;
  status?: string;
  paymentDate?: string;
  scheduledDate?: string;
  bankAccountName?: string;
  totals?: {
    grossValue?: number;
    total?: number;
    net?: number;
    netValue?: number;
    fees?: number;
    totalFees?: number;
  };
  periodStart?: string;
  periodEnd?: string;
  competencePeriodStart?: string;
  competencePeriodEnd?: string;
};

export type IfoodMaintenanceFeeResponse = {
  id?: string;
  description?: string;
  competence?: string;
  billingDate?: string;
  amount?: number;
  value?: number;
  category?: string;
};

type SalesParams = {
  merchantId: string;
  beginSalesDate: string; // YYYY-MM-DD
  endSalesDate: string;
  page?: number;
  size?: number;
};

// v3 devolve payload paginado no formato { page, size, total, sales: [] }.
export async function getSales(params: SalesParams): Promise<IfoodSaleResponse[]> {
  const data = await callIfood<{ sales?: IfoodSaleResponse[]; content?: IfoodSaleResponse[] } | IfoodSaleResponse[]>({
    path: `/financial/v3.0/merchants/${encodeURIComponent(params.merchantId)}/sales`,
    query: {
      beginSalesDate: params.beginSalesDate,
      endSalesDate: params.endSalesDate,
      page: params.page ?? 1,
      size: params.size ?? 500
    }
  });
  if (Array.isArray(data)) return data;
  return data.sales ?? data.content ?? [];
}

type SettlementsParams = {
  merchantId: string;
  beginPaymentDate: string; // YYYY-MM-DD
  endPaymentDate: string;
};

// iFood v3 exige beginPaymentDate/endPaymentDate ou beginCalculationDate/endCalculationDate.
// Usamos payment (data em que o valor foi/será repassado à conta bancária).
export async function getSettlements(params: SettlementsParams): Promise<IfoodSettlementResponse[]> {
  const data = await callIfood<{ settlements?: IfoodSettlementResponse[]; content?: IfoodSettlementResponse[] } | IfoodSettlementResponse[]>({
    path: `/financial/v3.0/merchants/${encodeURIComponent(params.merchantId)}/settlements`,
    query: {
      beginPaymentDate: params.beginPaymentDate,
      endPaymentDate: params.endPaymentDate
    }
  });
  if (Array.isArray(data)) return data;
  return data.settlements ?? data.content ?? [];
}

type MaintenanceParams = {
  merchantId: string;
  competence: string; // YYYY-MM
};

export async function getMaintenanceFees(params: MaintenanceParams): Promise<IfoodMaintenanceFeeResponse[]> {
  const data = await callIfood<{ fees?: IfoodMaintenanceFeeResponse[]; content?: IfoodMaintenanceFeeResponse[] } | IfoodMaintenanceFeeResponse[]>({
    path: `/financial/v3.0/merchants/${encodeURIComponent(params.merchantId)}/maintenanceFees`,
    query: { competence: params.competence }
  });
  if (Array.isArray(data)) return data;
  return data.fees ?? data.content ?? [];
}

export { IfoodApiException };
