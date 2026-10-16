/**
 * Natureza do item: responde "o que e isto?" no cadastro de produto.
 *
 * Antes a resposta era deduzida da combinacao categoria DRE + categoria + "controla estoque"
 * (e de um campo livre, accountType). A natureza e explicita e so SUGERE os demais campos: o
 * calculo do CMV continua lendo dreGroup = 'CMV_COMPRAS', nada aqui o altera.
 */

export const PRODUCT_NATURES = ["INSUMO", "EMBALAGEM", "CONSUMO", "DURAVEL", "SERVICO"] as const;
export type ProductNatureValue = (typeof PRODUCT_NATURES)[number];

export type NatureDefaults = {
  label: string;
  description: string;
  /** Grupos de DRE que o formulario sugere (o primeiro e o padrao). */
  dreGroups: string[];
  controlsStock: boolean;
  /** Pede unidade e categoria de produto. Servico nao e item fisico. */
  fisico: boolean;
  /** Item que, por definicao, compoe o CMV. */
  entraNoCmv: boolean;
};

export const NATURE_DEFAULTS: Record<ProductNatureValue, NatureDefaults> = {
  INSUMO: {
    label: "Insumo ou mercadoria",
    description: "Alimento, bebida ou ingrediente que vira prato ou é vendido.",
    dreGroups: ["CMV_COMPRAS"],
    controlsStock: true,
    fisico: true,
    entraNoCmv: true
  },
  EMBALAGEM: {
    label: "Embalagem ou descartável",
    description: "Embalagem de delivery e descartáveis que saem junto com o pedido.",
    dreGroups: ["CMV_COMPRAS"],
    controlsStock: true,
    fisico: true,
    entraNoCmv: true
  },
  CONSUMO: {
    label: "Material de consumo",
    description: "Limpeza, escritório e itens que se gastam sem entrar no prato.",
    dreGroups: ["DESPESAS_GERAIS"],
    controlsStock: true,
    fisico: true,
    entraNoCmv: false
  },
  DURAVEL: {
    label: "Utensílio, equipamento ou uniforme",
    description: "Bem que dura: panela, taça, equipamento, uniforme.",
    dreGroups: ["DESPESAS_GERAIS", "PLANEJAMENTO"],
    controlsStock: false,
    fisico: true,
    entraNoCmv: false
  },
  SERVICO: {
    label: "Serviço ou despesa",
    description: "Manutenção, software, publicidade: não é item físico.",
    dreGroups: ["DESPESAS_GERAIS", "DESPESAS_OPERACIONAIS"],
    controlsStock: false,
    fisico: false,
    entraNoCmv: false
  }
};

export type CorpoParaValidar = {
  nature?: string | null;
  unitMeasureId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  dreCategoryId?: string | null;
  inventorySectorId?: string | null;
  sectorName?: string | null;
  controlsStock?: boolean;
  [key: string]: unknown;
};

function ehNatureza(valor: unknown): valor is ProductNatureValue {
  return typeof valor === "string" && (PRODUCT_NATURES as readonly string[]).includes(valor);
}

function preenchido(valor: unknown): boolean {
  return typeof valor === "string" && valor.trim() !== "";
}

/**
 * Campos que faltam num cadastro NOVO com natureza informada.
 *
 * Sem natureza devolve vazio: o cliente antigo (anterior a tela nova) segue como antes.
 * Edicao de produto legado nao passa por aqui.
 */
export function camposObrigatoriosFaltando(corpo: CorpoParaValidar): string[] {
  if (!ehNatureza(corpo.nature)) return [];
  const padrao = NATURE_DEFAULTS[corpo.nature];
  const faltando: string[] = [];

  if (padrao.fisico) {
    if (!preenchido(corpo.unitMeasureId)) faltando.push("unidade");
    if (!preenchido(corpo.categoryId) && !preenchido(corpo.categoryName)) faltando.push("categoria");
  }
  if (!preenchido(corpo.dreCategoryId)) faltando.push("categoria DRE");

  const controlaEstoque = corpo.controlsStock ?? padrao.controlsStock;
  if (padrao.fisico && controlaEstoque && !preenchido(corpo.inventorySectorId) && !preenchido(corpo.sectorName)) {
    faltando.push("setor");
  }
  return faltando;
}

export type EntradaDeAviso = {
  nature: string | null | undefined;
  dreGroup: string | null | undefined;
  controlsStock: boolean;
};

/** Combinacoes que fogem do padrao da natureza. Avisam, nao bloqueiam. */
export function avisosDaNatureza(entrada: EntradaDeAviso): string[] {
  if (!ehNatureza(entrada.nature)) return [];
  const padrao = NATURE_DEFAULTS[entrada.nature];
  const avisos: string[] = [];
  const noCmv = entrada.dreGroup === "CMV_COMPRAS";

  if (padrao.entraNoCmv && entrada.dreGroup && !noCmv) {
    avisos.push(`${padrao.label} costuma entrar no CMV, mas a categoria DRE escolhida está fora dele.`);
  }
  if (!padrao.entraNoCmv && noCmv) {
    avisos.push(`${padrao.label} não costuma entrar no CMV, mas a categoria DRE escolhida está dentro dele.`);
  }
  if (padrao.entraNoCmv && !entrada.controlsStock) {
    avisos.push(`${padrao.label} costuma controlar estoque; sem isso ele some da contagem.`);
  }
  return avisos;
}

const PALAVRAS_SEM_PESO = new Set(["com", "sem", "para", "por", "das", "dos", "uma", "uns", "tipo"]);

export function palavrasDoNome(texto: string): string[] {
  return texto
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3 && !PALAVRAS_SEM_PESO.has(palavra));
}

export type CandidatoSimilar = { id: string; name: string; normalizedName: string };

/**
 * Ordena candidatos pelas palavras em comum com o nome digitado (ja normalizado).
 * Quem nao divide nenhuma palavra fica de fora.
 */
export function rankSimilarNames<T extends CandidatoSimilar>(
  nomeNormalizado: string,
  candidatos: T[],
  limite = 5
): Array<T & { score: number }> {
  const buscadas = new Set(palavrasDoNome(nomeNormalizado));
  if (buscadas.size === 0) return [];

  return candidatos
    .map((candidato) => {
      const score = palavrasDoNome(candidato.normalizedName).filter((palavra) => buscadas.has(palavra)).length;
      return { ...candidato, score };
    })
    .filter((candidato) => candidato.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, limite);
}
