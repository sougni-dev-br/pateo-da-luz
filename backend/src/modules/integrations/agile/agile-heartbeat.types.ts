import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "deve estar em ISO YYYY-MM-DD");

// Corpo enviado pelo agente ao final de cada execução (ok ou erro).
export const heartbeatPayloadSchema = z.object({
  status: z.enum(["ok", "erro"]),
  mensagem: z.string().max(500).nullable().optional(),
  periodoInicio: isoDate,
  periodoFim: isoDate,
  batchId: z.string().max(100).nullable().optional(),
  diasImportados: z.number().finite().nullable().optional(),
  totalBruto: z.number().finite().nullable().optional(),
  duracaoMs: z.number().finite().nonnegative(),
  agenteVersion: z.string().max(50).nullable().optional(),
  // Chave do registro (uma linha por máquina). Hoje: "PDVTOUCH".
  agenteHost: z.string().trim().min(1).max(100),
  // Relógio do AGENTE. Serve só para descartar heartbeat velho/reordenado;
  // as regras de atraso usam sempre a hora do servidor.
  ocorridoEm: z.string().datetime({ offset: true })
});

export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
