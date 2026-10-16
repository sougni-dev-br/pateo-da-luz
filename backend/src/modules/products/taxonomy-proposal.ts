/**
 * Proposta de reclassificação dos produtos existentes (natureza, categoria, subcategoria).
 *
 * Só PROPÕE: nada aqui grava no banco. A saída vira uma planilha que o dono revisa; a aplicação é etapa
 * separada, por bloco, com comparação do DRE antes e depois (mudar a categoria DRE de um produto reescreve
 * o histórico das compras fora do CMV).
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";
import type { ProductNatureValue } from "./product-nature.js";

export type ProductRow = {
  name: string;
  categoryName: string | null;
  subcategoryName: string | null;
  sectorName: string | null;
  dreName: string | null;
  dreGroup: string | null;
  controlsStock: boolean;
};

export type Confidence = "alta" | "media" | "revisar";

export type CategoryDefinition = { nature: ProductNatureValue; dreName: string };

/** Categorias da estrutura nova. Nomes no padrão das existentes (maiúsculas, sem acento). */
export const PROPOSED_CATEGORIES: Record<string, CategoryDefinition> = {
  "CARNES E AVES": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  PEIXES: { nature: "INSUMO", dreName: "Custo de Alimentos" },
  FLV: { nature: "INSUMO", dreName: "Custo de Alimentos" },
  BEBIDAS: { nature: "INSUMO", dreName: "Bebidas" },
  "LATICINIOS E FRIOS": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  "MOLHOS, TEMPEROS E CONSERVAS": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  "SECOS E GRAOS": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  "DOCES E CONFEITARIA": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  CONGELADOS: { nature: "INSUMO", dreName: "Custo de Alimentos" },
  "LIQUIDOS DE COZINHA": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  "PAES E MASSAS": { nature: "INSUMO", dreName: "Custo de Alimentos" },
  EMBALAGEM: { nature: "EMBALAGEM", dreName: "Embalagens" },
  DESCARTAVEIS: { nature: "EMBALAGEM", dreName: "Descartáveis / Delivery" },
  LIMPEZA: { nature: "CONSUMO", dreName: "Material de Limpeza" },
  "MATERIAL DE ESCRITORIO": { nature: "CONSUMO", dreName: "Material de Escritório" },
  UTENSILIOS: { nature: "DURAVEL", dreName: "Utensílios Operacionais" },
  EQUIPAMENTOS: { nature: "DURAVEL", dreName: "Equipamentos" },
  UNIFORMES: { nature: "DURAVEL", dreName: "Uniformes" },
  INVESTIMENTOS: { nature: "DURAVEL", dreName: "Investimentos" },
  MANUTENCAO: { nature: "SERVICO", dreName: "Manutenção" },
  PUBLICIDADE: { nature: "SERVICO", dreName: "Publicidade" },
  SOFTWARE: { nature: "SERVICO", dreName: "Sistema / Software" },
  TRANSPORTE: { nature: "SERVICO", dreName: "Transporte / Mobilidade" },
  "SERVICOS DE TERCEIROS": { nature: "SERVICO", dreName: "Serviços de Terceiros" },
  "OUTRAS DESPESAS": { nature: "SERVICO", dreName: "Outras Despesas Gerais" }
};

const norm = (valor: string | null | undefined) => normalizeText(valor);

// Natureza pela categoria DRE (nome normalizado).
const NATUREZA_POR_DRE: Record<string, ProductNatureValue> = {
  "material de limpeza": "CONSUMO",
  "material de escritorio": "CONSUMO",
  "utensilios operacionais": "DURAVEL",
  equipamentos: "DURAVEL",
  uniformes: "DURAVEL",
  manutencao: "SERVICO",
  publicidade: "SERVICO",
  "sistema software": "SERVICO",
  "transporte mobilidade": "SERVICO",
  "servicos de terceiros": "SERVICO"
};

const DRE_DE_EMBALAGEM = new Set(["embalagens", "descartaveis delivery"]);

// Palavra inteira sem usar a âncora de fronteira do regex: o nome já vem normalizado (a-z, 0-9 e espaço),
// então basta não ter letra ou número colado nas pontas. Evita "sal" casar em "salame" e "cha" em "champignon".
const palavraInteira = (alternativas: string) => new RegExp(`(?<![a-z0-9])(${alternativas})(?![a-z0-9])`);

const TEM_NOME_DE_DESCARTAVEL = palavraInteira("descart[a-z]*");

