import { describe, expect, test } from "vitest";
import {
  aplicarVerbasOpcionais, avos13, avosFerias, calcularVerbasOpcionais, diasAviso, lerEscolhaVerbas,
} from "../rescisao-verbas-opcionais.js";

// Verbas opcionais da rescisão de sem registro (decisão do Eli, 01/10/2026): férias
// proporcionais + 1/3, 13º proporcional, aviso prévio indenizado e valor livre. Nada
// entra sem alguém marcar; o servidor recalcula.
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("avosFerias — período aquisitivo em curso", () => {
  test("exemplo do Eli: início 10/03, saída 24/09 → 6 meses + 15 dias = 7 avos", () => {
    const r = avosFerias(d("2026-03-10"), d("2026-09-24"));
    expect(r).toMatchObject({ inicioAquisitivo: "2026-03-10", meses: 6, diasFracao: 15, avos: 7, maisDe12Meses: false });
  });
  test("fração de 14 dias não conta", () => {
    expect(avosFerias(d("2026-03-10"), d("2026-09-23"))).toMatchObject({ meses: 6, diasFracao: 14, avos: 6 });
  });
  test("mês completo exato: 10/03 a 09/09 = 6 avos, sem fração", () => {
    expect(avosFerias(d("2026-03-10"), d("2026-09-09"))).toMatchObject({ meses: 6, diasFracao: 0, avos: 6 });
  });
  test("mais de 12 meses: o aquisitivo recomeça no último aniversário", () => {
    const r = avosFerias(d("2024-03-10"), d("2026-05-24"));
    expect(r).toMatchObject({ inicioAquisitivo: "2026-03-10", meses: 2, diasFracao: 15, avos: 3, maisDe12Meses: true });
  });
  test("aniversário no dia da saída: aquisitivo novo, 1 dia, 0 avos (o anterior completo vira aviso)", () => {
    expect(avosFerias(d("2025-03-10"), d("2026-03-10"))).toMatchObject({ inicioAquisitivo: "2026-03-10", meses: 0, diasFracao: 1, avos: 0, maisDe12Meses: true });
  });
  test("véspera do aniversário: 12 avos (máximo)", () => {
    expect(avosFerias(d("2025-03-10"), d("2026-03-09"))).toMatchObject({ inicioAquisitivo: "2025-03-10", meses: 12, avos: 12, maisDe12Meses: false });
  });
  test("entrada no fim do mês: 31/01 + 1 mês cai em 28/02 (o 1º mês fecha em 27/02)", () => {
    expect(avosFerias(d("2026-01-31"), d("2026-02-26"))).toMatchObject({ meses: 0, diasFracao: 27, avos: 1 });
    expect(avosFerias(d("2026-01-31"), d("2026-02-27"))).toMatchObject({ meses: 1, diasFracao: 0, avos: 1 });
  });
  test("início depois da saída: zero", () => {
    expect(avosFerias(d("2026-10-01"), d("2026-09-24")).avos).toBe(0);
  });
});

describe("avos13 — ano civil da saída, mês com 15 dias ou mais", () => {
  test("entrada no próprio ano: 10/03 a 24/09 → mar (22 d) … ago completos + set (24 d) = 7 avos", () => {
    expect(avos13(d("2026-03-10"), d("2026-09-24"))).toMatchObject({ avos: 7, desde: "2026-03-10" });
  });
  test("exatamente 15 dias no mês da saída conta", () => {
    expect(avos13(d("2025-01-01"), d("2026-04-15")).avos).toBe(4);
  });
  test("14 dias no mês da saída não conta", () => {
    expect(avos13(d("2025-01-01"), d("2026-04-14")).avos).toBe(3);
  });
  test("entrada com 14 dias no mês não conta; com 15 conta", () => {
    expect(avos13(d("2026-03-18"), d("2026-05-31")).avos).toBe(2); // 18/03..31/03 = 14 dias
    expect(avos13(d("2026-03-17"), d("2026-05-31")).avos).toBe(3); // 15 dias
  });
  test("vários anos de casa: conta de 01/01 do ano da saída", () => {
    expect(avos13(d("2020-06-01"), d("2026-12-31"))).toMatchObject({ avos: 12, desde: "2026-01-01" });
  });
  test("fevereiro: 15 dias contam mesmo em mês de 28", () => {
    expect(avos13(d("2026-02-14"), d("2026-02-28")).avos).toBe(1);
  });
});

