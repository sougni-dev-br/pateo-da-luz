import { z } from "zod";
import type { SaudeAgente } from "./agile-heartbeat.health.js";

// Payload enviado pelo agente que roda na máquina do PDV.
// Cada array corresponde a um dos 3 CSVs exportados pelo AgileReport,
// já parseados (UTF-16 → objetos JSON) do lado do agente.
//
// O backend NÃO conhece o AgileReport diretamente: ele confia no
// agente autenticado por X-Agile-Token. Toda validação de tipos
// acontece aqui via Zod antes de qualquer INSERT.

// dt_movimento vem como "DD/MM/YYYY" no CSV; o agente já converte para ISO.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em ISO YYYY-MM-DD");

// vl_* vem como string "123,45" no CSV; o agente já converte para number.
// Aceita negativo: o Agile emite valores negativos em estornos e trocas
// de forma de pagamento (comum quando o cliente altera Pix→Crédito).
const money = z.number().finite();

// Modo da venda no PDV: "mesa" (Salão), "viagem", "delivery"... O PDV só mandou
// "mesa" até hoje. Ausente/vazio/null vira "mesa" (era o contrato antes do campo
// existir). Só "mesa" entra no faturamento do Salão — ver ehVendaDeMesa.
const modoVenda = z.string().nullish().transform((valor) => (valor && valor.trim() ? valor.trim() : "mesa"));

const vendaSchema = z.object({
  modo_venda: modoVenda,
  nrseqvenda: z.string().min(1),
  dt_movimento: isoDate,
  turno: z.string().min(1), // "Almoço" | "Jantar" | outros
  situacao_da_venda: z.string().min(1), // "RECEBIDA" | "CANCELADA"
  nr_ticket: z.string().nullable().optional(),
  qtd_pessoas: z.number().int().nonnegative().default(0),
  vl_subtotal_itens: money.default(0),
  vl_desconto: money.default(0),
  vl_servico_inf: money.default(0),
  vl_total: money.default(0),
  dia_da_semana: z.string().nullable().optional()
});

const pagamentoSchema = z.object({
  modo_venda: modoVenda,
  nrseqvenda: z.string().min(1),
  nrseqpgto: z.string().min(1),
  dt_movimento: isoDate,
  turno: z.string().min(1),
  situacao_da_venda: z.string().min(1),
  meio_pagamento: z.string().min(1),
  vl_recebido: money.default(0)
});

const itemSchema = z.object({
  modo_venda: modoVenda,
  nrseqvenda: z.string().min(1),
  nrseqitem: z.string().min(1),
  dt_movimento: isoDate,
  turno: z.string().min(1),
  situacao_da_venda: z.string().min(1),
  cod_produto: z.string().nullable().optional(),
  produto: z.string().min(1),
  grupo_produto: z.string().nullable().optional(),
  categoria_produto: z.string().nullable().optional(),
  qtd: z.number().nonnegative().default(0),
  vl_tot: money.default(0)
});

export const agileSyncPayloadSchema = z.object({
  // Faixa que o agente puxou. O backend valida que todas as linhas caem dentro.
  periodoInicio: isoDate,
  periodoFim: isoDate,
  // Metadados opcionais úteis para debugging remoto.
  agenteVersion: z.string().optional(),
  agenteHost: z.string().optional(),
  vendas: z.array(vendaSchema),
  pagamentos: z.array(pagamentoSchema),
  itens: z.array(itemSchema)
});

export type AgileSyncPayload = z.infer<typeof agileSyncPayloadSchema>;
export type AgileVenda = z.infer<typeof vendaSchema>;
export type AgilePagamento = z.infer<typeof pagamentoSchema>;
export type AgileItem = z.infer<typeof itemSchema>;

export type AgileSyncReport = {
  batchId: string;
  periodoInicio: string;
  periodoFim: string;
  diasImportados: number;
  diasCriados: number;
  diasAtualizados: number;
  vendasProcessadas: number;
  vendasCanceladasIgnoradas: number;
  itensGravados: number;
  totalBruto: number;
  totalLiquido: number;
  totalServico: number;
  totalTickets: number;
  avisos: string[];
};

export type AgileSyncStatus = {
  ultimaSyncEm: string | null;
  ultimoBatchId: string | null;
  ultimoPeriodoFim: string | null;
  diasImportadosUltimoBatch: number;
  totalRegistrosSalaoAgile: number;
  // Saúde do agente do PDV (heartbeat): estado e alertas já avaliados pelo servidor.
  // Ausente se a leitura do heartbeat falhou; a tela trata como "sem informação".
  agente?: SaudeAgente;
};
