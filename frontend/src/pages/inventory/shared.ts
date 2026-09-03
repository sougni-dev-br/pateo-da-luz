// Helpers e constantes puros do modulo de Estoque, extraidos do
// Inventory.tsx (passo 0 da Onda 5.B). Sem estado, sem JSX — apenas
// mapas de rotulos, tons de status e utilitarios de ordenacao/agregacao
// compartilhados pelas views (overview, contagens, inventario, relatorios).

import type { OperationalInventoryType } from "../../api/client";

export const weekdays = [
  { value: "", label: "Sem dia fixo" },
  { value: "1", label: "Segunda" },
  { value: "2", label: "Terca" },
  { value: "3", label: "Quarta" },
  { value: "4", label: "Quinta" },
  { value: "5", label: "Sexta" },
  { value: "6", label: "Sabado" },
  { value: "0", label: "Domingo" }
];

export const statusLabels: Record<string, string> = {
  PENDING: "pendente",
  IN_PROGRESS: "em andamento",
  DRAFT: "rascunho",
  SUBMITTED: "enviado para revisao",
  CONFIRMED: "confirmado",
  LATE: "atrasado",
  CANCELLED: "cancelada"
};

export const operationalStatusLabels: Record<string, string> = {
  RASCUNHO: "rascunho",
  EM_REVISAO: "em revisao",
  APROVADO: "aprovado",
  REJEITADO: "rejeitado",
  FECHADO: "fechado",
  CANCELADO: "cancelado"
};

export const itemStatusLabels: Record<string, string> = {
  PENDENTE: "Pendente",
  ZERO: "Zerado",
  CONTADO: "Contado",
  DIVERGENTE: "Divergente",
  IGNORADO: "Ignorado"
};

export const operationalTypeLabels: Record<OperationalInventoryType, string> = {
  GERAL: "Geral",
  SETORIAL: "Setorial",
  FINAL_CMV: "Final CMV",
  CONFERENCIA: "Conferencia"
};

export const editableOperationalInventoryStatuses = new Set(["RASCUNHO", "REJEITADO"]);

export const countSessionStatusLabels: Record<string, string> = {
  ABERTA: "aberta",
  EM_ANDAMENTO: "em andamento",
  CONCLUIDA: "concluida",
  CANCELADA: "cancelada"
};

export const countSessionTypeLabels: Record<string, string> = {
  GERAL: "Geral",
  SETORIAL: "Setorial",
  CATEGORIA: "Categoria",
  SUBCATEGORIA: "Subcategoria",
  FINAL_MES: "Final do mes",
  ALEATORIA: "Aleatoria",
  TAREFA: "Tarefa",
  IMPORTACAO_PLANILHA: "Importacao",
  COMPLEMENTAR_CMV: "Complementar CMV"
};

export const editableCountSessionStatuses = new Set(["ABERTA", "EM_ANDAMENTO"]);

export const countSessionColumnOptions = [
  { key: "sector", label: "Setor", required: false },
  { key: "category", label: "Categoria", required: false },
  { key: "subcategory", label: "Subcategoria", required: false },
  { key: "unit", label: "Unidade", required: false },
  { key: "code", label: "Codigo", required: false },
  { key: "product", label: "Produto", required: true },
  { key: "quantity", label: "Quantidade", required: true },
  { key: "notes", label: "Observacao", required: false },
  { key: "status", label: "Status", required: true }
] as const;

export type CountSessionColumn = typeof countSessionColumnOptions[number]["key"];

export const defaultCountSessionColumns: Record<CountSessionColumn, boolean> = {
  sector: false,
  category: false,
  subcategory: false,
  unit: true,
  code: true,
  product: true,
  quantity: true,
  notes: true,
  status: true
};

export function displayLabel(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const text = String(value).trim();
  if (!text || text === "[object Object]" || text === "undefined" || text === "null") return fallback;
  return text;
}

export function loadCountSessionColumnPreferences() {
  try {
    const stored = window.localStorage.getItem("stockCountLaunchColumns");
    if (!stored) return defaultCountSessionColumns;
    const parsed = JSON.parse(stored) as Partial<Record<CountSessionColumn, boolean>>;
    return {
      ...defaultCountSessionColumns,
      ...parsed,
      product: true,
      quantity: true
    };
  } catch {
    return defaultCountSessionColumns;
  }
}

export const movementTypes = [
  { value: "MANUAL_OUT", label: "Saida manual" },
  { value: "BREAKAGE", label: "Quebra" },
  { value: "LOSS", label: "Perda" },
  { value: "INTERNAL_CONSUMPTION", label: "Consumo interno" },
  { value: "EMPLOYEE_PURCHASE", label: "Compra por funcionario" },
  { value: "POSITIVE_ADJUSTMENT", label: "Ajuste positivo" },
  { value: "NEGATIVE_ADJUSTMENT", label: "Ajuste negativo" },
  { value: "RETURN", label: "Devolucao" },
  { value: "TRANSFER", label: "Transferencia futura" },
  { value: "PURCHASE_IN", label: "Entrada manual" }
];

