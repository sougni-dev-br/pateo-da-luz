import { normalizeText } from "./normalize-text.js";

const installmentPattern = /^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/i;

function standardBaseName(normalizedBase: string, fallback?: string | null) {
  if (!normalizedBase) return fallback ? String(fallback).trim().toUpperCase() : null;
  if (normalizedBase.includes("boleto")) return "BOLETO";
  if (normalizedBase.includes("faturado") || normalizedBase.includes("prazo")) return "FATURADO";
  if (normalizedBase.includes("cartao") && normalizedBase.includes("credito")) return "CARTAO CREDITO";
  if (normalizedBase.includes("cartao") && normalizedBase.includes("debito")) return "CARTAO DEBITO";
  if (normalizedBase.includes("pix")) return "PIX";
  if (normalizedBase.includes("dinheiro") || normalizedBase.includes("caixa")) return "DINHEIRO";
  if (normalizedBase.includes("transfer")) return "TRANSFERENCIA";
  return fallback ? String(fallback).trim().toUpperCase() : normalizedBase.toUpperCase();
}

export function parseInstallmentCountFromPaymentMethodName(paymentMethod: string | null | undefined) {
  const raw = String(paymentMethod ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeText(raw);
  const match = normalized.match(installmentPattern);
  if (!match) return null;
  const count = Number(match[2]);
  return count > 0 && count <= 60 ? count : null;
}

export function getPaymentMethodBaseName(paymentMethod: string | null | undefined) {
  const raw = String(paymentMethod ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeText(raw);
  const match = normalized.match(installmentPattern);
  const normalizedBase = match ? normalizeText(match[1]) : normalized;
  return standardBaseName(normalizedBase, match ? raw.replace(/\s*\d+\s*x\s*$/i, "").trim() : raw);
}

export function isLegacyInstallmentPaymentMethodName(paymentMethod: string | null | undefined) {
  const raw = String(paymentMethod ?? "").trim();
  if (!raw) return false;
  return installmentPattern.test(normalizeText(raw));
}

export function paymentMethodAllowsInstallments(input: {
  name?: string | null | undefined;
  type?: string | null | undefined;
  group?: string | null | undefined;
}) {
  const baseName = getPaymentMethodBaseName(input.name);
  const normalizedBase = normalizeText(baseName);
  const normalizedGroup = normalizeText(input.group);
  const normalizedType = normalizeText(input.type);

  if (["boleto", "faturado", "cartao credito"].includes(normalizedBase)) return true;
  if (normalizedGroup === "faturado") return true;
  if (normalizedType === "credit_card" || normalizedType === "bank_slip") return true;
  return false;
}

export function formatPaymentMethodWithInstallments(
  paymentMethod: string | null | undefined,
  installments: number | null | undefined
) {
  const baseName = getPaymentMethodBaseName(paymentMethod) ?? "-";
  const count = installments ?? parseInstallmentCountFromPaymentMethodName(paymentMethod) ?? 1;
  return `${baseName} / ${Math.max(1, count)}x`;
}
