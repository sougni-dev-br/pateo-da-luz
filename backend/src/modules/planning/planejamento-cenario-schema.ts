import { z } from "zod";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";
import { CRESCIMENTO_MAXIMO, CRESCIMENTO_MINIMO, type PremissasDoMes } from "./planejamento-projecao.js";

const crescimento = z.number().finite().min(CRESCIMENTO_MINIMO, "Queda máxima de 90%.").max(CRESCIMENTO_MAXIMO, "Alta máxima de 500%.");
const ano = z.number().int().min(ANO_MINIMO).max(ANO_MAXIMO);

const premissasDoMes = z.object({
  mes: z.number().int().min(1).max(12),
  clientesAlmoco: crescimento,
  clientesJantar: crescimento,
  ticketAlmoco: crescimento,
  ticketJantar: crescimento,
  cmv: z.number().finite().min(0, "CMV não pode ser negativo.").max(1, "CMV acima de 100% das vendas.").nullable()
});

/** Os 12 meses, sem repetir nem faltar nenhum. */
export const premissasSchema = z
  .array(premissasDoMes)
  .length(12, "Informe as premissas dos 12 meses.")
  .refine((lista) => new Set(lista.map((p) => p.mes)).size === 12, "Há mês repetido nas premissas.");

const nome = z.string().trim().min(1, "Dê um nome ao cenário.").max(60, "Nome com até 60 caracteres.");

export const previaSchema = z.object({ anoBase: ano, premissas: premissasSchema });

export const novoCenarioSchema = z
  .object({ ano, anoBase: ano, nome, premissas: premissasSchema.optional() })
  .refine((c) => c.anoBase < c.ano, { message: "O ano-base precisa ser anterior ao ano projetado.", path: ["anoBase"] });

export const edicaoSchema = z.object({
  nome,
  anoBase: ano,
  premissas: premissasSchema,
  /** `updatedAt` que a tela leu: se mudou, outra pessoa salvou antes. */
  atualizadoEm: z.string().datetime({ message: "Data de leitura inválida. Atualize a tela." })
});

export const ordenadas = (lista: readonly PremissasDoMes[]): PremissasDoMes[] => [...lista].sort((a, b) => a.mes - b.mes);
