// Regras da tela de Fichas Técnicas que não dependem de React: previsão de custo
// enquanto se monta a ficha, situação de cada prato, filtro e ordenação da lista.
//
// A fonte da verdade do custo é o backend (modules/dishes/dish-cost.ts). A previsão
// daqui só existe para o número aparecer enquanto se digita, e por isso copia as
// mesmas regras de unidade — inclusive os sinônimos (GR, UND, LT...). Sem eles a
// tela mostrava "—" e um aviso falso para o que o backend calcula normalmente.

import type { DishListItem, DishUnitConversion } from "../api/client";

/** Até aqui o CMV é bom. */
export const CMV_BOM = 32;
/** Acima daqui o CMV é alto; entre os dois, atenção. */
export const CMV_ALTO = 40;

// ─── Unidades ────────────────────────────────────────────────────────────────

const SINONIMOS: Record<string, string> = {
  UNI: "UN", UND: "UN", UNIDADE: "UN", UNIDADES: "UN",
  CAIXA: "CX", PCTE: "PCT", PACOTE: "PCT", FARDO: "FD",
  LT: "L", LTS: "L", LITRO: "L", LITROS: "L",
  GR: "G", GRS: "G", GRAMA: "G", GRAMAS: "G",
  K: "KG", KGS: "KG", QUILO: "KG", KILO: "KG"
};

/** Massa e volume são física: valem para qualquer produto. */
const FATORES_UNIVERSAIS: Record<string, number> = {
  "G>KG": 0.001, "KG>G": 1000, "ML>L": 0.001, "L>ML": 1000
};

/** Unidades que sempre aparecem como opção quando a grandeza combina com a do produto. */
const IRMAS_UNIVERSAIS: Record<string, string[]> = {
  KG: ["G"], G: ["KG"], L: ["ML"], ML: ["L"]
};

export function normalizarUnidade(unidade: unknown): string {
  const bruta = String(unidade ?? "").trim().toUpperCase().replace(/\.+$/, "");
  return SINONIMOS[bruta] ?? bruta;
}

/** Quantos "para" cabem em 1 "de"; null quando não há como saber. */
export function fatorConversao(
  de: unknown,
  para: unknown,
  conversoes: DishUnitConversion[]
): number | null {
  const origem = normalizarUnidade(de);
  const destino = normalizarUnidade(para);
  if (!origem || !destino) return null;
  if (origem === destino) return 1;

  const direta = conversoes.find(
    (c) => normalizarUnidade(c.fromUnit) === origem && normalizarUnidade(c.toUnit) === destino
  );
  if (direta && Number.isFinite(direta.factor) && direta.factor > 0) return direta.factor;

  const inversa = conversoes.find(
    (c) => normalizarUnidade(c.fromUnit) === destino && normalizarUnidade(c.toUnit) === origem
  );
  if (inversa && Number.isFinite(inversa.factor) && inversa.factor > 0) return 1 / inversa.factor;

  return FATORES_UNIVERSAIS[`${origem}>${destino}`] ?? null;
}

/**
 * Unidades em que dá para lançar o ingrediente: a do estoque primeiro, depois as que
 * convertem para ela. Oferecer só estas evita digitar "gr", "g." ou uma unidade sem
 * conversão — o erro que mais deixava a ficha com custo parcial.
 */
export function unidadesPossiveis(unidadeDoProduto: string | null, conversoes: DishUnitConversion[]): string[] {
  const base = normalizarUnidade(unidadeDoProduto);
  if (!base) return [];

  const candidatas = [
    base,
    ...(IRMAS_UNIVERSAIS[base] ?? []),
    ...conversoes.flatMap((c) => [normalizarUnidade(c.fromUnit), normalizarUnidade(c.toUnit)])
  ];

  const unicas = [...new Set(candidatas.filter(Boolean))];
  return unicas.filter((u) => fatorConversao(u, base, conversoes) != null);
}

/** Medidas que a ficha sempre oferece; para as que ainda não convertem, a pessoa informa o valor ali mesmo. */
export const MEDIDAS_DA_FICHA = ["G", "KG", "ML", "L"] as const;

export type OpcaoDeUnidade = { value: string; label: string; converte: boolean };

/**
 * Tudo que dá para escolher: a unidade do estoque, g/kg/ml/l e a que já está na linha. Quem não
 * converte ainda vem marcada "(informar)": escolher abre o campo para dizer quanto vale. Antes só
 * apareciam as que já convertiam, e quem queria ml não achava a opção.
 */
