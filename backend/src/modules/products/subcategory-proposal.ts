/**
 * Proposta de subcategoria para produto que está só na categoria.
 *
 * Só PROPÕE: nada aqui grava. A saída vira uma planilha para o dono revisar. Regra por palavra inteira no
 * nome do produto, dentro da categoria em que ele já está; a primeira regra que casa decide, então a ordem
 * importa ("biscoito maizena" é biscoito antes de ser amido). Nome que não casa fica sem proposta, para
 * classificar à mão.
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";

// O nome já vem normalizado (a-z, 0-9 e espaço): palavra inteira é não ter letra ou número colado nas pontas.
const palavra = (alternativas: string) => new RegExp(`(?<![a-z0-9])(${alternativas})(?![a-z0-9])`);

type Regra = { subcategory: string; pattern: RegExp };

/** Subcategorias por categoria (nome normalizado da categoria). A ordem das regras é a ordem de decisão. */
export const SUBCATEGORY_RULES: Record<string, Regra[]> = {
  "secos e graos": [
    { subcategory: "BISCOITOS E SNACKS", pattern: palavra("biscoito|doritos|batata palha|cereais|taco shell") },
    { subcategory: "FARINHAS E AMIDOS", pattern: palavra("farinha|fuba|amido|maizena|maisena|polvilho|flocao|kimilho") },
    { subcategory: "ARROZ", pattern: palavra("arroz") },
    { subcategory: "FERMENTOS E MISTURAS", pattern: palavra("fermento|mistura") },
    { subcategory: "FEIJOES E GRAOS", pattern: palavra("feijao|grao de bico|lentilha") },
    { subcategory: "MACARRAO E MASSAS SECAS", pattern: palavra("macarrao|massa") },
    { subcategory: "CAFES, CHAS E ACHOCOLATADOS", pattern: palavra("cafe|cha|cappuccino|achocolatado") },
    { subcategory: "LEITES EM PO E DE COCO", pattern: palavra("leite") },
    { subcategory: "ACUCARES E ADOCANTES", pattern: palavra("acucar|adocante|mel") },
    { subcategory: "OLEAGINOSAS E FRUTAS SECAS", pattern: palavra("amendoim|castanha|nozes|pistache|damasco|uva passa|frutas secas|coco|gergelim|tahine|granola|aveia") }
  ],
  "molhos temperos e conservas": [
    { subcategory: "CONSERVAS", pattern: palavra("alcaparras|ameixa|atum|sardinha|azeitona|beterraba|champignon|cogumelo|milho|palmito|pepino|picles|pickles|tomate seco|cebolinha") },
    { subcategory: "OLEOS E AZEITES", pattern: palavra("azeite|oleo|gordura") },
    { subcategory: "MOLHOS PRONTOS", pattern: palavra("ketchup|maionese|mostarda|molho|tare|tabasco|geleia") },
    { subcategory: "TEMPEROS E ESPECIARIAS", pattern: palavra("alho|canela|chimichurri|colorifico|cravo|curcuma|curry|louro|oregano|paprica|pimenta|sal|tempero|temperos|realcador|caldo|ervas") }
  ],
  "doces e confeitaria": [
    { subcategory: "ESSENCIAS E CORANTES", pattern: palavra("essencia|corante|granulado|micanga") },
    { subcategory: "DOCE DE LEITE E LEITE CONDENSADO", pattern: palavra("doce de leite|leite condensado|ninho") },
    { subcategory: "CHOCOLATES E COBERTURAS", pattern: palavra("chocolate|choc|cobertura|cob|bom bom|kit kat|disqueti") },
    { subcategory: "DOCES PRONTOS E BALAS", pattern: palavra("goiabada|goiabinha|petit four|pacoca|pe de moleque|bala|balas|suspiro|merengue|canudinho|canudo|sorvete") },
    { subcategory: "CREMES E RECHEIOS", pattern: palavra("creme|recheio|chanty|chantilly|gelatina|geleia|illycrema") }
  ],
  "carnes e aves": [
    { subcategory: "SALGADOS E CURADOS", pattern: palavra("salgado|salgada|carne seca|charque|kit feijoada") },
    { subcategory: "LINGUICAS", pattern: palavra("linguica|paio|calabresa|toscana") },
    { subcategory: "AVES", pattern: palavra("frango|coxa|sobrecoxa") },
    { subcategory: "OUTRAS CARNES", pattern: palavra("cordeiro") },
    { subcategory: "SUINAS", pattern: palavra("suina|suino|barriga|bisteca|pernil|lombo|bacon") },
    { subcategory: "BOVINAS", pattern: palavra("acem|alcatra|contra file|costela|cupim|fralda|fraldinha|lagarto|maminha|paleta|bovina") }
  ],
  "laticinios e frios": [
    { subcategory: "OVOS E GEMAS", pattern: palavra("gema|ovo|ovos") },
    { subcategory: "FRIOS E EMBUTIDOS", pattern: palavra("presunto|apresuntado|copa|salame|peito de peru|peperoni|pepperoni") },
    { subcategory: "MANTEIGA E MARGARINA", pattern: palavra("margarina|manteiga") },
    { subcategory: "CREMES E REQUEIJOES", pattern: palavra("cream cheese|creme|requeijao") },
    { subcategory: "IOGURTES E LEITES", pattern: palavra("iogurte|leite") },
    { subcategory: "QUEIJOS", pattern: palavra("queijo|mussarela|mucarela|ricota|cheddar|coalho|parmesao|provolone|gorgonzola|brie|mascarpone|prato") }
  ],
  congelados: [
    { subcategory: "BATATAS E FRITURAS", pattern: palavra("batata|anel|aneis|noisettes") },
    { subcategory: "SALGADOS E PAES DE QUEIJO", pattern: palavra("pao de queijo|nugget|chicken nugget|dadinho|churros|tortilha|empanado|empanada") },
    { subcategory: "FRUTAS CONGELADAS", pattern: palavra("frutas") },
    { subcategory: "FRUTOS DO MAR CONGELADOS", pattern: palavra("kani|kama") }
  ],
  "paes e massas": [
    { subcategory: "MASSAS FRESCAS", pattern: palavra("massa") },
    { subcategory: "PAES", pattern: palavra("pao|paes|bag|baguete|brioche") }
  ],
  peixes: [
    { subcategory: "CAMAROES", pattern: palavra("camarao|camaroes") },
    { subcategory: "PEIXES E FILES", pattern: palavra("cacao|bacalhau|tilapia|tainha|tambaqui|file|posta") }
  ],
  limpeza: [
    { subcategory: "ALCOOL E HIGIENE", pattern: palavra("alcool|gel|sept|hand") },
    { subcategory: "UTENSILIOS DE LIMPEZA", pattern: palavra("balde|mop|pa coletora") }
  ],
  bebidas: [
    { subcategory: "GELO", pattern: palavra("gelo") },
    { subcategory: "REFRESCOS E XAROPES", pattern: palavra("refresco|flavor house|tang") }
  ],
  "liquidos de cozinha": [
    { subcategory: "VINAGRES", pattern: palavra("vinagre") },
    { subcategory: "VINHOS DE COZINHA", pattern: palavra("vinho|vh") },
    { subcategory: "SAQUE E OUTROS", pattern: palavra("saque") }
  ],
  utensilios: [
    { subcategory: "VESTUARIO DE COZINHA", pattern: palavra("avental|aventais|jaqueta|japona") },
    { subcategory: "COPOS E TACAS", pattern: palavra("copo|copos|taca|caneca") },
    { subcategory: "TALHERES", pattern: palavra("faca|garfo|colher|canudo") },
    { subcategory: "PRATOS E LOUCAS", pattern: palavra("prato|pires|xicara|garrafa") },
    { subcategory: "PANELAS E UTENSILIOS DE COZINHA", pattern: palavra("panela|assadeira|cesto|escumadeira|espatula|descascador|amassador|abridor|amolar|bisnaga|fogao|pa") }
  ],
  embalagem: [
    { subcategory: "CAIXAS E SACOS", pattern: palavra("caixa|saco|sacola|bobina") },
    { subcategory: "COPOS, TALHERES E POTES", pattern: palavra("copo|colher|garfo|pote|palito|canudo|embalagem") },
    { subcategory: "PAPEIS E FORMINHAS", pattern: palavra("papel|aluminio|forminha|filme") }
  ],
  equipamentos: [
    { subcategory: "TECNOLOGIA", pattern: palavra("smartphone|impressora|radio|campainha|carregador|tecnologia") },
    { subcategory: "FERRAMENTAS", pattern: palavra("ferramentas") },
    { subcategory: "COZINHA E ESTRUTURA", pattern: palavra("microondas|fogao|termometro|estante|lixo|lixeira") }
  ]
};

