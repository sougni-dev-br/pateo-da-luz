export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) => (typeof currentValue === "bigint" ? Number(currentValue) : currentValue))
  ) as T;
}
