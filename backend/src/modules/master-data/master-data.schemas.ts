import { z } from "zod";
import { PRODUCT_NATURES } from "../products/product-nature.js";

const nomeObrigatorio = z.string().trim().min(1, "obrigatorio");
const textoOpcional = z.string().trim().optional().nullable();
const ativo = z.boolean().optional();

export const categorySchema = z.object({
  name: nomeObrigatorio,
  mainGroup: textoOpcional,
  /** Ausente = nao mexe; null = limpa. Cliente anterior a esta versao nao manda os dois. */
  nature: z.enum(PRODUCT_NATURES, { message: "natureza invalida" }).nullable().optional(),
  defaultDreCategoryId: z.string().trim().transform((valor) => valor || null).nullable().optional(),
  notes: textoOpcional,
  isActive: ativo
});

/**
 * categoryId era lido com String(request.body.categoryId ?? ""), entao um PUT
 * sem o campo gravava "" e a subcategoria ficava pendurada em categoria
 * inexistente — erro de chave estrangeira em 500.
 */
export const subcategorySchema = z.object({
  name: nomeObrigatorio,
  categoryId: z.string().trim().min(1, "categoria obrigatoria"),
  notes: textoOpcional,
  isActive: ativo
});

export const expenseTypeSchema = z.object({
  name: nomeObrigatorio,
  group: textoOpcional,
  notes: textoOpcional,
  isActive: ativo
});

export const statusSchema = z.object({
  isActive: z.boolean({ message: "informe true ou false" })
});
