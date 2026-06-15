export function createCalendarDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function toCalendarDateKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeToCalendarDate(value: Date) {
  return createCalendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}
