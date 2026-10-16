import type { MudancasDoLote, ProductNature } from "../../api/client";

/** Valor do seletor que significa "não mexer neste campo". */
export const MANTER = "";
/** Valor do seletor que significa "deixar em branco" (subcategoria e setor). */
export const LIMPAR = "__limpar";

export type FormularioDoLote = {
  categoryId: string;
  subcategoryId: string;
  inventorySectorId: string;
  nature: string;
  controlsStock: "" | "sim" | "nao";
  isActive: "" | "ativar" | "inativar";
};

export const LOTE_VAZIO: FormularioDoLote = {
  categoryId: MANTER,
  subcategoryId: MANTER,
  inventorySectorId: MANTER,
  nature: MANTER,
  controlsStock: "",
  isActive: ""
};

/** Só os campos escolhidos viram mudança; o resto fica fora do corpo e, portanto, intacto. */
export function mudancasDoFormulario(form: FormularioDoLote): MudancasDoLote {
  const mudancas: MudancasDoLote = {};
  if (form.categoryId !== MANTER) mudancas.categoryId = form.categoryId;
  if (form.subcategoryId !== MANTER) mudancas.subcategoryId = form.subcategoryId === LIMPAR ? null : form.subcategoryId;
  if (form.inventorySectorId !== MANTER) mudancas.inventorySectorId = form.inventorySectorId === LIMPAR ? null : form.inventorySectorId;
  if (form.nature !== MANTER) mudancas.nature = form.nature as ProductNature;
  if (form.controlsStock !== "") mudancas.controlsStock = form.controlsStock === "sim";
  if (form.isActive !== "") mudancas.isActive = form.isActive === "ativar";
  return mudancas;
}

export function temMudanca(form: FormularioDoLote): boolean {
  return Object.keys(mudancasDoFormulario(form)).length > 0;
}

/** Trocar a categoria invalida a subcategoria escolhida antes: ela pertencia à categoria antiga. */
export function comCategoria(form: FormularioDoLote, categoryId: string): FormularioDoLote {
  return { ...form, categoryId, subcategoryId: MANTER };
}

/** Frase curta de cada mudança escolhida, para o resumo antes de aplicar. */
export function descricaoDasMudancas(
  form: FormularioDoLote,
  nomes: { categoria?: string; subcategoria?: string; setor?: string; natureza?: string }
): string[] {
  const linhas: string[] = [];
  if (form.categoryId !== MANTER) linhas.push(`Categoria: ${nomes.categoria ?? form.categoryId}`);
  if (form.subcategoryId !== MANTER) linhas.push(form.subcategoryId === LIMPAR ? "Subcategoria: deixar em branco" : `Subcategoria: ${nomes.subcategoria ?? form.subcategoryId}`);
  if (form.inventorySectorId !== MANTER) linhas.push(form.inventorySectorId === LIMPAR ? "Setor: deixar em branco" : `Setor: ${nomes.setor ?? form.inventorySectorId}`);
  if (form.nature !== MANTER) linhas.push(`Natureza: ${nomes.natureza ?? form.nature}`);
  if (form.controlsStock !== "") linhas.push(form.controlsStock === "sim" ? "Controla estoque: sim (entra na contagem)" : "Controla estoque: não (sai da contagem)");
  if (form.isActive !== "") linhas.push(form.isActive === "ativar" ? "Situação: ativar" : "Situação: inativar");
  return linhas;
}