export function proposeNature(row: ProductRow): { nature: ProductNatureValue | null; confidence: Confidence; reason: string } {
  const dre = norm(row.dreName);
  if (!row.dreName || !row.dreGroup) {
    return { nature: null, confidence: "revisar", reason: "produto sem categoria DRE" };
  }

  if (row.dreGroup === "CMV_COMPRAS") {
    const nature: ProductNatureValue = DRE_DE_EMBALAGEM.has(dre) ? "EMBALAGEM" : "INSUMO";
    if (!row.controlsStock) return { nature, confidence: "revisar", reason: "DRE de CMV, mas não controla estoque" };
    return { nature, confidence: "alta", reason: "DRE do grupo CMV" };
  }

  const porNome = NATUREZA_POR_DRE[dre];
  if (porNome) {
    if (porNome === "DURAVEL" && TEM_NOME_DE_DESCARTAVEL.test(norm(row.name))) {
      return { nature: porNome, confidence: "revisar", reason: "DRE de durável, mas o nome diz descartável" };
    }
    return { nature: porNome, confidence: "alta", reason: `DRE ${row.dreName}` };
  }

  if (dre === "investimentos") return { nature: "DURAVEL", confidence: "revisar", reason: "DRE de investimento" };
  if (dre === "descartaveis") return { nature: "EMBALAGEM", confidence: "revisar", reason: "DRE descartáveis fora do CMV" };
  if (["IMPOSTOS", "PESSOAL", "VALE_TRANSPORTE"].includes(row.dreGroup)) {
    return { nature: "SERVICO", confidence: "revisar", reason: `item de ${row.dreGroup} cadastrado como produto` };
  }
  return { nature: null, confidence: "revisar", reason: `DRE ${row.dreName} não indica a natureza` };
}

// Regras de insumo por palavra inteira, na ordem em que valem (a primeira que casa decide).
// A ordem importa: "pão de queijo" é congelado antes de ser laticínio; "doce de leite" é confeitaria;
// "amido de milho" é seco e não conserva de milho.
type RegraDeInsumo = { category: string; pattern: RegExp; confidence?: Confidence };

const REGRAS_DE_INSUMO: RegraDeInsumo[] = [
  { category: "LIMPEZA", pattern: palavraInteira("agua sanitaria|detergente|desinfetante|sabao|alvejante"), confidence: "media" },
  { category: "LIQUIDOS DE COZINHA", pattern: palavraInteira("vinho|saque|vinagre|vh") },
  { category: "BEBIDAS", pattern: palavraInteira("agua mineral|agua|gelo|refresco|suco"), confidence: "media" },
  // Molho, caldo e tempero antes de carnes: "caldo de carne" e "tempero para frango" não são carne.
  { category: "MOLHOS, TEMPEROS E CONSERVAS", pattern: palavraInteira("molho|tempero|temperos|caldo|extrato|shoyu|ketchup|maionese|realcador") },
  { category: "CARNES E AVES", pattern: palavraInteira("costela|rabo|bacon|lombo|linguica|carne|frango|paio|toucinho|charque|picanha|file|bovino|suino") },
  { category: "CONGELADOS", pattern: palavraInteira("pao de queijo|tortilha|congelad[oa]s?|empanad[oa]s?|nuggets") },
  { category: "PAES E MASSAS", pattern: palavraInteira("pao|paes|baguete|brioche|massa de pastel|massa para pastel") },
  {
    category: "DOCES E CONFEITARIA",
    pattern: palavraInteira(
      "doce de leite|chocolate|choc|cobertura|creme de avela|creme de pistache|creme de confeiteiro|recheio|bisnaga|granulado|confeito|leite condensado|gelatina|chantilly|chanty|essencia|corante|fondant|goiabada|goiabinha|petit four|sorvete|balas?|suspiro|merengue|pacoca|pe de moleque|canudinho folhado"
    )
  },
  {
    category: "MOLHOS, TEMPEROS E CONSERVAS",
    pattern: palavraInteira(
      "pimenta|sal|oregano|palmito|azeitona|milho verde|mini milho|ervilha|atum|sardinha|conserva|champignon|cogumelo|funghi|picles|pickles|alcaparras|tomate seco|ameixa em calda|azeite|oleo|gordura vegetal|canela|cravo|colorifico|curcuma|acafrao|paprica|louro|alho frito"
    )
  },
  {
    category: "SECOS E GRAOS",
    pattern: palavraInteira(
      "leite em po|leite de coco|biscoito|arroz|feijao|lentilha|farinha|fuba|macarrao|fermento|acucar|cafe|cha|gergelim|aveia|graos?|polvilho|trigo|adocante|sache|amido|maizena|maisena|granola|mel|coco|castanha|nozes|pistache|uva passa|frutas secas|damasco|flocao|cappuccino|mistura|taco shell|batata palha"
    )
  },
  {
    category: "LATICINIOS E FRIOS",
    pattern: palavraInteira(
      "queijo|mussarela|mucarela|ricota|requeijao|creme de leite|creme culinario|cream cheese|cheddar|leite|manteiga|margarina|iogurte|presunto|apresuntado|peito de peru|salame|copa|mortadela|peperoni|pepperoni|catupiry|parmesao|provolone|coalho|nata|gema|ovos?"
    )
  },
  // Hortifrúti ou conserva conforme a embalagem: sem como saber pelo nome, vai para revisão rápida.
  { category: "MOLHOS, TEMPEROS E CONSERVAS", pattern: palavraInteira("pepino|cebolinha|mostarda"), confidence: "media" },
  { category: "EMBALAGEM", pattern: palavraInteira("papel aluminio|filme pvc|sacola|bobina|copo de papel|descartavel|marmitex"), confidence: "media" }
];

