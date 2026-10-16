// Regras do cadastro de produto por natureza do item. Funções puras: a tela só desenha o que elas devolvem.
// Os padrões de cada natureza (DRE sugerido, estoque, se é item físico) vêm do servidor em NatureOption;
// aqui só se decide o que perguntar, o que falta e o que merece aviso.

import type { DRECategory, NatureOption } from "../../api/client";

export type StepId = "natureza" | "identificacao" | "classificacao" | "estoque" | "conferencia";

export const STEP_LABELS: Record<StepId, string> = {
  natureza: "O que é",
  identificacao: "Identificação",
  classificacao: "Classificação",
  estoque: "Estoque e compra",
  conferencia: "Conferência"
};

export type CamposDoCadastro = {
  name: string;
  unitMeasureId: string;
  categoryId: string;
  dreCategoryId: string;
  inventorySectorId: string;
  controlsStock: boolean;
};

export type Pendencia = { step: StepId; campo: string };

/**
 * Passos que o cadastro mostra. Estoque e compra existem para todo item físico: conversão de
 * embalagem, unidade de compra e fornecedor valem também para o que não entra na contagem.
 * Cadastro novo sem natureza escolhida só libera o primeiro passo.
 */
export function passosVisiveis(opcao: NatureOption | null, cadastroNovo: boolean): StepId[] {
  if (!opcao && cadastroNovo) return ["natureza"];
  const fisico = opcao ? opcao.fisico : true;
  const passos: StepId[] = ["natureza", "identificacao", "classificacao"];
  if (fisico) passos.push("estoque");
  passos.push("conferencia");
  return passos;
}

/** Cadastro rígido bloqueia o salvamento pelas pendências; produto antigo sem natureza só é avisado. */
export function cadastroRigido(opcao: NatureOption | null, cadastroNovo: boolean): boolean {
  return cadastroNovo || opcao !== null;
}

export function pendenciasDoCadastro(
  campos: CamposDoCadastro,
  opcao: NatureOption | null,
  cadastroNovo: boolean
): Pendencia[] {
  const pendencias: Pendencia[] = [];
  // Sem a natureza, o resto ainda não tem o que pedir: a única pendência é a pergunta inicial.
  if (cadastroNovo && !opcao) return [{ step: "natureza", campo: "o que é este item" }];
  if (!campos.name.trim()) pendencias.push({ step: "identificacao", campo: "nome do item" });

  const fisico = opcao ? opcao.fisico : true;
  if (fisico) {
    if (!campos.unitMeasureId) pendencias.push({ step: "identificacao", campo: "unidade" });
    if (!campos.categoryId) pendencias.push({ step: "identificacao", campo: "categoria" });
  }
  if (!campos.dreCategoryId) pendencias.push({ step: "classificacao", campo: "categoria DRE" });
  if (fisico && campos.controlsStock && !campos.inventorySectorId) {
    pendencias.push({ step: "classificacao", campo: "setor" });
  }
  return pendencias;
}

/** Combinações que fogem do padrão da natureza. Avisam, não bloqueiam. */
export function avisosDaNatureza(opcao: NatureOption | null, dreGroup: string | null, controlsStock: boolean): string[] {
  if (!opcao) return [];
  const avisos: string[] = [];
  const noCmv = dreGroup === "CMV_COMPRAS";
  if (opcao.entraNoCmv && dreGroup && !noCmv) {
    avisos.push(`${opcao.label} costuma entrar no CMV, mas a categoria DRE escolhida está fora dele.`);
  }
  if (!opcao.entraNoCmv && noCmv) {
    avisos.push(`${opcao.label} não costuma entrar no CMV, mas a categoria DRE escolhida está dentro dele.`);
  }
  if (opcao.entraNoCmv && !controlsStock) {
    avisos.push(`${opcao.label} costuma controlar estoque; sem isso o item some da contagem.`);
  }
  return avisos;
}

/** Categorias de DRE dos grupos sugeridos pela natureza, em ordem alfabética. */
export function dreSugeridas(opcao: NatureOption | null, categorias: DRECategory[]): DRECategory[] {
  if (!opcao) return [];
  return categorias
    .filter((categoria) => opcao.dreGroups.includes(categoria.dreGroup))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Categoria do produto -> categoria de DRE usual. Só vale se cair num grupo que a natureza sugere.
const DRE_POR_CATEGORIA: Record<string, string> = {
  BEBIDAS: "Bebidas",
  FLV: "Custo de Alimentos",
  "CARNES E AVES": "Custo de Alimentos",
  PEIXES: "Custo de Alimentos",
  INSUMOS: "Custo de Alimentos",
  EMBALAGEM: "Embalagens",
  DESCARTAVEIS: "Descartáveis / Delivery",
  UTENSILIOS: "Utensílios Operacionais",
  LIMPEZA: "Material de Limpeza",
  EQUIPAMENTOS: "Equipamentos",
  INVESTIMENTOS: "Investimentos"
};

export function dreDaCategoria(
  nomeDaCategoria: string | null | undefined,
  opcao: NatureOption | null,
  categorias: DRECategory[]
): DRECategory | null {
  const nomeDre = nomeDaCategoria ? DRE_POR_CATEGORIA[nomeDaCategoria.trim().toUpperCase()] : undefined;
  if (!nomeDre) return null;
  const achada = categorias.find((categoria) => categoria.name === nomeDre) ?? null;
  if (!achada) return null;
  if (opcao && !opcao.dreGroups.includes(achada.dreGroup)) return null;
  return achada;
}
