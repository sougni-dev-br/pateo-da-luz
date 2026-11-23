import { z } from "zod";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";
import { GRUPOS_DE_GASTO } from "./planejamento-gastos.js";
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

const VALOR_MAXIMO_EM_REAIS = 1_000_000_000;
const MAXIMO_DE_LINHAS = 40;

const linhaDeGasto = z
  .object({
    grupo: z.enum(GRUPOS_DE_GASTO),
    nome: z.string().trim().min(1, "Dê um nome à linha de gasto.").max(60, "Nome da linha com até 60 caracteres."),
    modo: z.enum(["FIXO", "PERCENTUAL"]),
    valores: z.array(z.number().finite()).length(12, "Informe os 12 meses de cada linha de gasto.")
  })
  .superRefine((linha, ctx) => {
    const maximo = linha.modo === "FIXO" ? VALOR_MAXIMO_EM_REAIS : 1;
    if (linha.valores.some((v) => v < 0 || v > maximo)) {
      ctx.addIssue({ code: "custom", path: ["valores"], message: linha.modo === "FIXO" ? `Valores de "${linha.nome}" fora da faixa (0 a 1 bilhão).` : `Percentuais de "${linha.nome}" fora da faixa (0% a 100%).` });
    }
  });

/** Sem nome repetido na mesma lista (o banco também garante). */
export const gastosSchema = z
  .array(linhaDeGasto)
  .max(MAXIMO_DE_LINHAS, "Limite de 40 linhas de gasto.")
  .refine((lista) => new Set(lista.map((l) => l.nome.toLowerCase())).size === lista.length, "Há linhas de gasto com o mesmo nome.");

export const servicoSchema = z.number().finite().min(0, "Serviço não pode ser negativo.").max(1, "Serviço acima de 100% das vendas.").nullable();

const nome = z.string().trim().min(1, "Dê um nome ao cenário.").max(60, "Nome com até 60 caracteres.");

export const previaSchema = z.object({ anoBase: ano, premissas: premissasSchema, gastos: gastosSchema.default([]), servicoPercentual: servicoSchema.default(null) });

export const novoCenarioSchema = z
  .object({ ano, anoBase: ano, nome, premissas: premissasSchema.optional(), gastos: gastosSchema.optional(), servicoPercentual: servicoSchema.optional() })
  .refine((c) => c.anoBase < c.ano, { message: "O ano-base precisa ser anterior ao ano projetado.", path: ["anoBase"] });

export const edicaoSchema = z.object({
  nome,
  anoBase: ano,
  premissas: premissasSchema,
  gastos: gastosSchema,
  servicoPercentual: servicoSchema,
  /** `updatedAt` que a tela leu: se mudou, outra pessoa salvou antes. */
  atualizadoEm: z.string().datetime({ message: "Data de leitura inválida. Atualize a tela." })
});

export const ordenadas = (lista: readonly PremissasDoMes[]): PremissasDoMes[] => [...lista].sort((a, b) => a.mes - b.mes);
