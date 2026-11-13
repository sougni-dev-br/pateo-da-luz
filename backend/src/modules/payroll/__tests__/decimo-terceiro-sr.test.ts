import { describe, expect, test } from "vitest";
import { calcularDecimoTerceiroSR, fimSemRegistro, segundaParcela, type VariaveisPorMes } from "../decimo-terceiro-sr.js";

// Dados FICTÍCIOS, com a mesma estrutura dos extratos reais do 13º adiantamento da contabilidade
// (11/2026), onde a fórmula foi conferida centavo a centavo. O repositório é público.
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const meses = (obj: Record<number, number>): VariaveisPorMes => new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));

describe("13º de sem registro — média pelos meses apurados", () => {
  test("entrou em outubro: média de outubro ÷ 1 mês; 1ª com 2 avos (out e nov)", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2026-10-01"), desligamento: null, variaveis: meses({ 10: 600 }) })!;
    expect(r).toMatchObject({ avos: 3, avosParcela1: 2, mediaParcela1: 600 });
    // 1ª: (2400 + 600) ÷ 12 × 2 ÷ 2 = 250
    expect(r.parcela1).toBe(250);
  });
  test("a parte da média na 1ª é soma ÷ 12 quando entrou em outubro (extrato real: 593,54 → 49,46)", () => {
    const comMedia = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-10-01"), desligamento: null, variaveis: meses({ 10: 600 }) })!;
    const semMedia = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-10-01"), desligamento: null })!;
    expect(comMedia.parcela1 - semMedia.parcela1).toBeCloseTo(600 / 12, 2);
  });
  test("entrou em agosto: média de ago a out ÷ 3 meses, 4 avos na 1ª (soma ÷ 18, como no extrato real)", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2026-08-01"), desligamento: null, variaveis: meses({ 8: 800, 9: 700, 10: 600 }) })!;
    expect(r).toMatchObject({ avos: 5, avosParcela1: 4, mediaParcela1: 700 });
    // salário: 2400 ÷ 12 × 4 ÷ 2 = 400 ; média: 2100 ÷ 18
    expect(r.parcela1).toBeCloseTo(400 + 2100 / 18, 1);
  });
  test("admissão em 21/05: maio (11 dias) não conta; junho a novembro = 6 avos na 1ª", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2026-05-21"), desligamento: null })!;
    expect(r).toMatchObject({ avos: 7, avosParcela1: 6 });
  });
  test("ano inteiro: 1ª parcela é 50% cheio do salário (12 avos) mais metade da média", () => {
    const todos = meses({ 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500, 9: 500, 10: 500, 11: 500 });
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2024-05-10"), desligamento: null, variaveis: todos })!;
    expect(r).toMatchObject({ avos: 12, avosParcela1: 12, mediaParcela1: 500, mediaFinal: 500 });
    expect(r.parcela1).toBe(1450); // (2400 + 500) ÷ 2
    expect(r.total).toBe(2900);
    expect(r.parcela2).toBe(1450);
  });
  test("sem variáveis: 2ª fecha o total", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-03-10"), desligamento: null })!;
    expect(r.avos).toBe(10);
    expect(r.total).toBe(1000);
    expect(r.parcela1 + r.parcela2).toBeCloseTo(r.total, 2);
  });
  test("a média de novembro entra no 13º completo e a 2ª parcela é o acerto", () => {
    const comNov = meses({ 1: 300, 2: 300, 3: 300, 4: 300, 5: 300, 6: 300, 7: 300, 8: 300, 9: 300, 10: 300, 11: 900 });
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2024-01-01"), desligamento: null, variaveis: comNov })!;
    expect(r.mediaParcela1).toBe(300);
    expect(r.mediaFinal).toBe(354.55); // (3000 + 900) ÷ 11
    expect(r.parcela1).toBe(1350);     // (2400 + 300) ÷ 2
    expect(r.total).toBe(2754.55);     // 2400 + 354,55
    expect(r.parcela2).toBe(1404.55);  // total − 1ª
  });
  test("variável negativa ou inválida não reduz o 13º", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2026-10-01"), desligamento: null, variaveis: meses({ 10: -50, 11: Number.NaN }) })!;
    expect(r.mediaParcela1).toBe(0);
    expect(r.mediaFinal).toBe(0);
  });
  test("mês com menos de 15 dias não conta (início 20/12 → sem 13º)", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-12-20"), desligamento: null })).toBeNull();
  });
  test("sem salário, sem início ou saída em ano anterior: null", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: null, inicio: d("2026-01-01"), desligamento: null })).toBeNull();
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000, inicio: null, desligamento: null })).toBeNull();
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000, inicio: d("2025-01-01"), desligamento: d("2025-06-30") })).toBeNull();
  });
  test("saiu no ano: proporcional até a saída, e a 1ª nunca passa do total", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2025-01-01"), desligamento: d("2026-06-30") })!;
    expect(r.avos).toBe(6);
    expect(r.parcela1).toBeLessThanOrEqual(r.total);
    expect(r.parcela2).toBeGreaterThanOrEqual(0);
  });
  test("saída em 30/11: a 1ª usa no máximo os avos do ano (11), nunca 12", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2024-01-01"), desligamento: d("2026-11-30") })!;
    expect(r).toMatchObject({ avos: 11, avosParcela1: 11 });
    expect(r.parcela2).toBeGreaterThanOrEqual(0);
  });
  test("o total e as parcelas fecham em centavos", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1000.01, inicio: d("2026-01-01"), desligamento: null })!;
    expect(Math.round((r.parcela1 + r.parcela2) * 100)).toBe(Math.round(r.total * 100));
  });
});

