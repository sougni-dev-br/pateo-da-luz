import { z } from "zod";
import { hojeSaoPaulo, isDataIsoValida } from "./receivable.datas.js";

export const receivableSourceTypes = [
  "IFOOD_SETTLEMENT",
  "NOVENTA_NOVE_SETTLEMENT",
  "KEETA_SETTLEMENT",
  "EVENT",
  "DIRECT",
  "OTHER"
] as const;
export type ReceivableSourceType = (typeof receivableSourceTypes)[number];

// Repasses de plataforma nascem das sincronizações/importações; só estes são lançados à mão.
export const manualSourceTypes = ["EVENT", "DIRECT", "OTHER"] as const;

export const receivableStatuses = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "LATE", "CANCELLED"] as const;
export type ReceivableStatus = (typeof receivableStatuses)[number];

/** Filtros da listagem. LATE e PENDING são derivados, não existem no banco. */
export const listStatusFilters = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "LATE", "PENDING"] as const;

const dataIso = z.string().trim().refine(isDataIsoValida, "data inválida (use aaaa-mm-dd)");
const texto = (max: number) => z.string().trim().max(max, `no máximo ${max} caracteres`);
const opcional = (max: number) => texto(max).optional().nullable().transform((v) => (v ? v : null));

const centavosExatos = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const valorMonetario = (nome: string) =>
  z.coerce
    .number({ invalid_type_error: `${nome} inválido` })
    .finite(`${nome} inválido`)
    .max(1_000_000_000, `${nome} acima do limite`)
    .refine(centavosExatos, `${nome} deve ter no máximo 2 casas decimais`);

export const createReceivableSchema = z
  .object({
    companyId: opcional(64),
    sourceType: z.enum(manualSourceTypes, { errorMap: () => ({ message: "origem inválida: repasses de plataforma não são lançados à mão" }) }),
    sourceRef: opcional(120),
    customerName: opcional(160),
    customerDocument: opcional(32),
    description: texto(200).min(1, "descrição obrigatória"),
    expectedDate: dataIso,
    grossAmount: valorMonetario("valor bruto").refine((v) => v >= 0, "valor bruto não pode ser negativo"),
    fees: valorMonetario("taxas").refine((v) => v >= 0, "taxas não podem ser negativas").optional().default(0),
    netAmount: valorMonetario("valor líquido").refine((v) => v > 0, "o valor líquido deve ser maior que zero"),
    paymentMethod: opcional(60),
    bankAccountId: opcional(64),
    installmentNumber: z.coerce.number().int().positive().optional().nullable(),
    totalInstallments: z.coerce.number().int().positive().optional().nullable(),
    parentReceivableId: opcional(64),
    notes: opcional(500)
  })
  .superRefine((v, ctx) => {
    if (Math.abs(v.grossAmount - v.fees - v.netAmount) > 0.01) {
      ctx.addIssue({ code: "custom", path: ["netAmount"], message: "o líquido deve ser o bruto menos as taxas" });
    }
    const temParcela = v.installmentNumber != null;
    const temTotal = v.totalInstallments != null;
    if (temParcela !== temTotal) {
      ctx.addIssue({ code: "custom", path: ["installmentNumber"], message: "informe o número da parcela e o total juntos" });
    } else if (temParcela && v.installmentNumber! > v.totalInstallments!) {
      ctx.addIssue({ code: "custom", path: ["installmentNumber"], message: "a parcela não pode ser maior que o total" });
    }
  });
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;

/** `paidAmount` é o valor DESTE recebimento (não o acumulado). */
export const markReceivedSchema = z.object({
  receivedDate: dataIso.refine((d) => d <= hojeSaoPaulo(), "a data do recebimento não pode ser futura"),
  paidAmount: valorMonetario("valor recebido").refine((v) => v > 0, "informe um valor maior que zero"),
  paymentMethod: opcional(60),
  bankAccountId: opcional(64),
  notes: opcional(500),
  differenceReason: opcional(300)
});
export type MarkReceivedInput = z.infer<typeof markReceivedSchema>;

export const reasonSchema = z.object({
  reason: z.string({ required_error: "informe o motivo" }).trim().min(3, "informe o motivo (mínimo 3 letras)").max(300, "motivo longo demais")
});

export const listQuerySchema = z.object({
  status: z.enum(listStatusFilters).optional(),
  sourceType: z.enum(receivableSourceTypes).optional(),
  companyId: z.string().trim().max(64).optional(),
  startDate: dataIso.optional(),
  endDate: dataIso.optional(),
  /** Qual data o período filtra: a prevista (padrão) ou a do recebimento. */
  dateField: z.enum(["expected", "received"]).optional().default("expected"),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
  offset: z.coerce.number().int().min(0).optional().default(0)
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export type ReceiptView = {
  id: string;
  receivedDate: string;
  amount: number;
  paymentMethod: string | null;
  bankAccountId: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  /** Recebimento anterior ao controle por lançamento, reconstruído do resumo da conta. */
  legacy: boolean;
};

export type ReceivableView = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  sourceType: ReceivableSourceType;
  sourceRef: string | null;
  ifoodSettlementId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  description: string;
  competenceYear: number;
  competenceMonth: number;
  expectedDate: string;
  receivedDate: string | null;
  grossAmount: number;
  fees: number;
  netAmount: number;
  paidAmount: number | null;
  /** Quanto ainda falta receber (0 se recebida ou cancelada). */
  remainingAmount: number;
  paymentMethod: string | null;
  bankAccountId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  parentReceivableId: string | null;
  status: ReceivableStatus;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  daysUntilExpected: number;
  isLate: boolean;
  createdAt: string;
};

export type ReceivableDetail = ReceivableView & { receipts: ReceiptView[] };

export type ReceivableSummary = {
  today: string;
  overdue: { count: number; amount: number };
  dueToday: { count: number; amount: number };
  next7: { count: number; amount: number };
  next30: { count: number; amount: number };
  /** Tudo que falta receber (vencido + a vencer). */
  pending: { count: number; amount: number };
  receivedThisMonth: { count: number; amount: number };
};