export function opcoesDeUnidade(
  unidadeDoProduto: string | null,
  conversoes: DishUnitConversion[],
  unidadeAtual: string
): OpcaoDeUnidade[] {
  const base = normalizarUnidade(unidadeDoProduto);
  const todas = [...new Set([base, ...MEDIDAS_DA_FICHA, normalizarUnidade(unidadeAtual)].filter(Boolean))];
  const convertiveis = new Set(unidadesPossiveis(unidadeDoProduto, conversoes));
  return todas.map((value) => {
    const converte = convertiveis.has(value) || value === base;
    // "(informar)" só onde dá para informar: uma unidade estranha (CX, MÇ) não tem o campo.
    return { value, converte, label: converte || !medidaInformavel(value) ? value : `${value} (informar)` };
  });
}

/** A medida em que dá para informar a conversão ("1 UN = ? G"); null quando a unidade não é uma delas. */
export function medidaInformavel(unidade: string): string | null {
  const u = normalizarUnidade(unidade);
  return (MEDIDAS_DA_FICHA as readonly string[]).includes(u) ? u : null;
}

/**
 * Unidade em que a pessoa provavelmente lança: grama e mililitro quando existem — é como a
 * cozinha pesa. Sem elas, a do estoque. Quem monta a ficha não deveria digitar 0,03 UN.
 */
export function unidadePadrao(unidadeDoProduto: string | null, conversoes: DishUnitConversion[]): string {
  const possiveis = unidadesPossiveis(unidadeDoProduto, conversoes);
  return possiveis.find((u) => u === "G") ?? possiveis.find((u) => u === "ML") ?? possiveis[0] ?? (normalizarUnidade(unidadeDoProduto) || "UN");
}

// ─── Custo previsto ──────────────────────────────────────────────────────────

export type IngredientePrevisto = {
  /** Texto do campo (aceita "0,5"); vazio conta como zero. */
  quantity: string;
  unit: string;
  /** Perda em PERCENTUAL, como o campo da tela (7 = 7%). */
  wasteFactor: string;
  /** Custo médio por 1 unidade de estoque do produto; 0 quando não há. */
  unitCost: number;
  productUnit: string | null;
  conversions: DishUnitConversion[];
};

/** "0,5" e "0.5" são o mesmo número; vazio ou lixo viram NaN para quem decide o que fazer. */
export function lerNumero(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  const limpo = String(texto ?? "").trim().replace(/\s/g, "").replace(",", ".");
  return limpo === "" ? Number.NaN : Number(limpo);
}

/** Custo do ingrediente, ou null quando falta conversão ou custo (nunca um número errado). */
export function custoPrevisto(item: IngredientePrevisto): number | null {
  if (!item.unitCost) return null;
  const fator = fatorConversao(item.unit, item.productUnit, item.conversions);
  if (fator == null) return null;

  const quantidade = lerNumero(item.quantity);
  const perda = lerNumero(item.wasteFactor);
  const qtd = Number.isFinite(quantidade) ? quantidade : 0;
  const perdaFracao = Number.isFinite(perda) ? perda / 100 : 0;
  return qtd * fator * (1 + perdaFracao) * item.unitCost;
}

/** Por que o custo do ingrediente não foi calculado; null quando foi. */
export function motivoSemCusto(item: IngredientePrevisto): string | null {
  if (!item.unitCost) return "O produto ainda não tem custo médio no estoque.";
  if (fatorConversao(item.unit, item.productUnit, item.conversions) == null) {
    const de = normalizarUnidade(item.unit) || "(vazio)";
    const para = normalizarUnidade(item.productUnit) || "(vazio)";
    return `Sem conversão de ${de} para ${para}. Cadastre a conversão no produto (Estoque › Produtos).`;
  }
  return null;
}

/** 0,07 → "7"; 0,0525 → "5,25". Evita o 7.000000000000001 de multiplicar por 100 em float. */
export function fracaoParaPercentual(fracao: number): string {
  const percentual = Math.round((Number(fracao) || 0) * 10_000) / 100;
  return String(percentual);
}

/** "7" → 0,07 (4 casas, que é o que o banco guarda). */
export function percentualParaFracao(texto: string): number {
  const percentual = lerNumero(texto);
  if (!Number.isFinite(percentual)) return 0;
  return Math.round(percentual * 100) / 10_000;
}

// ─── Situação de cada prato ──────────────────────────────────────────────────

export type SituacaoDaFicha = "sem-ficha" | "incompleta" | "sem-preco" | "cmv-alto" | "ok";

type PratoParaSituacao = Pick<DishListItem, "itemsCount" | "custoIncompleto" | "salePriceDefault" | "cmvPercentual">;

/**
 * Em que pé está a ficha. A ordem importa: custo parcial subestima o CMV, então
 * "incompleta" vem antes de qualquer julgamento sobre preço ou margem.
 */
export function situacaoDaFicha(prato: PratoParaSituacao): SituacaoDaFicha {
  if (prato.itemsCount === 0) return "sem-ficha";
  if (prato.custoIncompleto) return "incompleta";
  if (prato.salePriceDefault == null) return "sem-preco";
  if (prato.cmvPercentual != null && prato.cmvPercentual > CMV_ALTO) return "cmv-alto";
  return "ok";
}

