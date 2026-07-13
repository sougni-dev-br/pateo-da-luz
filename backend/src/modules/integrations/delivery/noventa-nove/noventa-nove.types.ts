import { z } from "zod";

// Payload de configuração da credencial 99 Food.
// clientId + clientSecret obtidos em https://developer-food.99app.com.
// clientSecret nunca sai de volta pro frontend em texto puro — apenas um flag
// "hasSecret: true" indicando que já foi cadastrado.
export const noventaNoveCredentialInputSchema = z.object({
  clientId: z.string().trim().min(8, "clientId inválido"),
  clientSecret: z.string().trim().min(8, "clientSecret inválido"),
  environment: z.enum(["PRODUCTION", "SANDBOX"]).default("PRODUCTION")
});

export type NoventaNoveCredentialInput = z.infer<typeof noventaNoveCredentialInputSchema>;

// Cadastro/edição de loja 99 Food.
// externalId é o AppShopID emitido pelo 99 ao autorizar a loja no portal.
export const noventaNoveStoreInputSchema = z.object({
  externalId: z.string().trim().min(1, "AppShopID obrigatório"),
  nickname: z.string().trim().min(1, "apelido obrigatório"),
  active: z.boolean().optional().default(true),
  companyId: z.string().trim().optional().nullable()
});

export type NoventaNoveStoreInput = z.infer<typeof noventaNoveStoreInputSchema>;

export const periodQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  storeId: z.string().trim().optional()
});

export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export type NoventaNoveStoreView = {
  id: string;
  externalId: string;
  nickname: string;
  active: boolean;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoventaNoveCredentialStatusView = {
  configured: boolean;
  environment: "PRODUCTION" | "SANDBOX" | null;
  clientIdMasked: string | null;
  lastTokenAt: string | null;
};

export type NoventaNoveDailySalesRow = {
  date: string;
  orders: number;
  grossAmount: number;
  noventaNoveFeeAmount: number;
  promotionAmount: number;
  deliveryFeeAmount: number;
  netAmount: number;
};

export type NoventaNoveFeeBreakdownRow = {
  feeType: string;
  description: string | null;
  amount: number;
};

export type NoventaNoveSettlementRow = {
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

export type NoventaNovePeriodSummary = {
  period: { year: number; month: number };
  storeId: string | null;
  storeLabel: string;
  totals: {
    orders: number;
    grossAmount: number;
    noventaNoveFeeAmount: number;
    promotionAmount: number;
    deliveryFeeAmount: number;
    netAmount: number;
    otherFees: number;
  };
  daily: NoventaNoveDailySalesRow[];
  fees: NoventaNoveFeeBreakdownRow[];
  settlements: NoventaNoveSettlementRow[];
  isMock: boolean;
};

export type NoventaNoveStatusView = {
  credential: NoventaNoveCredentialStatusView;
  stores: NoventaNoveStoreView[];
  lastSync: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemsProcessed: number;
    errorMessage: string | null;
  } | null;
  mockMode: boolean;
  // Enquanto a plataforma não aprovar o app do Pateo (status "Em análise" em
  // developer-food.99app.com), a integração fica gated e roda só mock.
  awaitingApproval: boolean;
};