describe("diasAviso — 30 + 3 por ano completo, máximo 90", () => {
  test("menos de 1 ano: 30 dias", () => {
    expect(diasAviso(d("2026-03-10"), d("2026-09-24"))).toEqual({ anos: 0, dias: 30 });
  });
  test("1 ano completo (aniversário no dia da saída): 33 dias", () => {
    expect(diasAviso(d("2025-09-24"), d("2026-09-24"))).toEqual({ anos: 1, dias: 33 });
    expect(diasAviso(d("2025-09-25"), d("2026-09-24"))).toEqual({ anos: 0, dias: 30 });
  });
  test("2 anos: 36 dias", () => {
    expect(diasAviso(d("2024-01-01"), d("2026-09-24"))).toEqual({ anos: 2, dias: 36 });
  });
  test("30 anos: limitado a 90", () => {
    expect(diasAviso(d("1996-01-01"), d("2026-09-24"))).toEqual({ anos: 30, dias: 90 });
  });
});

describe("calcularVerbasOpcionais", () => {
  test("S 2.200,00, início 10/03/2026, saída 24/09/2026", () => {
    const c = calcularVerbasOpcionais({ salarioBase: 2200, inicio: d("2026-03-10"), saida: d("2026-09-24"), feriasRegistradas: [] })!;
    expect(c.base).toBe(2200);
    expect(c.ferias).toMatchObject({ avos: 7, ferias: 1283.33, terco: 427.78, valor: 1711.11 });
    expect(c.ferias.memoria).toBe("S 2.200,00 ÷ 12 × 7 avos = 1.283,33 + 1/3 (427,78)");
    expect(c.decimoTerceiro).toMatchObject({ avos: 7, valor: 1283.33, memoria: "S 2.200,00 ÷ 12 × 7 avos" });
    expect(c.aviso).toMatchObject({ dias: 30, anos: 0, valor: 2200, memoria: "S 2.200,00 ÷ 30 × 30 dias" });
    expect(c.avisoFeriasVencidas).toBeNull();
  });
  test("aviso com 2 anos: S ÷ 30 × 36", () => {
    const c = calcularVerbasOpcionais({ salarioBase: 1518, inicio: d("2024-01-01"), saida: d("2026-09-24"), feriasRegistradas: [] })!;
    expect(c.aviso).toMatchObject({ dias: 36, valor: 1821.6 });
  });
  test("mais de 12 meses sem férias registradas: aviso, sem calcular vencidas", () => {
    const c = calcularVerbasOpcionais({ salarioBase: 2200, inicio: d("2024-03-10"), saida: d("2026-05-24"), feriasRegistradas: [] })!;
    expect(c.ferias.avos).toBe(3);
    expect(c.avisoFeriasVencidas).toBe("Há período de férias completo sem registro de férias: não calculado automaticamente; se for o caso, use o valor livre");
  });
  test("mais de 12 meses com férias lançadas depois do aquisitivo anterior: sem aviso", () => {
    const c = calcularVerbasOpcionais({ salarioBase: 2200, inicio: d("2024-03-10"), saida: d("2026-05-24"), feriasRegistradas: [d("2025-11-01")] })!;
    expect(c.avisoFeriasVencidas).toBeNull();
  });
  test("férias antigas (antes do aquisitivo anterior) não cobrem: aviso", () => {
    const c = calcularVerbasOpcionais({ salarioBase: 2200, inicio: d("2022-03-10"), saida: d("2026-05-24"), feriasRegistradas: [d("2023-06-01")] })!;
    expect(c.avisoFeriasVencidas).not.toBeNull();
  });
  test("sem salário base ou sem início: null", () => {
    expect(calcularVerbasOpcionais({ salarioBase: null, inicio: d("2026-03-10"), saida: d("2026-09-24"), feriasRegistradas: [] })).toBeNull();
    expect(calcularVerbasOpcionais({ salarioBase: 2200, inicio: null, saida: d("2026-09-24"), feriasRegistradas: [] })).toBeNull();
  });
});

