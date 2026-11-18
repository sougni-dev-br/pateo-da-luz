import path from "node:path";

export type TaxStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT";

const DIA_ISO = /^\d{4}-\d{2}-\d{2}/;

// As datas das guias ficam gravadas à meia-noite UTC e o servidor roda em UTC: comparar pelo dia
// (AAAA-MM-DD) evita deslocar por fuso. O "hoje" é o de Brasília (hojeBrasilia), senão a partir
// das 21h a guia que vence hoje já contaria como vencida.
export function diaIso(valor: Date | string | null | undefined): string | null {
  if (valor == null || valor === "") return null;
  const texto = valor instanceof Date ? (Number.isNaN(valor.getTime()) ? "" : valor.toISOString()) : String(valor);
  return DIA_ISO.test(texto) ? texto.slice(0, 10) : null;
}

export function hojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

// Pago, cancelado e em aberto são os únicos estados gravados; "vencido" é derivado do
// vencimento e envelhece sozinho (o OVERDUE gravado só reflete o dia em que a guia foi salva).
export function statusDaGuia(
  paymentDate: Date | null,
  dueDate: Date,
  cancelada = false,
  hoje: Date = new Date()
): TaxStatus {
  if (cancelada) return "CANCELED";
  if (paymentDate) return "PAID";
  const vencimento = diaIso(dueDate);
  return vencimento && vencimento < hojeBrasilia(hoje) ? "OVERDUE" : "PENDING";
}

export const MAXIMO_DE_VALOR_DA_GUIA = 9_999_999_999.99; // Decimal(12,2)

// Só número ou texto no formato canônico ("1234.56"): "1.234" (milhar), "1e3", "0x1F", true ou [7] seriam aceitos por
// Number() e sairiam com outro valor em silêncio.
const VALOR_CANONICO = /^\d+(\.\d{1,2})?$/;

// Valor de guia ou de pagamento: maior que zero, até o limite do banco, arredondado em centavos.
export function parseValorGuia(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  let n: number;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && VALOR_CANONICO.test(valor.trim())) n = Number(valor.trim());
  else return null;
  if (!Number.isFinite(n) || n <= 0 || n > MAXIMO_DE_VALOR_DA_GUIA) return null;
  const centavos = Math.round(n * 100) / 100;
  return centavos > 0 ? centavos : null;
}

// Status de uma guia que volta a ficar em aberto (estorno, restauração): vencida só depois do dia do vencimento, em Brasília.
export function statusDeGuiaEmAberto(dueDate: Date | null, hoje: Date = new Date()): "PENDING" | "OVERDUE" {
  return dueDate ? (statusDaGuia(null, dueDate, false, hoje) as "PENDING" | "OVERDUE") : "PENDING";
}

export type DataLida = { ok: true; data: Date | null } | { ok: false };

// Ausente/vazio vira null; texto que não é data devolve ok:false (antes virava 500 do Prisma).
export function lerData(valor: unknown): DataLida {
  if (valor == null || valor === "") return { ok: true, data: null };
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? { ok: false } : { ok: true, data };
}

// A importação devolve ao navegador só o nome que o multer deu ao arquivo (hex); o caminho
// é montado aqui. Antes o navegador mandava um caminho qualquer e o servidor o lia e apagava.
const NOME_UPLOAD = /^[a-f0-9]{32}$/;

export function resolverUploadImportacao(importFileId: unknown, pastaUploads: string): string | null {
  if (typeof importFileId !== "string" || !NOME_UPLOAD.test(importFileId)) return null;
  const pasta = path.resolve(pastaUploads);
  const caminho = path.resolve(pasta, importFileId);
  return path.dirname(caminho) === pasta ? caminho : null;
}
