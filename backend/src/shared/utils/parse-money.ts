export function parseMoney(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }

  const normalized = raw
    .replace(/\s/g, "")
    .replace(/R\$/i, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
