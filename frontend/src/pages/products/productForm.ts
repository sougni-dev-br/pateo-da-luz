// Estado do formulário de produto e conversões entre formulário, API e "dirty check".

import type { DRECategory, InventorySector, NatureOption, Product, ProductNature, UnitMeasure } from "../../api/client";
import { dreSugeridas } from "./natureza";
import type { ConversaoDoForm } from "./embalagens";

export type ProductFormState = {
  id: string;
  nature: ProductNature | "";
  externalCode: string;
  name: string;
  unit: string;
  unitMeasureId: string;
  stockUnit: string;
  purchaseUnit: string;
  baseUnit: string;
  conversionFactor: string;
  packageWeight: string;
  conversionNotes: string;
  logisticsNotes: string;
  storageLocation: string;
  storageCorridor: string;
  storageShelf: string;
  storagePosition: string;
  storageNotes: string;
  unitConversions: ConversaoDoForm[];
  categoryId: string;
  subcategoryId: string;
  inventorySectorId: string;
  dreCategoryId: string;
  accountType: string;
  controlsStock: boolean;
  estoqueMinimo: string;
  estoqueIdeal: string;
  leadTimeCompraDias: string;
  fornecedorPrincipalId: string;
  notes: string;
  isActive: boolean;
};

export const emptyProductForm: ProductFormState = {
  id: "",
  nature: "",
  externalCode: "",
  name: "",
  unit: "",
  unitMeasureId: "",
  stockUnit: "",
  purchaseUnit: "",
  baseUnit: "",
  conversionFactor: "",
  packageWeight: "",
  conversionNotes: "",
  logisticsNotes: "",
  storageLocation: "",
  storageCorridor: "",
  storageShelf: "",
  storagePosition: "",
  storageNotes: "",
  unitConversions: [],
  categoryId: "",
  subcategoryId: "",
  inventorySectorId: "",
  dreCategoryId: "",
  accountType: "",
  controlsStock: true,
  estoqueMinimo: "",
  estoqueIdeal: "",
  leadTimeCompraDias: "",
  fornecedorPrincipalId: "",
  notes: "",
  isActive: true
};

export function productToForm(product: Product, units: UnitMeasure[]): ProductFormState {
  return {
    id: product.id,
    nature: product.nature ?? "",
    externalCode: product.externalCode ?? "",
    name: product.name,
    unit: product.unit ?? "",
    unitMeasureId: product.unitMeasureId ?? units.find((unit) => unit.code === product.unit)?.id ?? "",
    stockUnit: product.stockUnit ?? product.baseUnit ?? "",
    purchaseUnit: product.purchaseUnit ?? product.unit ?? "",
    baseUnit: product.baseUnit ?? "",
    conversionFactor: product.conversionFactor ?? "",
    packageWeight: product.packageWeight ?? "",
    conversionNotes: product.conversionNotes ?? "",
    logisticsNotes: product.logisticsNotes ?? "",
    storageLocation: product.storageLocation ?? "",
    storageCorridor: product.storageCorridor ?? "",
    storageShelf: product.storageShelf ?? "",
    storagePosition: product.storagePosition ?? "",
    storageNotes: product.storageNotes ?? "",
    unitConversions: (product.unitConversions ?? []).map((conversion) => ({
      fromUnit: conversion.fromUnit,
      toUnit: conversion.toUnit,
      factor: conversion.factor,
      averagePackageWeight: conversion.averagePackageWeight ?? "",
      notes: conversion.notes ?? "",
      isActive: conversion.isActive
    })),
    categoryId: product.category?.id ?? "",
    subcategoryId: product.subcategory?.id ?? "",
    inventorySectorId: product.inventorySector?.id ?? "",
    dreCategoryId: product.dreCategoryId ?? "",
    accountType: product.accountType ?? "",
    controlsStock: product.controlsStock ?? true,
    estoqueMinimo: product.estoqueMinimo ?? "",
    estoqueIdeal: product.estoqueIdeal ?? "",
    leadTimeCompraDias: product.leadTimeCompraDias == null ? "" : String(product.leadTimeCompraDias),
    fornecedorPrincipalId: product.fornecedorPrincipalId ?? "",
    notes: product.notes ?? "",
    isActive: product.isActive
  };
}

/** Snapshot canônico para dirty-check: null, undefined e "" colapsam; textos são aparados. */
export function normalizeForm(form: ProductFormState, alias: string): string {
  const s = (valor: string | null | undefined) => (valor == null ? "" : String(valor).trim());
  return JSON.stringify({
    ...form,
    id: undefined,
    externalCode: s(form.externalCode),
    name: s(form.name),
    unitConversions: form.unitConversions.map((c) => ({ ...c, fromUnit: s(c.fromUnit), toUnit: s(c.toUnit), factor: s(c.factor) })),
    notes: s(form.notes),
    alias: s(alias)
  });
}

/**
 * Corpo do POST/PUT. A natureza só vai quando escolhida: o servidor trata "campo ausente"
 * como "não mexa", e mandar vazio apagaria a de um produto já classificado.
 */
export function formToPayload(
  form: ProductFormState,
  nomes: { categoria?: string; subcategoria?: string },
  conversoesCarregadas: Array<{ fromUnit: string; toUnit: string }>
) {
  const { nature, ...resto } = form;
  return {
    ...resto,
    ...(nature ? { nature } : {}),
    unitConversionsCarregadas: form.id ? conversoesCarregadas : [],
    categoryName: nomes.categoria,
    subcategoryName: nomes.subcategoria
  };
}

/** Troca de natureza num cadastro: aplica o estoque padrão e descarta DRE de outro grupo. */
export function aplicarNatureza(
  form: ProductFormState,
  opcao: NatureOption,
  categoriasDre: DRECategory[]
): ProductFormState {
  const atual = categoriasDre.find((categoria) => categoria.id === form.dreCategoryId);
  const dreCombina = !atual || opcao.dreGroups.includes(atual.dreGroup);
  const sugeridas = dreSugeridas(opcao, categoriasDre);
  const dreCategoryId = dreCombina
    ? form.dreCategoryId
    : sugeridas.length === 1 ? sugeridas[0].id : "";
  return {
    ...form,
    nature: opcao.value,
    controlsStock: opcao.controlsStock,
    dreCategoryId,
    // Sem estoque, setor deixa de valer: não deixar um setor antigo preso ao item.
    inventorySectorId: opcao.controlsStock ? form.inventorySectorId : ""
  };
}

export function setorDisponivel(sectors: InventorySector[]): InventorySector[] {
  const invalidos = new Set(["", "object object", "sem setor", "undefined", "null", "revisao/pendencias"]);
  const unicos = new Map<string, InventorySector>();
  for (const setor of sectors) {
    const chave = String(setor.name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    if (invalidos.has(chave) || unicos.has(chave)) continue;
    unicos.set(chave, setor);
  }
  return [...unicos.values()];
}