/**
 * Item que, pelo nome, parece estar na categoria errada. Só avisa na planilha: nunca move sozinho.
 * Vale para qualquer categoria listada em `deCategoria` (nome normalizado).
 */
const SUGESTOES_DE_CATEGORIA: Array<{ deCategoria: string[]; pattern: RegExp; paraCategoria: string }> = [
  { deCategoria: ["doces e confeitaria"], pattern: palavra("alho"), paraCategoria: "MOLHOS, TEMPEROS E CONSERVAS" },
  { deCategoria: ["doces e confeitaria"], pattern: palavra("requeijao"), paraCategoria: "LATICINIOS E FRIOS" },
  { deCategoria: ["doces e confeitaria"], pattern: /(?<![a-z0-9])(?<!pao de )(?<!bala de )(?<!bombom de )mel(?![a-z0-9])/, paraCategoria: "SECOS E GRAOS" },
  { deCategoria: ["laticinios e frios"], pattern: palavra("kit kat"), paraCategoria: "DOCES E CONFEITARIA" },
  { deCategoria: ["carnes e aves"], pattern: palavra("amaciante"), paraCategoria: "MOLHOS, TEMPEROS E CONSERVAS" }
];

export type PropostaDeSubcategoria = {
  subcategory: string | null;
  /** Categoria que o nome sugere, quando difere da atual: só aviso. */
  categoriaSugerida: string | null;
  reason: string;
};

