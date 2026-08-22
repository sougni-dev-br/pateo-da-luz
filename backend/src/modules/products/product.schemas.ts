import { z } from "zod";

/**
 * Id opcional que aceita "" como "nao informado".
 *
 * O formulario manda string vazia quando o select esta em "Selecione", e o
 * codigo fazia `request.body.dreCategoryId || null`. Um id digitado errado
 * seguia para o Prisma e voltava como erro de chave estrangeira em 500.
 */
const idOpcional = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable()
  .optional();

const decimalTexto = z.union([z.string(), z.number()]).nullable().optional();

export const productSchema = z.object({
  name: z.string().trim().min(1, "descricao do produto obrigatoria"),
  externalCode: z.union([z.string(), z.number()]).nullable().optional(),
  unitMeasureId: idOpcional,
  categoryId: idOpcional,
  subcategoryId: idOpcional,
  inventorySectorId: idOpcional,
  dreCategoryId: idOpcional,
  fornecedorPrincipalId: idOpcional,
  categoryName: z.string().trim().nullable().optional(),
  subcategoryName: z.string().trim().nullable().optional(),
  sectorName: z.string().trim().nullable().optional(),
  accountType: z.string().trim().nullable().optional(),
  controlsStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().nullable().optional(),

  stockUnit: z.string().trim().nullable().optional(),
  purchaseUnit: z.string().trim().nullable().optional(),
  baseUnit: z.string().trim().nullable().optional(),
  conversionFactor: decimalTexto,
  packageWeight: decimalTexto,
  conversionNotes: z.string().trim().nullable().optional(),
  logisticsNotes: z.string().trim().nullable().optional(),

  storageLocation: z.string().trim().nullable().optional(),
  storageCorridor: z.string().trim().nullable().optional(),
  storageShelf: z.string().trim().nullable().optional(),
  storagePosition: z.string().trim().nullable().optional(),
  storageNotes: z.string().trim().nullable().optional(),

  estoqueMinimo: decimalTexto,
  estoqueIdeal: decimalTexto,
  leadTimeCompraDias: z.union([z.string(), z.number()]).nullable().optional(),

  unitConversions: z
    .array(
      z.object({
        id: z.string().trim().optional(),
        fromUnit: z.string().trim().nullable().optional(),
        toUnit: z.string().trim().nullable().optional(),
        factor: decimalTexto,
        averagePackageWeight: decimalTexto,
        notes: z.string().trim().nullable().optional(),
        isActive: z.boolean().optional()
      })
    )
    .optional()
}).passthrough();

export const productStatusSchema = z.object({
  isActive: z.boolean({ message: "informe true ou false" })
});

export const productAliasSchema = z.object({
  alias: z.string().trim().min(1, "informe o apelido do produto")
});

export const bulkDreSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, "informe ao menos um produto"),
  dreCategoryId: z.string().trim().min(1).nullable()
});