export type FaixaDeCmv = { tom: "success" | "warning" | "danger"; rotulo: string };

export function faixaDeCmv(cmv: number | null | undefined): FaixaDeCmv | null {
  if (cmv == null || !Number.isFinite(cmv)) return null;
  if (cmv > CMV_ALTO) return { tom: "danger", rotulo: "alto" };
  if (cmv > CMV_BOM) return { tom: "warning", rotulo: "atenção" };
  return { tom: "success", rotulo: "bom" };
}

// ─── Lista: busca, filtro, ordem ─────────────────────────────────────────────

/** Sem acento, minúsculo e com espaços únicos: "Purê" acha "pure". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type FiltroDaLista = {
  busca: string;
  categoriaId: string;
  situacao: SituacaoDaFicha | "todos";
  mostrarInativos: boolean;
};

export function filtrarPratos(pratos: DishListItem[], filtro: FiltroDaLista): DishListItem[] {
  // Cada palavra digitada precisa aparecer, em qualquer ordem: "risoto camarao" acha "Risoto de camarão".
  const palavras = normalizarBusca(filtro.busca).split(" ").filter(Boolean);
  return pratos.filter((prato) => {
    if (!filtro.mostrarInativos && !prato.isActive) return false;
    if (filtro.categoriaId && prato.category?.id !== filtro.categoriaId) return false;
    if (filtro.situacao !== "todos" && situacaoDaFicha(prato) !== filtro.situacao) return false;
    if (palavras.length === 0) return true;
    const texto = normalizarBusca(`${prato.name} ${prato.code ?? ""}`);
    return palavras.every((palavra) => texto.includes(palavra));
  });
}

export type OrdemDaLista = "nome" | "cmv" | "margem" | "pendencias";

const porNome = (a: DishListItem, b: DishListItem) => a.name.localeCompare(b.name, "pt-BR");

/** Quem não tem o número vai para o fim — "sem CMV" não é "CMV baixo". */
function nulosPorUltimo(a: number | null, b: number | null, decrescente: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return decrescente ? b - a : a - b;
}

const PESO_PENDENCIA: Record<SituacaoDaFicha, number> = {
  "sem-ficha": 0, incompleta: 1, "sem-preco": 2, "cmv-alto": 3, ok: 4
};

export function ordenarPratos(pratos: DishListItem[], ordem: OrdemDaLista): DishListItem[] {
  const copia = [...pratos];
  switch (ordem) {
    case "cmv":
      return copia.sort((a, b) => nulosPorUltimo(a.cmvPercentual, b.cmvPercentual, true) || porNome(a, b));
    case "margem":
      return copia.sort((a, b) => nulosPorUltimo(a.margemBruta, b.margemBruta, false) || porNome(a, b));
    case "pendencias":
      return copia.sort((a, b) => PESO_PENDENCIA[situacaoDaFicha(a)] - PESO_PENDENCIA[situacaoDaFicha(b)] || porNome(a, b));
    default:
      return copia.sort(porNome);
  }
}

/**
 * Quantos pratos em cada situação, para os contadores dos filtros e a barra de andamento.
 * Por padrão só os ATIVOS: ninguém monta ficha de prato que saiu. Os chips passam
 * `incluirInativos` quando "Mostrar inativos" está ligado, para o número bater com a lista.
 */
export function contarPorSituacao(
  pratos: DishListItem[],
  incluirInativos = false
): Record<SituacaoDaFicha, number> & { total: number; comFicha: number } {
  const contagem = { "sem-ficha": 0, incompleta: 0, "sem-preco": 0, "cmv-alto": 0, ok: 0, total: 0, comFicha: 0 };
  for (const prato of pratos) {
    if (!prato.isActive && !incluirInativos) continue;
    contagem[situacaoDaFicha(prato)] += 1;
    contagem.total += 1;
    if (prato.itemsCount > 0) contagem.comFicha += 1;
  }
  return contagem;
}

