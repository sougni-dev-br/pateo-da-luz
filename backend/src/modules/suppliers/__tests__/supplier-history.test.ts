import { describe, expect, test } from "vitest";
import { parseSupplierHistoryQuery, restaurantToday } from "../supplier-history.js";

describe("parseSupplierHistoryQuery", () => {
  test("sem filtros: todo o histórico, primeira página de 15", () => {
    const parsed = parseSupplierHistoryQuery({});
    expect(parsed).toEqual({
      from: null,
      toExclusive: null,
      page: 1,
      pageSize: 15,
      search: null,
      includeCancelled: false,
      titleFilter: null,
      all: false
    });
  });

  test("all só liga com 'true' (exportação traz tudo, sem paginar)", () => {
    expect(parseSupplierHistoryQuery({ all: "true" }).all).toBe(true);
    expect(parseSupplierHistoryQuery({ all: "1" }).all).toBe(false);
  });

  test("filtro de situação do título só aceita os valores conhecidos", () => {
    expect(parseSupplierHistoryQuery({ titleState: "overdue" }).titleFilter).toBe("overdue");
    expect(parseSupplierHistoryQuery({ titleState: "paid" }).titleFilter).toBe("paid");
    expect(parseSupplierHistoryQuery({ titleState: "DROP TABLE" }).titleFilter).toBeNull();
  });

  test("hoje é o dia do restaurante (São Paulo), não o dia UTC", () => {
    // 23h de 24/11 em São Paulo já é 02h de 25/11 em UTC.
    expect(restaurantToday(new Date("2026-11-25T02:00:00.000Z")).toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(restaurantToday(new Date("2026-11-24T15:00:00.000Z")).toISOString()).toBe("2026-11-24T00:00:00.000Z");
  });

  test("o fim do período é inclusivo: vira o dia seguinte, exclusivo", () => {
    const parsed = parseSupplierHistoryQuery({ from: "2026-11-01", to: "2026-11-30" });
    expect(parsed.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parsed.toExclusive?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  test("ignora datas inválidas em vez de quebrar", () => {
    const parsed = parseSupplierHistoryQuery({ from: "ontem", to: "2026-02-31" });
    expect(parsed.from).toBeNull();
    expect(parsed.toExclusive).toBeNull();
  });

  test("inverte um período em que o início vem depois do fim", () => {
    const parsed = parseSupplierHistoryQuery({ from: "2026-11-30", to: "2026-11-01" });
    expect(parsed.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parsed.toExclusive?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  test("limita página e tamanho da página", () => {
    expect(parseSupplierHistoryQuery({ page: "0", pageSize: "9999" })).toMatchObject({ page: 1, pageSize: 50 });
    expect(parseSupplierHistoryQuery({ page: "3", pageSize: "20" })).toMatchObject({ page: 3, pageSize: 20 });
    expect(parseSupplierHistoryQuery({ page: "abc", pageSize: "-5" })).toMatchObject({ page: 1, pageSize: 15 });
  });

  test("busca vazia vira nula e a busca é aparada", () => {
    expect(parseSupplierHistoryQuery({ search: "   " }).search).toBeNull();
    expect(parseSupplierHistoryQuery({ search: " 1208953 " }).search).toBe("1208953");
  });

  test("includeCancelled só liga com 'true'", () => {
    expect(parseSupplierHistoryQuery({ includeCancelled: "true" }).includeCancelled).toBe(true);
    expect(parseSupplierHistoryQuery({ includeCancelled: "1" }).includeCancelled).toBe(false);
  });
});
