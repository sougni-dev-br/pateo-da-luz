import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    buffetWeighing: { findMany: vi.fn() },
    buffetPlateItem: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("../buffet-costs.service.js", () => ({ custosDosPratos: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { analiseDoBuffet } from "../buffet-analysis.service.js";
import { custosDosPratos } from "../buffet-costs.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const dia = (d: string) => new Date(`${d}T00:00:00Z`);
const linha = (d: string, itemId: string, phase: string, netG: number) => ({ servedOn: dia(d), itemId, phase, netG });
const ok = (costPerKg: number) => ({ state: "OK", dishId: "d", dishName: "x", costPerKg, reason: null });

beforeEach(() => {
  vi.clearAllMocks();
  db.buffetWeighing.findMany.mockResolvedValue([
    linha("2026-11-18", "a", "PRODUCAO", 10000), linha("2026-11-18", "a", "SOBRA", 2000),
  ]);
  db.buffetPlateItem.findMany.mockResolvedValue([{ id: "a", namePt: "Arroz branco", category: "Arroz e grãos" }]);
  db.$queryRaw.mockResolvedValue([{ dia: "2026-11-18", pessoas: 50, receita: "4500.00" }]);
  vi.mocked(custosDosPratos).mockResolvedValue(new Map([["a", ok(8)]]) as never);
});

describe("análise do buffet (serviço)", () => {
  test("junta pesagens, pessoas e receita do PDV e custo da ficha, com o nome do prato", async () => {
    const r = await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", true);
    expect(r).toMatchObject({ from: "2026-11-01", to: "2026-11-30", kind: "BUFFET", costVisible: true });
    expect(r.days[0]).toMatchObject({ date: "2026-11-18", people: 50, revenue: 4500, producedG: 10000, consumedG: 8000, producedCost: 80, gPerPerson: 160 });
    expect(r.items[0]).toMatchObject({ itemId: "a", name: "Arroz branco", category: "Arroz e grãos", costPerKg: 8, gPerPerson: 160 });
    expect(r.summary).toMatchObject({ people: 50, costPerPerson: 1.6, revenuePerPerson: 90, marginPerPerson: 88.4 });
  });

  test("sem a permissão de custos não sai nenhum valor em R$, só quilos, pessoas e sobra", async () => {
    const r = await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", false);
    expect(r.costVisible).toBe(false);
    expect(r.days[0]).toMatchObject({ people: 50, producedG: 10000, consumedG: 8000, gPerPerson: 160, revenue: null, producedCost: null, costPerPerson: null, marginPerPerson: null });
    expect(r.items[0]).toMatchObject({ gPerPerson: 160, leftoverPct: 0.2, costPerKg: null, consumedCost: null, costPerPerson: null });
    expect(r.summary).toMatchObject({ people: 50, revenue: null, producedCost: null, marginPerPerson: null, leftoverPct: 0.2 });
    expect(JSON.stringify(r)).not.toMatch(/4500|"costPerKg":8|90/);
  });

  test("sem permissão de custos nem consulta as fichas", async () => {
    await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", false);
    expect(custosDosPratos).not.toHaveBeenCalled();
  });

  test("a SQL do PDV só soma receita de comandas com pessoas informadas", async () => {
    await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", true);
    const textoSql = (db.$queryRaw.mock.calls[0][0] as string[]).join(" ");
    expect(textoSql).toMatch(/FILTER \(WHERE s\.people > 0\)/);
  });

  test("os pratos mais produzidos vão primeiro para o cálculo de custo", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha("2026-11-18", "pouco", "PRODUCAO", 1000), linha("2026-11-18", "muito", "PRODUCAO", 9000)]);
    await analiseDoBuffet("2026-11-18", "2026-11-18", "BUFFET", true);
    expect(vi.mocked(custosDosPratos).mock.calls[0][0]).toEqual(["muito", "pouco"]);
  });

  test("traz o cardápio do dia pesado mais recente", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha("2026-11-17", "velho", "PRODUCAO", 1000), linha("2026-11-18", "a", "PRODUCAO", 1000)]);
    const r = await analiseDoBuffet("2026-11-17", "2026-11-18", "BUFFET", true);
    expect(r.lastDayItemIds).toEqual(["a"]);
  });

  test("coffee break e evento não consultam o PDV", async () => {
    const r = await analiseDoBuffet("2026-11-01", "2026-11-30", "COFFEE_BREAK", true);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(r.days[0].people).toBeNull();
    expect(db.buffetWeighing.findMany.mock.calls[0][0].where.kind).toBe("COFFEE_BREAK");
  });

  test("período sem pesagem não consulta o PDV nem as fichas à toa", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([]);
    const r = await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", true);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.buffetPlateItem.findMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ days: [], items: [], summary: { days: 0, people: 0 } });
  });

  test("prato apagado do catálogo aparece com nome genérico em vez de quebrar", async () => {
    db.buffetPlateItem.findMany.mockResolvedValue([]);
    const r = await analiseDoBuffet("2026-11-01", "2026-11-30", "BUFFET", true);
    expect(r.items[0].name).toBe("Prato removido");
  });

  test("ignora linhas de etapa desconhecida tratando como produção só o que é PRODUCAO", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha("2026-11-18", "a", "PRODUCAO", 5000)]);
    const r = await analiseDoBuffet("2026-11-18", "2026-11-18", "BUFFET", true);
    expect(r.days[0].producedG).toBe(5000);
  });
});