export function proposeSubcategoryForProduct(input: { name: string; categoryName: string | null }): PropostaDeSubcategoria {
  const categoria = normalizeText(input.categoryName ?? "");
  const nome = normalizeText(input.name);

  const sugestao = SUGESTOES_DE_CATEGORIA.find((s) => s.deCategoria.includes(categoria) && s.pattern.test(nome));
  if (sugestao) {
    return { subcategory: null, categoriaSugerida: sugestao.paraCategoria, reason: `o nome parece de ${sugestao.paraCategoria}` };
  }

  const regras = SUBCATEGORY_RULES[categoria];
  if (!regras) return { subcategory: null, categoriaSugerida: null, reason: "categoria sem subcategorias propostas" };
  const regra = regras.find((candidata) => candidata.pattern.test(nome));
  if (!regra) return { subcategory: null, categoriaSugerida: null, reason: "o nome não casa com nenhuma subcategoria" };
  return { subcategory: regra.subcategory, categoriaSugerida: null, reason: "palavra-chave no nome" };
}

/** Todas as subcategorias que as regras propõem para a categoria (para criar as que faltam). */
export function subcategoriasDaProposta(categoryName: string): string[] {
  return (SUBCATEGORY_RULES[normalizeText(categoryName)] ?? []).map((regra) => regra.subcategory);
}
