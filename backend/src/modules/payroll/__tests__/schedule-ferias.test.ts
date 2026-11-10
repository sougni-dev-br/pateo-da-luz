import { describe, expect, test } from "vitest";
import { diasDeFeriasNoMes, fimDoGozo } from "../schedule-ferias.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const MES = d("2026-10-01");
const PROXIMO = d("2026-11-01");
const iv = (employeeId: string, inicio: string, fim: string) => ({ employeeId, inicio: d(inicio), fim: d(fim) });
const dias = (r: ReturnType<typeof diasDeFeriasNoMes>) => r.map((x) => x.day);

describe("fimDoGozo", () => {
  test("início + dias − 1, inclusive", () => {
    expect(fimDoGozo(d("2026-12-28"), 30)).toEqual(d("2027-01-26"));
    expect(fimDoGozo(d("2026-10-05"), 1)).toEqual(d("2026-10-05"));
  });
});

describe("diasDeFeriasNoMes", () => {
  test("recorta o intervalo ao mês: começa antes e termina depois", () => {
    expect(dias(diasDeFeriasNoMes([], [iv("a", "2026-09-28", "2026-10-03")], MES, PROXIMO))).toEqual([1, 2, 3]);
    expect(dias(diasDeFeriasNoMes([], [iv("a", "2026-10-29", "2026-11-12")], MES, PROXIMO))).toEqual([29, 30, 31]);
  });
  test("ignora o que não toca o mês", () => {
    expect(diasDeFeriasNoMes([], [iv("a", "2026-09-01", "2026-09-30"), iv("a", "2026-11-01", "2026-11-10")], MES, PROXIMO)).toEqual([]);
  });
  test("mês inteiro dentro das férias", () => {
    expect(diasDeFeriasNoMes([], [iv("a", "2026-09-20", "2026-11-20")], MES, PROXIMO)).toHaveLength(31);
  });
  test("a FOLHA vence a PROGRAMACAO no mesmo dia, e pessoas diferentes não se misturam", () => {
    const r = diasDeFeriasNoMes([iv("a", "2026-10-05", "2026-10-06")], [iv("a", "2026-10-05", "2026-10-07"), iv("b", "2026-10-05", "2026-10-05")], MES, PROXIMO);
    expect(r).toEqual([
      { employeeId: "a", day: 5, origem: "FOLHA" }, { employeeId: "a", day: 6, origem: "FOLHA" },
      { employeeId: "a", day: 7, origem: "PROGRAMACAO" }, { employeeId: "b", day: 5, origem: "PROGRAMACAO" },
    ]);
  });
});
