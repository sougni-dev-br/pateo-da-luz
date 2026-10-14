// Regras do desperdício de insumo, sem banco: validação do lançamento, valor e resumo.
//
// Desperdício é uma decomposição do CMV, não um lançamento contábil: o produto já saiu
// do estoque e entrou no consumo (CMV = inicial + compras − final). Nada aqui baixa
// estoque nem entra no DRE — somar de novo contaria a mesma perda duas vezes.

import { normalizarUnidade, resolveUnitFactor, type UnitConversion } from "../../shared/unidades/conversao.js";

export const WASTE_REASONS = [
  { value: "EXPIRED", label: "Vencido" },
  { value: "SPOILED", label: "Estragado" },
  { value: "BREAKAGE", label: "Quebra / avaria" },
  { value: "PREPARATION_ERROR", label: "Erro de preparo" },
  { value: "PRODUCTION_LEFTOVER", label: "Sobra de produção" },
  { value: "CUSTOMER_RETURN", label: "Devolução de cliente" },
  { value: "CONTAMINATION", label: "Contaminação" },
  { value: "OTHER", label: "Outro" },
] as const;

export type WasteReasonValue = (typeof WASTE_REASONS)[number]["value"];

const REASON_VALUES = new Set<string>(WASTE_REASONS.map((r) => r.value));
export const rotuloDoMotivo = (reason: string) => WASTE_REASONS.find((r) => r.value === reason)?.label ?? reason;

/** Lançamento mais velho que isso é reconstrução de memória, não registro do dia. */
export const MAX_DIAS_PARA_TRAS = 60;
const MAX_QUANTIDADE = 1_000_000;
const MAX_OBSERVACAO = 500;

export const exigeObservacao = (reason: string) => reason === "OTHER";

export type LancamentoValido = {
  /** Insumo OU prato pronto: exatamente um dos dois vem preenchido. */
  productId: string | null;
  dishId: string | null;
  /** Quantidade como foi digitada, na unidade de `unit` (ainda não convertida). */
  quantity: number;
  /** Unidade em que a pessoa digitou (G, ML, KG...), normalizada; null = a do estoque do item. */
  unit: string | null;
  /** "1 UN = 500 G": o peso/volume que a pessoa informou na hora, para itens que ainda não convertem. */
  perUnit: PesoPorUnidade | null;
  reason: WasteReasonValue;
  occurredOn: string;
  notes: string | null;
};

/** Quanto vale 1 unidade do estoque, em massa ou volume (G, KG, ML, L). */
export type PesoPorUnidade = { quantity: number; unit: string };

const MEDIDAS_INFORMAVEIS = new Set(["G", "KG", "ML", "L"]);

export type ResultadoValidacao = { ok: true; valor: LancamentoValido } | { ok: false; erro: string };