export const sensitiveMovementTypes = ["BREAKAGE", "LOSS", "EMPLOYEE_PURCHASE", "NEGATIVE_ADJUSTMENT"];

export function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year: String(year), month: String(month) };
}

export function dateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function stockCountSortText(value: string | null | undefined, fallback = "") {
  return String(value ?? fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function inventoryClassificationSortText(value: string | null | undefined, fallback = "") {
  return String(value ?? fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function sameDay(a: string, b: Date) {
  return dateKey(a) === b.toISOString().slice(0, 10);
}

export function operationalTone(status: string) {
  if (["APROVADO", "FECHADO"].includes(status)) return "success" as const;
  if (status === "EM_REVISAO") return "info" as const;
  if (["REJEITADO", "CANCELADO"].includes(status)) return "danger" as const;
  return "warning" as const;
}

export function itemTone(status: string) {
  if (status === "CONTADO") return "success" as const;
  if (status === "DIVERGENTE") return "danger" as const;
  if (status === "ZERO") return "info" as const;
  return "warning" as const;
}

// O teclado decimal do celular em pt-BR entrega virgula. Os campos de contagem
// sao <input> de texto (inputMode="decimal"), entao a virgula chega crua ate a
// API — e Number("16,5") e NaN. Normalizamos aqui, na borda de saida.

// Remove o que nao e numero, preservando os separadores como digitados. Nao
// colapsa "1.234,5" — normalizar cedo demais trocaria um erro silencioso por
// outro; quem decide a leitura e o quantityToApi abaixo.
export function sanitizeQuantityInput(value: string) {
  const sign = value.trimStart().startsWith("-") ? "-" : "";
  return sign + value.replace(/[^\d.,]/g, "");
}

const THOUSAND_GROUPED = /^\d{1,3}(\.\d{3})+$/;

// Converte o texto do campo no formato que a API entende, com a MESMA regra do
// backend (shared/utils/parse-decimal.ts): havendo virgula, ela e o separador
// decimal e os pontos sao de milhar; "1.234" sem virgula continua sendo mil
// duzentos e trinta e quatro. Retorna undefined quando o texto nao e numerico —
// o chamador bloqueia o envio em vez de deixar virar zero no backend.
export function quantityToApi(value: string): string | undefined {
  const text = value.trim();
  if (!text) return "";
  const sign = text.startsWith("-") ? "-" : "";
  const digits = text.replace(/^[+-]/, "");
  if (!/^[\d.,]+$/.test(digits)) return undefined;

  let normalized: string;
  if (digits.includes(",")) {
    normalized = digits.replace(/\./g, "").replace(",", ".");
  } else if (digits.includes(".") && THOUSAND_GROUPED.test(digits)) {
    normalized = digits.replace(/\./g, "");
  } else {
    normalized = digits;
  }

  return Number.isFinite(Number(normalized)) ? sign + normalized : undefined;
}

export const DIFF_EPSILON = 0.0001;

export function formatDiff(diff: number | null): string {
  if (diff == null || Math.abs(diff) < DIFF_EPSILON) return "—";
  const formatted = Math.abs(diff) % 1 === 0 ? String(diff) : diff.toFixed(3).replace(/\.?0+$/, "");
  return (diff > 0 ? "+" : "") + formatted;
}

export function countSessionTone(status: string) {
  if (status === "CONCLUIDA") return "success" as const;
  if (status === "EM_ANDAMENTO") return "info" as const;
  if (status === "CANCELADA") return "danger" as const;
  return "warning" as const;
}

export function buyerAlertTone(alert: string) {
  if (["ZERADO", "DIVERGENTE", "SEM_FORNECEDOR"].includes(alert)) return "danger" as const;
  if (["ABAIXO DO MINIMO", "CADASTRO INCOMPLETO", "SEM CONTAGEM", "SEM_ESTOQUE_MINIMO", "SEM_ESTOQUE_IDEAL"].includes(alert)) return "warning" as const;
  return "info" as const;
}

export function buyerAlertLabel(alert: string) {
  return alert.replace(/_/g, " ").toLowerCase();
}

export function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item) || "Sem classificacao";
    totals.set(key, (totals.get(key) ?? 0) + 1);
  });
  return [...totals.entries()].map(([label, value]) => ({ label, value }));
}

export function sumBy<T>(items: T[], getKey: (item: T) => string | null | undefined, getValue: (item: T) => number) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item) || "Sem classificacao";
    totals.set(key, (totals.get(key) ?? 0) + getValue(item));
  });
  return [...totals.entries()].map(([label, value]) => ({ label, value: Math.round(value) }));
}

export function settledValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}
