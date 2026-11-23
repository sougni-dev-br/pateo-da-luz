import { z } from "zod";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";
import { FORMAS_DE_RECEBIMENTO, MESES_HERDADOS, PRAZO_MAXIMO_EM_DIAS } from "./planejamento-caixa.js";
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
    valores: z.array(z.number().finite()).length(12, "Informe os 12 meses de cada linha de gasto."),
    pagoNoMes: z.number().finite().min(0, "% pago no mês entre 0% e 100%.").max(1, "% pago no mês entre 0% e 100%.").default(1)
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

const valorEmReais = z.number().finite().min(-VALOR_MAXIMO_EM_REAIS).max(VALOR_MAXIMO_EM_REAIS);
const aReceberOuPagar = z.number().finite().min(0, "Valores herdados não são negativos.").max(VALOR_MAXIMO_EM_REAIS);

const formaDePagamento = z.object({
  forma: z.enum(FORMAS_DE_RECEBIMENTO),
  mix: z.number().finite().min(0, "Mix entre 0% e 100%.").max(1, "Mix entre 0% e 100%."),
  prazoDias: z.number().int().min(0, "Prazo não pode ser negativo.").max(PRAZO_MAXIMO_EM_DIAS, `Prazo de até ${PRAZO_MAXIMO_EM_DIAS} dias.`),
  taxa: z.number().finite().min(0, "Taxa entre 0% e 20%.").max(0.2, "Taxa entre 0% e 20%.")
});

/** As cinco formas, sem repetir, com o mix somando 100%. */
export const caixaSchema = z
  .object({
    saldoInicial: valorEmReais,
    formas: z.array(formaDePagamento).length(FORMAS_DE_RECEBIMENTO.length, "Informe as cinco formas de pagamento."),
    comprasPrazoDias: z.number().int().min(0, "Prazo não pode ser negativo.").max(PRAZO_MAXIMO_EM_DIAS, `Prazo de até ${PRAZO_MAXIMO_EM_DIAS} dias.`),
    herdado: z.object({
      entradas: z.array(aReceberOuPagar).length(MESES_HERDADOS, "Informe janeiro, fevereiro e março."),
      saidas: z.array(aReceberOuPagar).length(MESES_HERDADOS, "Informe janeiro, fevereiro e março.")
    })
  })
  .refine((c) => new Set(c.formas.map((f) => f.forma)).size === FORMAS_DE_RECEBIMENTO.length, "Há forma de pagamento repetida.")
  .refine((c) => Math.abs(c.formas.reduce((s, f) => s + f.mix, 0) - 1) < 0.0005, "O mix das formas de pagamento precisa somar 100%.");

export const servicoSchema = z.number().finite().min(0, "Serviço não pode ser negativo.").max(1, "Serviço acima de 100% das vendas.").nullable();

const nome = z.string().trim().min(1, "Dê um nome ao cenário.").max(60, "Nome com até 60 caracteres.");

export const previaSchema = z.object({ anoBase: ano, premissas: premissasSchema, gastos: gastosSchema.default([]), servicoPercentual: servicoSchema.default(null), caixa: caixaSchema.optional() });

export const novoCenarioSchema = z
  .object({ ano, anoBase: ano, nome, premissas: premissasSchema.optional(), gastos: gastosSchema.optional(), servicoPercentual: servicoSchema.optional(), caixa: caixaSchema.optional() })
  .refine((c) => c.anoBase < c.ano, { message: "O ano-base precisa ser anterior ao ano projetado.", path: ["anoBase"] });

export const edicaoSchema = z.object({
  nome,
  anoBase: ano,
  premissas: premissasSchema,
  gastos: gastosSchema,
  servicoPercentual: servicoSchema,
  /** Ausente = mantém o caixa gravado (uma tela antiga, sem o regime de caixa, ainda consegue salvar). */
  caixa: caixaSchema.optional(),
  /** `updatedAt` que a tela leu: se mudou, outra pessoa salvou antes. */
  atualizadoEm: z.string().datetime({ message: "Data de leitura inválida. Atualize a tela." })
});

export const ordenadas = (lista: readonly PremissasDoMes[]): PremissasDoMes[] => [...lista].sort((a, b) => a.mes - b.mes);
