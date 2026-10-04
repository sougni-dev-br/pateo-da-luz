import { describe, expect, it } from "vitest";
import type { DashboardAlert } from "../../api/client";
import {
  buildDelta,
  classifyAlerts,
  compareRevenue,
  cumulative,
  isValidCompetence,
  monthInfo,
  shiftCompetence,
  withRemainder,
  type RevenueDay,
} from "./logic";

const day = (d: number, gross: number): RevenueDay => ({
  day: d,
  grossAmount: gross,
  netAmount: gross * 0.9,
  serviceAmount: gross * 0.1,
});

describe("competência", () => {
  it("desloca atravessando a virada do ano", () => {
    expect(shiftCompetence("2026-01", -1)).toBe("2025-12");
    expect(shiftCompetence("2026-12", 1)).toBe("2027-01");
  });

  it("valida o formato vindo da URL", () => {
    expect(isValidCompetence("2026-10")).toBe(true);
    expect(isValidCompetence("2026-13")).toBe(false);
    expect(isValidCompetence("x")).toBe(false);
    expect(isValidCompetence(null)).toBe(false);
    expect(isValidCompetence("0002-10")).toBe(false);
  });

  it("descreve o mês em andamento pelo dia de hoje", () => {
    const info = monthInfo("2026-10", new Date(2026, 9, 4));
    expect(info).toMatchObject({ isCurrent: true, isFuture: false, daysInMonth: 31, elapsedDays: 4, shortLabel: "out/2026" });
  });

  it("mês passado conta todos os dias", () => {
    expect(monthInfo("2026-02", new Date(2026, 9, 4))).toMatchObject({ isCurrent: false, elapsedDays: 28 });
  });
});

describe("buildDelta", () => {
  it("seta segue o sinal e a cor segue o julgamento", () => {
    expect(buildDelta(-66.6, true, "set")).toMatchObject({ direction: "down", tone: "warning" });
    expect(buildDelta(12, false, "set")).toMatchObject({ direction: "up", tone: "warning" });
    expect(buildDelta(-12, false, "set")).toMatchObject({ direction: "down", tone: "success" });
  });

  it("variação que arredonda para zero é neutra", () => {
    expect(buildDelta(0.02, true, "set")).toMatchObject({ direction: "flat", tone: "neutral" });
  });

  it("sem base devolve null", () => {
    expect(buildDelta(null, true, "set")).toBeNull();
  });
});

describe("compareRevenue", () => {
  const previous = [day(1, 100), day(2, 100), day(3, 100), day(4, 100), day(30, 1000)];

  it("mês em andamento compara o mesmo trecho do mês anterior", () => {
    const current = [day(1, 110), day(2, 110), day(3, 110)];
    const result = compareRevenue(current, previous, "grossAmount", true);
    expect(result.throughDay).toBe(3);
    expect(result.previous).toBe(300);
    expect(result.pct).toBeCloseTo(10);
  });

  it("mês fechado compara o mês inteiro", () => {
    const current = [day(1, 1400)];
    const result = compareRevenue(current, previous, "grossAmount", false);
    expect(result.throughDay).toBeNull();
    expect(result.previous).toBe(1400);
    expect(result.pct).toBe(0);
  });

  it("mês em andamento sem lançamento não compara", () => {
    expect(compareRevenue([], previous, "grossAmount", true).pct).toBeNull();
  });
});

describe("cumulative", () => {
  it("preenche dias sem lançamento com o acumulado anterior", () => {
    expect(cumulative([day(1, 10), day(3, 5)], "grossAmount", 4).map((p) => p.value)).toEqual([10, 10, 15, 15]);
  });
});

describe("classifyAlerts", () => {
  const alert = (code: string, type: DashboardAlert["type"] = "warning"): DashboardAlert => ({
    code, type, title: code, description: "",
  });
  const ctx = { isInProgress: true, hasRevenue: true, hasAnyData: true };

  it("inventário final no mês em andamento é espera, não pendência", () => {
    const [a] = classifyAlerts([alert("CMV_NO_INVENTORY", "info")], ctx);
    expect(a.bucket).toBe("waiting");
  });

  it("inventário final de mês encerrado vira atenção", () => {
    const [a] = classifyAlerts([alert("CMV_NO_INVENTORY", "info")], { ...ctx, isInProgress: false });
    expect(a.bucket).toBe("attention");
  });

  it("contas vencidas vêm primeiro", () => {
    const result = classifyAlerts(
      [alert("CMV_PENDING_CLOSE", "info"), alert("MISSING_REVENUE_DAYS"), alert("OVERDUE_PAYABLES", "danger")],
      ctx,
    );
    expect(result.map((a) => a.code)).toEqual(["OVERDUE_PAYABLES", "MISSING_REVENUE_DAYS", "CMV_PENDING_CLOSE"]);
  });

  it("dias sem faturamento some quando nada foi lançado (o alerta local já cobre)", () => {
    expect(classifyAlerts([alert("MISSING_REVENUE_DAYS")], { ...ctx, hasRevenue: false })).toEqual([]);
  });
});

describe("withRemainder", () => {
  it("acrescenta o que ficou fora do top", () => {
    const rows = withRemainder([{ name: "A", total: 60 }, { name: "B", total: 30 }], 100);
    expect(rows[rows.length - 1]).toEqual({ name: "Demais", total: 10, isRemainder: true });
  });

  it("não acrescenta quando a lista já é o total", () => {
    expect(withRemainder([{ name: "A", total: 100 }], 100)).toHaveLength(1);
  });
});