/** Quantidade sem zeros inúteis: 150 → "150", 0,25 → "0,25", 1,5 → "1,5". */
export function formatarQuantidade(quantidade: number): string {
  return quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

// ─── Rótulos ─────────────────────────────────────────────────────────────────

const CANAIS: Record<string, string> = {
  NOVENTA_NOVE: "99 Food",
  IFOOD: "iFood",
  KEETA: "Keeta",
  SALAO: "Salão"
};

export function rotuloDoCanal(canal: string): string {
  return CANAIS[canal] ?? canal;
}

export const ROTULO_DA_SITUACAO: Record<SituacaoDaFicha, string> = {
  "sem-ficha": "Sem ficha",
  incompleta: "Incompleta",
  "sem-preco": "Sem preço",
  "cmv-alto": "CMV alto",
  ok: "Pronta"
};

// ─── Formulário: validação e payload ─────────────────────────────────────────

export type CamposDaFicha = {
  name: string;
  code: string;
  categoryId: string;
  salePriceDefault: string;
  yieldQty: string;
  yieldUnit: string;
  notes: string;
};

export type ItemDaFicha = IngredientePrevisto & {
  tempId: string;
  productId: string;
  productName: string;
  notes: string;
  /** Texto "1 UN = 5 KG (lido do nome do produto)" quando a conversão veio do nome. */
  embalagemInferida?: string | null;
};

export type ErroDoItem = { campo: "quantity" | "wasteFactor"; mensagem: string };

export type ErrosDaFicha = {
  name?: string;
  salePriceDefault?: string;
  yieldQty?: string;
  /** Por `tempId` do ingrediente; `campo` diz qual entrada corrigir. */
  itens: Record<string, ErroDoItem>;
};

export function validarFicha(campos: CamposDaFicha, itens: ItemDaFicha[]): ErrosDaFicha {
  const erros: ErrosDaFicha = { itens: {} };

  if (!campos.name.trim()) erros.name = "Informe o nome do prato.";

  if (campos.salePriceDefault.trim() !== "") {
    const preco = lerNumero(campos.salePriceDefault);
    if (!Number.isFinite(preco) || preco < 0) erros.salePriceDefault = "Informe um preço válido (zero ou mais).";
  }

  const rendimento = lerNumero(campos.yieldQty);
  if (!Number.isFinite(rendimento) || rendimento <= 0) erros.yieldQty = "O rendimento precisa ser maior que zero.";

  for (const item of itens) {
    const quantidade = lerNumero(item.quantity);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      erros.itens[item.tempId] = { campo: "quantity", mensagem: "Informe a quantidade (maior que zero)." };
      continue;
    }
    if (item.wasteFactor.trim() !== "") {
      const perda = lerNumero(item.wasteFactor);
      if (!Number.isFinite(perda) || perda < 0 || perda > 100) {
        erros.itens[item.tempId] = { campo: "wasteFactor", mensagem: "A perda deve ficar entre 0% e 100%." };
      }
    }
  }

  return erros;
}

export function temErros(erros: ErrosDaFicha): boolean {
  return Boolean(erros.name || erros.salePriceDefault || erros.yieldQty || Object.keys(erros.itens).length > 0);
}

/** O que o backend espera: números de verdade, unidade normalizada e perda como fração. */
export function montarPayloadDaFicha(
  campos: CamposDaFicha,
  itens: ItemDaFicha[],
  opcoes: { id?: string; isActive?: boolean } = {}
): Record<string, unknown> {
  const preco = lerNumero(campos.salePriceDefault);
  return {
    ...(opcoes.id ? { id: opcoes.id } : {}),
    name: campos.name.trim(),
    code: campos.code.trim(),
    categoryId: campos.categoryId,
    salePriceDefault: Number.isFinite(preco) ? preco : null,
    yieldQty: lerNumero(campos.yieldQty),
    yieldUnit: campos.yieldUnit.trim().toUpperCase() || "UN",
    notes: campos.notes.trim(),
    ...(opcoes.isActive === undefined ? {} : { isActive: opcoes.isActive }),
    items: itens.map((item, indice) => ({
      productId: item.productId,
      quantity: lerNumero(item.quantity),
      unit: normalizarUnidade(item.unit) || item.unit.trim(),
      wasteFactor: percentualParaFracao(item.wasteFactor),
      notes: item.notes.trim() || null,
      sortOrder: indice
    }))
  };
}

/** Totais ao vivo do formulário, na mesma regra do backend (preço é por porção). */
export function resumoDaFicha(campos: Pick<CamposDaFicha, "salePriceDefault" | "yieldQty">, itens: IngredientePrevisto[]) {
  const custoDaReceita = itens.reduce((soma, item) => soma + (custoPrevisto(item) ?? 0), 0);
  const rendimento = lerNumero(campos.yieldQty);
  const porcoes = Number.isFinite(rendimento) && rendimento > 0 ? rendimento : 1;
  const custoPorPorcao = custoDaReceita / porcoes;
  const preco = lerNumero(campos.salePriceDefault);
  const temPreco = Number.isFinite(preco) && preco >= 0 && campos.salePriceDefault.trim() !== "";

  return {
    custoDaReceita,
    custoPorPorcao,
    margemBruta: temPreco ? preco - custoPorPorcao : null,
    cmvPercentual: temPreco && preco > 0 ? (custoPorPorcao / preco) * 100 : null,
    incompleto: itens.some((item) => custoPrevisto(item) == null)
  };
}