function diaReal(texto: string): boolean {
  const time = Date.parse(`${texto}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === texto;
}

export function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "1.500": mil e quinhentos ou um e meio? Quem digita assim quase sempre quer o milhar; não se adivinha. */
export const pareceMilhar = (texto: string) => /^\d{1,3}\.\d{3}$/.test(texto.trim());

function lerQuantidade(entrada: unknown): number | null {
  const texto = String(entrada ?? "").trim().replace(",", ".");
  // A coluna é DECIMAL(14,4): mais casas arredondariam para zero e quebrariam o CHECK (500 em vez de 400).
  if (!/^\d+(\.\d{1,4})?$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0.0001 && n <= MAX_QUANTIDADE ? n : null;
}

function lerPesoPorUnidade(entrada: unknown): { ok: true; valor: PesoPorUnidade | null } | { ok: false; erro: string } {
  if (entrada == null || entrada === "") return { ok: true, valor: null };
  if (typeof entrada !== "object" || Array.isArray(entrada)) return { ok: false, erro: "Peso ou volume informado inválido." };
  const { quantity, unit } = entrada as Record<string, unknown>;
  const medida = normalizarUnidade(unit);
  if (!MEDIDAS_INFORMAVEIS.has(medida)) return { ok: false, erro: "Informe o peso ou volume de 1 unidade em g, kg, ml ou l." };
  if (pareceMilhar(String(quantity ?? ""))) return { ok: false, erro: "Use vírgula para decimais no peso ou volume (0,5). \"1.500\" é ambíguo." };
  const n = lerQuantidade(quantity);
  if (n == null) return { ok: false, erro: "Informe quanto pesa ou mede 1 unidade (maior que zero)." };
  return { ok: true, valor: { quantity: n, unit: medida } };
}

/** `hoje` é o dia de São Paulo (YYYY-MM-DD); o servidor roda em UTC. */
export function validarLancamento(entrada: Record<string, unknown>, hoje: string): ResultadoValidacao {
  const productId = String(entrada.productId ?? "").trim();
  const dishId = String(entrada.dishId ?? "").trim();
  if (Boolean(productId) === Boolean(dishId)) return { ok: false, erro: "Escolha o produto ou o prato (um dos dois)." };

  if (pareceMilhar(String(entrada.quantity ?? ""))) return { ok: false, erro: "Use vírgula para decimais (1,5). \"1.500\" é ambíguo." };
  const quantity = lerQuantidade(entrada.quantity);
  if (quantity == null) return { ok: false, erro: "Informe uma quantidade maior que zero." };

  const unidadeDigitada = String(entrada.unit ?? "").trim();
  if (unidadeDigitada && !/^[A-Za-zÀ-ú.]{1,8}$/.test(unidadeDigitada)) return { ok: false, erro: "Unidade inválida." };

  const peso = lerPesoPorUnidade(entrada.perUnit);
  if (!peso.ok) return { ok: false, erro: peso.erro };

  const reason = String(entrada.reason ?? "");
  if (!REASON_VALUES.has(reason)) return { ok: false, erro: "Escolha o motivo do desperdício." };

  const occurredOn = String(entrada.occurredOn ?? "").trim();
  if (!diaReal(occurredOn)) return { ok: false, erro: "Data inválida." };
  if (occurredOn > hoje) return { ok: false, erro: "A data do desperdício não pode ser futura." };
  if (occurredOn < somarDias(hoje, -MAX_DIAS_PARA_TRAS)) {
    return { ok: false, erro: `A data é de mais de ${MAX_DIAS_PARA_TRAS} dias atrás.` };
  }

  const notes = String(entrada.notes ?? "").trim().replace(/\s+/g, " ") || null;
  if (notes && notes.length > MAX_OBSERVACAO) return { ok: false, erro: `Observação muito longa (máximo ${MAX_OBSERVACAO}).` };
  if (exigeObservacao(reason) && !notes) return { ok: false, erro: "Descreva na observação o que aconteceu." };

  return { ok: true, valor: { productId: productId || null, dishId: dishId || null, quantity, unit: unidadeDigitada ? normalizarUnidade(unidadeDigitada) : null, perUnit: peso.valor, reason: reason as WasteReasonValue, occurredOn, notes } };
}

/** A coluna é DECIMAL(16,6): 1 g de uma embalagem de 25 kg (0,00004) ainda cabe. */
const CASAS_DA_QUANTIDADE = 1_000_000;

export type ResultadoDaConversao =
  | { ok: true; quantidade: number; fator: number; /** A conversão veio do peso informado agora, não do cadastro. */ usouPesoInformado: boolean }
  | { ok: false; erro: string };

/**
 * O que se digita (500 G) vira a unidade do estoque do item (0,1 UN). Usa a mesma regra da ficha
 * técnica: conversões cadastradas no produto, o peso lido do nome da embalagem e física de massa e
 * volume. Sem conversão o lançamento é recusado: gravar "500 UN" no lugar de "500 G" seria um
 * desperdício mil vezes maior que o real.
 */
export function converterQuantidade(
  quantidadeDigitada: number,
  unidadeDigitada: string | null,
  unidadeDoEstoque: string | null,
  conversoes: UnitConversion[],
  pesoInformado: PesoPorUnidade | null = null
): ResultadoDaConversao {
  const base = normalizarUnidade(unidadeDoEstoque);
  const digitada = normalizarUnidade(unidadeDigitada) || base;
  let fator = resolveUnitFactor(digitada, base, conversoes);
  let usouPesoInformado = false;
  // O que já está cadastrado (ou lido do nome) manda; o peso informado só preenche o que falta.
  if (fator == null && pesoInformado && base) {
    // O peso vem em kg e se lança em g? Põe os dois na mesma unidade antes: a física não encadeia sozinha (G→KG→UN).
    const emDigitada = resolveUnitFactor(pesoInformado.unit, digitada, []);
    if (emDigitada == null) {
      return { ok: false, erro: `O peso informado (${pesoInformado.unit}) não é da mesma medida que ${digitada}. Informe quanto 1 ${base} vale em ${digitada === "ML" || digitada === "L" ? "ml ou l" : "g ou kg"}.` };
    }
    fator = resolveUnitFactor(digitada, base, [{ fromUnit: base, toUnit: digitada, factor: pesoInformado.quantity * emDigitada }]);
    usouPesoInformado = fator != null;
  }
  if (fator == null) {
    return { ok: false, erro: `Não sei converter ${digitada} para ${base || "a unidade do estoque"} neste item. Informe quanto pesa ou mede 1 ${base || "unidade"}, ou lance em ${base || "a unidade do estoque"}.` };
  }
  const quantidade = Math.round(quantidadeDigitada * fator * CASAS_DA_QUANTIDADE) / CASAS_DA_QUANTIDADE;
  if (!(quantidade > 0)) return { ok: false, erro: "Quantidade pequena demais para a unidade do estoque deste item." };
  return { ok: true, quantidade, fator, usouPesoInformado };
}

/** Custo ausente ou zero não vira R$ 0,00: fica sem valor para não esconder a falta de custo. */
// Tetos de sanidade: acima disso o custo é dado ruim (compra com quantidade convertida minúscula) e o
// valor estouraria a coluna DECIMAL(14,2) do banco. Fica sem custo, como o produto sem compra.
const CUSTO_UNITARIO_MAXIMO = 1_000_000;
const VALOR_MAXIMO = 9_999_999_999;

export function calcularValor(quantidade: number, custoUnitario: number | null): number | null {
  if (custoUnitario == null || !(custoUnitario > 0) || custoUnitario > CUSTO_UNITARIO_MAXIMO) return null;
  const valor = Math.round(quantidade * custoUnitario * 100) / 100;
  return valor > VALOR_MAXIMO ? null : valor;
}

export type LinhaDeDesperdicio = {
  /** Chave do item no resumo: id do insumo, ou "dish:<id>" para prato pronto. */
  itemId: string;
  itemName: string;
  sector: string | null;
  reason: string;
  totalCost: number | null;
  cancelled: boolean;
};

export type GrupoDoResumo = { chave: string; nome: string; lancamentos: number; valor: number; semCusto: number };

export type ResumoDeDesperdicio = {
  total: { lancamentos: number; valor: number; semCusto: number };
  porMotivo: GrupoDoResumo[];
  porSetor: GrupoDoResumo[];
  porProduto: GrupoDoResumo[];
};

const emReais = (valor: number) => Math.round(valor * 100) / 100;

/** Setor de quem não tem estoque: prato pronto não está numa câmara, e "Sem setor" o esconderia. */
export const SETOR_PRATO_PRONTO = "Prato pronto";
export const chaveDoPrato = (dishId: string) => `dish:${dishId}`;

function agrupar(linhas: LinhaDeDesperdicio[], chave: (l: LinhaDeDesperdicio) => string, nome: (l: LinhaDeDesperdicio) => string): GrupoDoResumo[] {
  const grupos = new Map<string, GrupoDoResumo>();
  for (const linha of linhas) {
    const k = chave(linha);
    const atual = grupos.get(k) ?? { chave: k, nome: nome(linha), lancamentos: 0, valor: 0, semCusto: 0 };
    grupos.set(k, {
      ...atual,
      lancamentos: atual.lancamentos + 1,
      valor: emReais(atual.valor + (linha.totalCost ?? 0)),
      semCusto: atual.semCusto + (linha.totalCost == null ? 1 : 0),
    });
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor || b.lancamentos - a.lancamentos || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function resumirDesperdicio(todas: LinhaDeDesperdicio[]): ResumoDeDesperdicio {
  const linhas = todas.filter((l) => !l.cancelled);
  return {
    total: {
      lancamentos: linhas.length,
      valor: emReais(linhas.reduce((soma, l) => soma + (l.totalCost ?? 0), 0)),
      semCusto: linhas.filter((l) => l.totalCost == null).length,
    },
    porMotivo: agrupar(linhas, (l) => l.reason, (l) => rotuloDoMotivo(l.reason)),
    porSetor: agrupar(linhas, (l) => l.sector ?? "Sem setor", (l) => l.sector ?? "Sem setor"),
    porProduto: agrupar(linhas, (l) => l.itemId, (l) => l.itemName),
  };
}
