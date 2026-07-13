import { z } from "zod";

// Payload de configuração da credencial (client_id + client_secret da Integradora).
// clientSecret nunca sai de volta pro frontend em texto puro — apenas um flag
// "hasSecret: true" indicando que já foi cadastrado.
export const ifoodCredentialInputSchema = z.object({
  clientId: z.string().trim().min(8, "clientId inválido"),
  clientSecret: z.string().trim().min(8, "clientSecret inválido"),
  environment: z.enum(["PRODUCTION", "SANDBOX"]).default("PRODUCTION")
});

export type IfoodCredentialInput = z.infer<typeof ifoodCredentialInputSchema>;

// Cadastro/edição de loja iFood.
export const ifoodStoreInputSchema = z.object({
  externalId: z.string().trim().min(1, "merchantId obrigatório"),
  nickname: z.string().trim().min(1, "apelido obrigatório"),
  active: z.boolean().optional().default(true),
  companyId: z.string().trim().optional().nullable()
});

export type IfoodStoreInput = z.infer<typeof ifoodStoreInputSchema>;

export const periodQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  storeId: z.string().trim().optional()
});

export type PeriodQuery = z.infer<typeof periodQuerySchema>;

// Retornos públicos do módulo — o que a tela consome.
export type IfoodStoreView = {
  id: string;
  externalId: string;
  nickname: string;
  active: boolean;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IfoodCredentialStatusView = {
  configured: boolean;
  environment: "PRODUCTION" | "SANDBOX" | null;
  clientIdMasked: string | null;
  lastTokenAt: string | null;
};

export type IfoodDailySalesRow = {
  date: string;
  orders: number;
  grossAmount: number;
  ifoodFeeAmount: number;
  promotionAmount: number;
  deliveryFeeAmount: number;
  netAmount: number;
};

export type IfoodFeeBreakdownRow = {
  feeType: string;
  description: string | null;
  amount: number;
};

export type IfoodSettlementRow = {
  id: string;
  externalId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  paidAt: string | null;
  status: string;
};

export type IfoodPeriodSummary = {
  period: { year: number; month: number };
  storeId: string | null;
  storeLabel: string;
  totals: {
    orders: number;
    grossAmount: number;
    ifoodFeeAmount: number;
    promotionAmount: number;
    deliveryFeeAmount: number;
    netAmount: number;
    otherFees: number;
  };
  daily: IfoodDailySalesRow[];
  fees: IfoodFeeBreakdownRow[];
  settlements: IfoodSettlementRow[];
  isMock: boolean;
};

export type IfoodStatusView = {
  credential: IfoodCredentialStatusView;
  stores: IfoodStoreView[];
  lastSync: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemsProcessed: number;
    errorMessage: string | null;
  } | null;
  mockMode: boolean;
};
