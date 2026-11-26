import { z } from "zod";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";

export const METRICAS_DE_COMENTARIO = ["VENDAS", "CLIENTES", "TICKET"] as const;
export const TURNOS_DE_COMENTARIO = ["TOTAL", "ALMOCO", "JANTAR"] as const;
export const TEXTO_MAXIMO = 1000;
export const MAXIMO_POR_PONTO = 20;
export const MAXIMO_POR_ANO = 300;

const MSG_ANO = "Informe anos válidos entre 2020 e 2100.";
const MSG_IMPRESSAO = "Informe se o comentário sai na impressão.";
const ano = z.number({ required_error: MSG_ANO, invalid_type_error: MSG_ANO }).int(MSG_ANO).min(ANO_MINIMO, MSG_ANO).max(ANO_MAXIMO, MSG_ANO);

/** \r\n vira \n e as pontas são aparadas antes de validar; texto só com espaços cai no "vazio". */
const texto = z
  .string({ required_error: "Escreva o comentário.", invalid_type_error: "Escreva o comentário." })
  .transform((valor) => valor.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().min(1, "Escreva o comentário.").max(TEXTO_MAXIMO, `O comentário aceita até ${TEXTO_MAXIMO} caracteres.`));

/** O ponto onde o comentário fica preso. `mes` nulo = comentário do ano inteiro. */
export const pontoDeComentarioSchema = z.object({
  anoBase: ano,
  anoComparado: ano,
  mes: z.number({ required_error: "Mês inválido.", invalid_type_error: "Mês inválido." }).int("Mês inválido.").min(1, "Mês inválido.").max(12, "Mês inválido.").nullable(),
  metrica: z.enum(METRICAS_DE_COMENTARIO, { errorMap: () => ({ message: "Métrica inválida." }) }),
  turno: z.enum(TURNOS_DE_COMENTARIO, { errorMap: () => ({ message: "Turno inválido." }) }).default("TOTAL")
});

/** O autor nunca vem do corpo: é sempre o usuário da sessão (campos extras são descartados). */
export const novoComentarioSchema = pontoDeComentarioSchema
  .extend({ texto, naImpressao: z.boolean({ invalid_type_error: MSG_IMPRESSAO }).default(true) })
  .refine((c) => c.anoBase !== c.anoComparado, { message: "Escolha dois anos diferentes para comparar.", path: ["anoBase"] });

/** Edição: só o texto e/ou a impressão; o ponto e o autor não mudam. */
export const edicaoComentarioSchema = z
  .object({
    texto: texto.optional(),
    naImpressao: z.boolean({ invalid_type_error: MSG_IMPRESSAO }).optional(),
    /** `updatedAt` que a tela leu: se mudou, o comentário foi alterado antes. */
    atualizadoEm: z.string().datetime({ message: "Data de leitura inválida. Atualize a tela." })
  })
  .refine((e) => e.texto !== undefined || e.naImpressao !== undefined, { message: "Informe o texto ou a impressão para alterar.", path: ["texto"] });

export const consultaDeComentariosSchema = z.object({
  anoComparado: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO),
  anoBase: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO).optional()
});