const PREFIXO_DE_TESTE = new RegExp("^zz(?![a-z0-9])");

function categoriaDeInsumo(row: ProductRow): { category: string | null; confidence: Confidence; reason: string } {
  // "sem sal" e "com sal" descrevem o produto, não são o sal em si (manteiga sem sal é laticínio).
  const nome = norm(row.name).replace(new RegExp("(sem|com|zero) sal(?![a-z0-9])", "g"), " ");
  const regra = REGRAS_DE_INSUMO.find((candidata) => candidata.pattern.test(nome));
  if (regra) return { category: regra.category, confidence: regra.confidence ?? "alta", reason: "palavra-chave no nome" };
  if (PREFIXO_DE_TESTE.test(nome)) {
    return { category: null, confidence: "revisar", reason: "parece item de teste (prefixo ZZ): desativar?" };
  }
  if (norm(row.sectorName) === "freezer") {
    return { category: "CONGELADOS", confidence: "media", reason: "sem palavra-chave; está no setor freezer" };
  }
  return { category: null, confidence: "revisar", reason: "nome não casa com nenhuma regra" };
}

// Categoria nova das despesas hoje agrupadas em DESPESAS, pela DRE que o item já tem.
const CATEGORIA_POR_DRE_DE_DESPESA: Record<string, string> = {
  "material de escritorio": "MATERIAL DE ESCRITORIO",
  uniformes: "UNIFORMES",
  manutencao: "MANUTENCAO",
  publicidade: "PUBLICIDADE",
  equipamentos: "EQUIPAMENTOS",
  "material de limpeza": "LIMPEZA",
  "utensilios operacionais": "UTENSILIOS",
  "sistema software": "SOFTWARE",
  "transporte mobilidade": "TRANSPORTE",
  "servicos de terceiros": "SERVICOS DE TERCEIROS"
};

export function proposeCategory(row: ProductRow): { category: string | null; confidence: Confidence; reason: string } {
  const atual = norm(row.categoryName);
  const noCmv = row.dreGroup === "CMV_COMPRAS";

  if (atual === "insumos" || (atual === "" && noCmv)) return categoriaDeInsumo(row);

  if (atual === "despesas") {
    if (noCmv) {
      const insumo = categoriaDeInsumo(row);
      return { ...insumo, confidence: "revisar", reason: `item de CMV na categoria DESPESAS; ${insumo.reason}` };
    }
    const dividida = CATEGORIA_POR_DRE_DE_DESPESA[norm(row.dreName)];
    if (dividida) return { category: dividida, confidence: "alta", reason: `DRE ${row.dreName}` };
    return { category: "OUTRAS DESPESAS", confidence: "revisar", reason: `DRE ${row.dreName ?? "ausente"} sem categoria própria` };
  }

  const existente = Object.keys(PROPOSED_CATEGORIES).find((nome) => norm(nome) === atual);
  if (existente) return { category: existente, confidence: "alta", reason: "categoria atual já faz parte da estrutura" };
  return { category: null, confidence: "revisar", reason: `categoria ${row.categoryName ?? "ausente"} fora da estrutura proposta` };
}

export type SubcategoryAction = "MANTER" | "REMOVER_VAZIA" | "DESFAZER_E_LIMPAR" | "REVISAR_DUPLICADA";

export function proposeSubcategoryAction(input: { name: string; products: number; nameRepeatedIn: number }): {
  action: SubcategoryAction;
  reason: string;
} {
  const nome = input.name.trim();
  if (input.products === 0) return { action: "REMOVER_VAZIA", reason: "nenhum produto usa" };
  if (/^[0-9]+$/.test(nome)) {
    return { action: "DESFAZER_E_LIMPAR", reason: "nome numérico, resíduo de importação: os produtos ficam sem subcategoria" };
  }
  if (input.nameRepeatedIn > 1) return { action: "REVISAR_DUPLICADA", reason: "mesmo nome em mais de uma categoria" };
  return { action: "MANTER", reason: "" };
}
