/**
 * Refino de subcategorias que já existem: separa as grandes demais (LIMPEZA > LIMPEZA, VINHO, DESTILADOS…),
 * e corrige as mal colocadas. Só PROPÕE: nada aqui grava. A saída vira uma planilha para o dono revisar.
 *
 * Cada refino vale para UMA subcategoria atual dentro de uma categoria. Regra por palavra inteira no nome; a
 * primeira que casa decide, então a ordem importa. `limpar: true` diz que a subcategoria atual está errada
 * e deve ficar vazia (o item é de outra categoria).
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";

const palavra = (alternativas: string) => new RegExp(`(?<![a-z0-9])(${alternativas})(?![a-z0-9])`);

type Regra = { subcategory: string | null; pattern: RegExp; categoriaSugerida?: string };
type Refino = { categoria: string; subcategoriaAtual: string; regras: Regra[] };

export const REFINAMENTOS: Refino[] = [
  {
    categoria: "bebidas",
    subcategoriaAtual: "vinho",
    regras: [
      { subcategory: "VINHO DO PORTO", pattern: palavra("porto") },
      { subcategory: "VINHO ROSE", pattern: palavra("rose") },
      { subcategory: "VINHO BRANCO", pattern: palavra("branco|bco|bc|blanc|chardonnay|chardonay|grigio|riesling|verde|white|rueda") },
      { subcategory: "VINHO TINTO", pattern: palavra("tinto|cabernet|carbenet|malbec|merlot|carmenere|noir|syrah|tannat|blend|primitivo|bordeaux|red") }
    ]
  },
  {
    categoria: "bebidas",
    subcategoriaAtual: "destilados",
    regras: [
      { subcategory: "REFRESCOS E XAROPES", pattern: palavra("xarope") },
      { subcategory: "SAQUE", pattern: palavra("sake|saque|azuma|mirin") },
      { subcategory: "LICORES E APERITIVOS", pattern: palavra("licor|aperitivo|aperol|campari|vermouth|martini|curacau|contreau|bitter") },
      { subcategory: "WHISKY", pattern: palavra("whisky|whiskey|blended|black label|red label|cutty sark|white horse") },
      { subcategory: "GIN", pattern: palavra("gin") },
      { subcategory: "VODKA", pattern: palavra("vodka") },
      { subcategory: "RUM E TEQUILA", pattern: palavra("rum|bacardi|kraken|tequila|cuervo") },
      { subcategory: "CACHACA", pattern: palavra("cachaca|sagatiba|barreiro|umburana|amburana|santo grau|jambu|tombada|1922") }
    ]
  },
  {
    categoria: "limpeza",
    subcategoriaAtual: "limpeza",
    regras: [
      { subcategory: "LUVAS E SACOS DE LIXO", pattern: palavra("luva|saco lixo") },
      { subcategory: "PAPEIS DESCARTAVEIS", pattern: palavra("guardanapo|pap int|interf|papel") },
      { subcategory: "ALCOOL E ANTISSEPTICOS", pattern: palavra("alcool|gel|sanitizante") },
      { subcategory: "UTENSILIOS DE LIMPEZA", pattern: palavra("esponja|fibra|pano|perfex|vassoura|rodo|escova|suporte|cabo|frasco|gatilho") },
      { subcategory: "QUIMICOS DE LIMPEZA", pattern: palavra("agua sanitaria|desengordurante|limpa|limp|detergente|desinfetante|cheff|js dry|js wash|peroxy|desentupidor|inseticida|insetisida|secante") }
    ]
  },
  {
    categoria: "material de escritorio",
    subcategoriaAtual: "material de escritorio",
    regras: [
      { subcategory: null, categoriaSugerida: "DESCARTAVEIS", pattern: palavra("copo") },
      { subcategory: "IMPRESSAO E ETIQUETAS", pattern: palavra("tinta|toner|bobina|etiqueta") },
      { subcategory: "FITAS E COLAS", pattern: palavra("fita|frita crepe|cola|three bond|super bonde") },
      { subcategory: "FESTA E PRESENTE", pattern: palavra("presente|mensagem|kraft") },
      { subcategory: "PAPELARIA", pattern: palavra("bloco|caneta|cartao de ponto|clip|envelope|grampeador|grampo|lapiseira|pasta|pincel|pos titi|sulfite|tesoura|vale|escritorio") }
    ]
  },
  {
    categoria: "material de escritorio",
    subcategoriaAtual: "embalagem",
    regras: [{ subcategory: "IMPRESSAO E ETIQUETAS", pattern: palavra("bobina|etiqueta") }]
  },
  {
    categoria: "embalagem",
    subcategoriaAtual: "delivery",
    regras: [
      { subcategory: "ETIQUETAS E LACRES", pattern: palavra("etiqueta|lacre") },
      { subcategory: "FILMES E BOBINAS", pattern: palavra("filme|bobina") },
      { subcategory: "SACOLAS E SACOS", pattern: palavra("sacola|saco") },
      { subcategory: "TALHERES DE DELIVERY", pattern: palavra("garfo|faca|colher|kit") },
      { subcategory: "POTES E GARRAFAS", pattern: palavra("pote|garrafa|marmita") }
    ]
  },
  {
    categoria: "embalagem",
    subcategoriaAtual: "embalagem",
    regras: [
      { subcategory: "ETIQUETAS E LACRES", pattern: palavra("etiqueta|lacre") },
      { subcategory: "SACOLAS E SACOS", pattern: palavra("sacola|saco") }
    ]
  },
  {
    categoria: "uniformes",
    subcategoriaAtual: "uniforme",
    regras: [
      { subcategory: "TOUCAS E EPI", pattern: palavra("touca|cinta|epi") },
      { subcategory: "CALCADOS", pattern: palavra("bota|sapatenis|sapato|tenis") },
      { subcategory: "CALCAS", pattern: palavra("calca") },
      { subcategory: "CAMISETAS E AVENTAIS", pattern: palavra("camiseta|camisa|avental|aventais") }
    ]
  },
  {
    categoria: "flv",
    subcategoriaAtual: "legumes",
    regras: [
      { subcategory: "ALHO E CEBOLA", pattern: palavra("alho|cebola") },
      { subcategory: "PIMENTAS", pattern: palavra("pimenta") },
      { subcategory: "TOMATES E PIMENTOES", pattern: palavra("tomate|pimentao") },
      { subcategory: "TUBERCULOS E RAIZES", pattern: palavra("batata|mandioca|mandioquinha|inhame|cenoura|beterraba|gengibre") }
    ]
  },
  {
    categoria: "flv",
    subcategoriaAtual: "verduras",
    regras: [
      { subcategory: "ERVAS FRESCAS", pattern: palavra("alecrim|coentro|dill|erva doce|hortela|manjericao|manjeriquinho|salsa|salvia|tomilho|cebolinha|cebolete") },
      { subcategory: "FOLHAS", pattern: palavra("alface|acelga|agriao|almeirao|couve|endivia|escarola|espinafre|radicchio|rucula|repolho") }
    ]
  },
  // Mal colocados: o item pertence a outra subcategoria da mesma categoria, ou a nenhuma.
  { categoria: "molhos temperos e conservas", subcategoriaAtual: "agua", regras: [{ subcategory: "TEMPEROS E ESPECIARIAS", pattern: palavra("caldo") }] },
  { categoria: "paes e massas", subcategoriaAtual: "cafe funcionario", regras: [{ subcategory: "PAES", pattern: palavra("pao|paes") }] },
  { categoria: "peixes", subcategoriaAtual: "carnes nobre", regras: [{ subcategory: "PEIXES E FILES", pattern: palavra("salmao|file|bacalhau|tilapia") }] },
  { categoria: "equipamentos", subcategoriaAtual: "material de escritorio", regras: [{ subcategory: "TECNOLOGIA", pattern: palavra("som|carregador|filtro de linha|rotulador") }] },
  { categoria: "descartaveis", subcategoriaAtual: "material de escritorio", regras: [{ subcategory: null, pattern: palavra("copo") }] }
];

export type PropostaDeRefino = {
  subcategory: string | null;
  /** Só aparece quando a regra manda esvaziar a subcategoria atual. */
  esvaziar: boolean;
  categoriaSugerida: string | null;
  reason: string;
};

