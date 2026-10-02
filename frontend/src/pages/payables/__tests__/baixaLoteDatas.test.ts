import { describe, expect, test } from "vitest";
import type { Payable } from "../../../api/client";
import { avisoDataDoLote, contarVencidosHaMaisDe, dataDaBaixaNoLote, resumoDatasDoLote } from "../regras";

// Dados fictícios. Hoje = 02/10/2026.
const HOJE = "2026-10-02";
const t = (id: string, dueDate: string | null): Payable => ({ id, dueDate, status: dueDate && dueDate.slice(0, 10) < HOJE ? "OVERDUE" : "OPEN" }) as unknown as Payable;

describe("baixa em lote — data de cada título", () => {
  test("sem a opção: todos na data única", () => {
    expect(dataDaBaixaNoLote(t("a", "2026-08-20T00:00:00.000Z"), false, HOJE, HOJE)).toBe(HOJE);
  });
  test("com a opção: vencido na data do vencimento; a vencer e sem vencimento na data única", () => {
    expect(dataDaBaixaNoLote(t("a", "2026-08-20T00:00:00.000Z"), true, HOJE, HOJE)).toBe("2026-08-20");
    expect(dataDaBaixaNoLote(t("b", "2026-10-15T00:00:00.000Z"), true, HOJE, HOJE)).toBe(HOJE);
    expect(dataDaBaixaNoLote(t("c", HOJE), true, "2026-10-01", HOJE)).toBe("2026-10-01");
    expect(dataDaBaixaNoLote(t("d", null), true, HOJE, HOJE)).toBe(HOJE);
  });
});

describe("baixa em lote — aviso de data de hoje com vencidos antigos", () => {
  const lote = [t("a", "2026-08-20"), t("b", "2026-09-20"), t("c", "2026-09-25"), t("d", "2026-09-28"), t("e", "2026-10-10"), t("f", null)];
  test("conta só os vencidos há mais de 7 dias", () => {
    // 20/08 e 20/09 (12 dias); 25/09 = 7 dias exatos não conta; 28/09 = 4 dias.
    expect(contarVencidosHaMaisDe(lote, HOJE)).toBe(2);
  });
  test("data de hoje + vencidos antigos: avisa com a quantidade", () => {
    expect(avisoDataDoLote(lote, HOJE, false, HOJE)).toBe("2 títulos venceram há mais de uma semana — confira a data real do pagamento.");
    expect(avisoDataDoLote([t("a", "2026-08-20")], HOJE, false, HOJE)).toBe("1 título venceu há mais de uma semana — confira a data real do pagamento.");
  });
  test("outra data, opção de vencimento ligada ou nenhum vencido antigo: sem aviso", () => {
    expect(avisoDataDoLote(lote, "2026-09-30", false, HOJE)).toBeNull();
    expect(avisoDataDoLote(lote, HOJE, true, HOJE)).toBeNull();
    expect(avisoDataDoLote([t("d", "2026-09-28"), t("e", "2026-10-10")], HOJE, false, HOJE)).toBeNull();
  });
});

describe("baixa em lote — resumo das datas", () => {
  test("separa vencidos dos a vencer e dá o intervalo dos vencimentos", () => {
    const lote = [t("a", "2026-09-20T00:00:00.000Z"), t("b", "2026-08-20T00:00:00.000Z"), t("c", "2026-10-15T00:00:00.000Z"), t("d", null)];
    expect(resumoDatasDoLote(lote, HOJE)).toEqual({ vencidos: 2, aVencer: 2, primeiro: "2026-08-20", ultimo: "2026-10-15" });
  });
  test("lote vazio não quebra", () => {
    expect(resumoDatasDoLote([], HOJE)).toEqual({ vencidos: 0, aVencer: 0, primeiro: "", ultimo: "" });
  });
});
