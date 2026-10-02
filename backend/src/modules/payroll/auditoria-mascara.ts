// Auditoria do cadastro de funcionários sem documentos por extenso: CPF, PIS, RG, CTPS,
// título de eleitor, dados bancários e PIX vão mascarados (só os 2 últimos caracteres).
// Vale daqui para frente; os registros antigos não são alterados aqui.

const CAMPOS_SENSIVEIS = new Set([
  "cpf", "pis", "rg", "ctpsNumero", "tituloEleitor", "bankAgency", "bankAccount", "bankAccountDigit", "pixKey",
]);
const OCULTO = "•••••";

export function mascararValor(campo: string, valor: unknown): unknown {
  if (valor == null || valor === "") return valor;
  const limpo = String(valor).replace(/[^0-9A-Za-z]/g, "");
  if (limpo.length <= 2) return "•";
  const fim = limpo.slice(-2);
  if (campo === "cpf" && limpo.length === 11) return `•••.•••.•••-${fim}`;
  return `${OCULTO}${fim}`;
}

// Cópia rasa do objeto com os campos sensíveis mascarados; não muta o original.
export function mascararDadosSensiveis<T>(v: T): T {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Date) return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, CAMPOS_SENSIVEIS.has(k) ? mascararValor(k, x) : x]),
  ) as T;
}
