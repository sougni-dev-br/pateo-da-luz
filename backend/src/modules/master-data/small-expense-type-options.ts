import { normalizeText } from "../../shared/utils/normalize-text.js";

export const OFFICIAL_SMALL_EXPENSE_TYPES = [
  "BEBIDAS",
  "Aquisição de equipamentos",
  "Assinaturas e Licenças",
  "CAFÉ FUNCIONÁRIOS",
  "CONFRATERNIZAÇÕES",
  "DECORAÇÃO",
  "EQUIPAMENTOS DE TECNOLOGIA",
  "ESTACIONAMENTO",
  "FARMACINHA",
  "GASTOS COM CORREIOS",
  "IMPRESSOS",
  "LOCAÇÃO DE UTENSÍLIOS",
  "MANUTENÇÃO",
  "MATERIAL DE ESCRITÓRIO",
  "MOBILIARIO",
  "Serviços de TI / Hospedagem de Site",
  "UBER",
  "UNIFORME",
  "UTENSÍLIOS",
  "Veiculação Instagram - Facebook - META",
  "VT-extras e testes"
] as const;

export const OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES = OFFICIAL_SMALL_EXPENSE_TYPES.map((name) => normalizeText(name));

export function isOfficialSmallExpenseType(name: unknown) {
  return OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES.includes(normalizeText(name));
}