/** Refino de UM produto que já tem subcategoria; nulo se não há refino para a subcategoria dele. */
export function proposeRefinement(input: { name: string; categoryName: string | null; subcategoryName: string | null }): PropostaDeRefino | null {
  const categoria = normalizeText(input.categoryName ?? "");
  const atual = normalizeText(input.subcategoryName ?? "");
  const refino = REFINAMENTOS.find((r) => r.categoria === categoria && r.subcategoriaAtual === atual);
  if (!refino) return null;
  const nome = normalizeText(input.name);
  const regra = refino.regras.find((candidata) => candidata.pattern.test(nome));
  if (!regra) return { subcategory: null, esvaziar: false, categoriaSugerida: null, reason: "o nome não casa com nenhuma subcategoria nova: fica onde está" };
  return {
    subcategory: regra.subcategory,
    esvaziar: regra.subcategory === null,
    categoriaSugerida: regra.categoriaSugerida ?? null,
    reason: regra.subcategory === null ? "a subcategoria atual não serve para este item" : "palavra-chave no nome"
  };
}

/** Subcategorias atuais (por categoria) que têm refino: o que o script de proposta vai varrer. */
export function subcategoriasComRefino(): Array<{ categoria: string; subcategoriaAtual: string }> {
  return REFINAMENTOS.map(({ categoria, subcategoriaAtual }) => ({ categoria, subcategoriaAtual }));
}
