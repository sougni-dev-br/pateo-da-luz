import { z } from "zod";

export const receivableSourceTypes = [
  "IFOOD_SETTLEMENT",
  "NOVENTA_NOVE_SETTLEMENT",
  "KEETA_SETTLEMENT",
  "EVENT",
  "DIRECT",
  "OTHER"
] as const;
export type ReceivableSourceType = (typeof receivableSourceTypes)[number];

export const receivableStatuses = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "LATE", "CANCELLED"] as const;
export type ReceivableStatus = (typeof receivableStatuses)[number];

export const createReceivableSchema = z.object({
  companyId: z.string().trim().optional().nullable(),
  sourceType: z.enum(receivableSourceTypes),
  sourceRef: z.string().trim().optional().nullable(),
  customerName: z.string().trim().optional().nullable(),
  customerDocument: z.string().trim().optional().nullable(),
  description: z.string().trim().min(1, "descrição obrigatória"),
  expectedDate: z.string().trim().min(8, "data prevista obrigatória"),
  grossAmount: z.coerce.number().nonnegative(),
  fees: z.coerce.number().nonnegative().optional().default(0),
  netAmount: z.coerce.number().nonnegative(),
  paymentMethod: z.string().trim().optional().nullable(),
  bankAccountId: z.string().trim().optional().nullable(),
  installmentNumber: z.coerce.number().int().positive().optional().nullable(),
  totalInstallments: z.coerce.number().int().positive().optional().nullable(),
  parentReceivableId: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable()
});
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;

export const markReceivedSchema = z.object({
  receivedDate: z.string().trim().min(8, "data de recebimento obrigatória"),
  paidAmount: z.coerce.number().nonnegative(),
  paymentMethod: z.string().trim().optional().nullable(),
  bankAccountId: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable()
});
export type MarkReceivedInput = z.infer<typeof markReceivedSchema>;

export const listQuerySchema = z.object({
  status: z.enum(receivableStatuses).optional(),
  sourceType: z.enum(receivableSourceTypes).optional(),
  companyId: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional()
});
export type ListQuery = z.infer<typeof listQuerySchema>;

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
  paymentMethod: string | null;
  bankAccountId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  parentReceivableId: string | null;
  status: ReceivableStatus;
  notes: string | null;
  daysUntilExpected: number;
  isLate: boolean;
  createdAt: string;
};
