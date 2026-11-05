import { describe, expect, test } from "vitest";
import { calcularDecimoTerceiroSR, fimSemRegistro } from "../decimo-terceiro-sr.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("13º de sem registro", () => {
  test("ano inteiro: 12 avos, 50% + restante", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2024-05-10"), desligamento: null })!;
    expect(r).toMatchObject({ avos: 12, total: 2400, parcela1: 1200, parcela2: 1200, vencimento1: "2026-11-30", vencimento2: "2026-12-20" });
  });
  test("começou sem registro no meio do ano: conta desde o início real (10/03 → 10 avos)", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-03-10"), desligamento: null })!;
    expect(r.avos).toBe(10);
    expect(r.total).toBe(1000);
  });
  test("mês com menos de 15 dias não conta (início 20/12 → 0 avos → null)", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-12-20"), desligamento: null })).toBeNull();
  });
  test("parcelas somam o total com centavos", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000.01, inicio: d("2026-01-01"), desligamento: null })!;
    expect(r.parcela1 + r.parcela2).toBeCloseTo(r.total, 2);
  });
  test("sem salário, sem início ou saída em ano anterior: null", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: null, inicio: d("2026-01-01"), desligamento: null })).toBeNull();
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000, inicio: null, desligamento: null })).toBeNull();
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000, inicio: d("2025-01-01"), desligamento: d("2025-06-30") })).toBeNull();
  });
  test("saiu no ano: proporcional até a saída", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2025-01-01"), desligamento: d("2026-06-30") })!;
    expect(r.avos).toBe(6);
  });
  test("média de variáveis entra na base: soma ÷ avos", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2024-05-10"), desligamento: null, variaveisSoma: 6000 })!;
    expect(r).toMatchObject({ mediaVariaveis: 500, base: 2900, total: 2900 });
  });
  test("variável negativa é ignorada", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2024-05-10"), desligamento: null, variaveisSoma: -10 })!;
    expect(r.mediaVariaveis).toBe(0);
  });
  describe("período pré-registro (limite `ate`)", () => {
    test("conta só até o fim do mês anterior à carteira: início 10/03, ate 31/05 → 3 avos", () => {
      const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-03-10"), desligamento: null, ate: d("2026-05-31") })!;
      expect(r.avos).toBe(3);
      expect(r.total).toBe(300);
    });
    test("início antes do ano e ate em junho: janeiro a junho = 6 avos", () => {
      const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2025-02-01"), desligamento: null, ate: d("2026-06-30") })!;
      expect(r.avos).toBe(6);
    });
    test("ate em ano anterior: sem 13º neste ano", () => {
      expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2025-02-01"), desligamento: null, ate: d("2025-12-31") })).toBeNull();
    });
    test("ate antes do início: sem avos", () => {
      expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-05-20"), desligamento: null, ate: d("2026-04-30") })).toBeNull();
    });
    test("média de variáveis do período entra só sobre os avos do período", () => {
      const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-01-01"), desligamento: null, ate: d("2026-03-31"), variaveisSoma: 600 })!;
      expect(r).toMatchObject({ avos: 3, mediaVariaveis: 200, base: 1400, total: 350 });
    });
  });
  describe("fimSemRegistro — o mês da carteira é da contabilidade", () => {
    test("carteira em 15/06 → período sem registro termina em 31/05", () => {
      expect(fimSemRegistro(d("2026-03-10"), d("2026-06-15"))?.toISOString().slice(0, 10)).toBe("2026-05-31");
    });
    test("carteira no dia 1º também deixa o mês da carteira para a contabilidade", () => {
      expect(fimSemRegistro(d("2026-01-05"), d("2026-07-01"))?.toISOString().slice(0, 10)).toBe("2026-06-30");
    });
    test("carteira em janeiro → termina em 31/12 do ano anterior (nada neste ano)", () => {
      expect(fimSemRegistro(d("2025-11-01"), d("2026-01-10"))?.toISOString().slice(0, 10)).toBe("2025-12-31");
    });
    test("sem carteira, sem admissão ou carteira não posterior: null", () => {
      expect(fimSemRegistro(d("2026-03-10"), null)).toBeNull();
      expect(fimSemRegistro(null, d("2026-03-10"))).toBeNull();
      expect(fimSemRegistro(d("2026-03-10"), d("2026-03-10"))).toBeNull();
      expect(fimSemRegistro(d("2026-03-10"), d("2026-02-01"))).toBeNull();
    });
  });
});