describe("período pré-registro (limite `ate`)", () => {
  test("conta só até o fim do mês anterior à carteira: início 10/03, ate 31/05 → 3 avos", () => {
    const r = calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-03-10"), desligamento: null, ate: d("2026-05-31") })!;
    expect(r.avos).toBe(3);
    expect(r.total).toBe(300);
  });
  test("início antes do ano e ate em junho: janeiro a junho = 6 avos", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 2400, inicio: d("2025-02-01"), desligamento: null, ate: d("2026-06-30") })!.avos).toBe(6);
  });
  test("ate em ano anterior ou antes do início: sem 13º neste ano", () => {
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2025-02-01"), desligamento: null, ate: d("2025-12-31") })).toBeNull();
    expect(calcularDecimoTerceiroSR({ ano: 2026, salarioBase: 1200, inicio: d("2026-05-20"), desligamento: null, ate: d("2026-04-30") })).toBeNull();
  });
  test("variáveis depois do limite não entram na média do período sem registro", () => {
    const r = calcularDecimoTerceiroSR({
      ano: 2026, salarioBase: 1200, inicio: d("2026-01-01"), desligamento: null, ate: d("2026-03-31"), variaveis: meses({ 1: 300, 2: 300, 3: 300, 6: 9999 }),
    })!;
    expect(r.avos).toBe(3);
    expect(r.mediaFinal).toBe(300);
    expect(r.total).toBe(375); // (1200 + 300) ÷ 12 × 3
  });
});

describe("segundaParcela — nem a mais, nem a menos", () => {
  test("o resto do 13º depois do que a 1ª pagou", () => {
    expect(segundaParcela(2754.55, 1350)).toEqual({ valor: 1404.55, excesso: 0 });
  });
  test("a 1ª paga a mais do que o devido: a 2ª zera e a diferença vira excesso", () => {
    expect(segundaParcela(1000, 1100.5)).toEqual({ valor: 0, excesso: 100.5 });
  });
  test("a 1ª paga a menos (a média subiu): a 2ª cobre a diferença", () => {
    expect(segundaParcela(2000, 900)).toEqual({ valor: 1100, excesso: 0 });
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