describe("lerEscolhaVerbas", () => {
  test("ausente: nada marcado", () => {
    expect(lerEscolhaVerbas(undefined)).toEqual({ escolha: { ferias: false, decimoTerceiro: false, aviso: false, livre: null } });
  });
  test("marcadas e valor livre com descrição", () => {
    expect(lerEscolhaVerbas({ ferias: true, decimoTerceiro: "x", aviso: false, livre: { valor: 300, descricao: " Acordo " } }))
      .toEqual({ escolha: { ferias: true, decimoTerceiro: false, aviso: false, livre: { valor: 300, descricao: "Acordo" } } });
  });
  test("valor livre sem descrição (ou curta): erro", () => {
    expect(lerEscolhaVerbas({ livre: { valor: 300, descricao: "ab" } })).toEqual({ erro: expect.stringContaining("descrição") });
  });
  test("valor livre zero, negativo ou absurdo: erro", () => {
    expect(lerEscolhaVerbas({ livre: { valor: 0, descricao: "Acordo" } })).toHaveProperty("erro");
    expect(lerEscolhaVerbas({ livre: { valor: -5, descricao: "Acordo" } })).toHaveProperty("erro");
    expect(lerEscolhaVerbas({ livre: { valor: "abc", descricao: "Acordo" } })).toHaveProperty("erro");
    expect(lerEscolhaVerbas({ livre: { valor: 2_000_000, descricao: "Acordo" } })).toHaveProperty("erro");
  });
  test("formato inválido: erro", () => {
    expect(lerEscolhaVerbas("sim")).toHaveProperty("erro");
  });
});

describe("aplicarVerbasOpcionais", () => {
  const calc = calcularVerbasOpcionais({ salarioBase: 2200, inicio: d("2026-03-10"), saida: d("2026-09-24"), feriasRegistradas: [] });
  test("nada marcado: sem itens, total 0", () => {
    expect(aplicarVerbasOpcionais(calc, { ferias: false, decimoTerceiro: false, aviso: false, livre: null }))
      .toEqual({ itens: [], total: 0 });
  });
  test("soma só o que foi marcado, com o valor do servidor", () => {
    const r = aplicarVerbasOpcionais(calc, { ferias: true, decimoTerceiro: true, aviso: false, livre: { valor: 150.5, descricao: "Gratificação" } });
    expect("erro" in r).toBe(false);
    if ("erro" in r) return;
    expect(r.itens.map((i) => i.tipo)).toEqual(["FERIAS", "DECIMO_TERCEIRO", "LIVRE"]);
    expect(r.itens[0]).toMatchObject({ rotulo: "Férias proporcionais + 1/3", avos: 7, valor: 1711.11, terco: 427.78 });
    expect(r.itens[2]).toMatchObject({ rotulo: "Gratificação", valor: 150.5, descricao: "Gratificação" });
    expect(r.total).toBe(3144.94);
  });
  test("marcou férias sem cálculo possível (sem salário/início): erro", () => {
    expect(aplicarVerbasOpcionais(null, { ferias: true, decimoTerceiro: false, aviso: false, livre: null })).toHaveProperty("erro");
  });
  test("só valor livre funciona mesmo sem cálculo", () => {
    const r = aplicarVerbasOpcionais(null, { ferias: false, decimoTerceiro: false, aviso: false, livre: { valor: 100, descricao: "Acordo" } });
    expect(r).toMatchObject({ total: 100 });
  });
});
