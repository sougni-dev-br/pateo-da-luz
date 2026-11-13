import { describe, expect, test } from "vitest";
import { calcularDecimoTerceiroSR } from "../decimo-terceiro-sr.js";
import { validarVariavelInformada } from "../decimo-terceiro.service.js";

// Dados FICTÍCIOS: o repositório é público.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const meses = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
const base = { ano: 2026, salarioBase: 2400, inicio: d("2026-01-01"), desligamento: null as Date | null };
const apurados = new Set([7, 8, 9, 10]);

describe("validarVariavelInformada", () => {
  const ok = { employeeId: "e1", ano: 2026, mes: 8, valor: 638.16, motivo: "Gorjeta paga por fora" };
  test("entrada válida não tem erro", () => expect(validarVariavelInformada(ok)).toBeNull());
  test("zero é válido (mês sem variável)", () => expect(validarVariavelInformada({ ...ok, valor: 0 })).toBeNull());
  test.each([
    ["mês 0", { mes: 0 }], ["mês 12 (não entra no 13º)", { mes: 12 }], ["mês fracionado", { mes: 8.5 }],
    ["valor negativo", { valor: -1 }], ["valor NaN", { valor: Number.NaN }], ["valor texto", { valor: "10" as unknown as number }],
    ["sem motivo", { motivo: "  " }], ["motivo curto", { motivo: "abc" }], ["sem funcionário", { employeeId: "" }],
  ])("recusa: %s", (_n, troca) => expect(validarVariavelInformada({ ...ok, ...troca })).not.toBeNull());
});

describe("variável informada no cálculo do 13º", () => {
  test("mês informado entra na média e aumenta o 13º", () => {
    const sem = calcularDecimoTerceiroSR({ ...base, variaveis: meses({ 7: 100, 9: 100, 10: 100 }), mesesApurados: apurados })!;
    const com = calcularDecimoTerceiroSR({ ...base, variaveis: meses({ 7: 100, 8: 400, 9: 100, 10: 100 }), mesesApurados: apurados })!;
    expect(com.mediaParcela1).toBeGreaterThan(sem.mediaParcela1);
    // média ÷ nº de meses apurados (4), 13º = (salário + média) ÷ 12 × avos.
    expect(com.mediaParcela1).toBe(175);
  });
  test("mês apurado sem dado da pessoa conta como zero e puxa a média para baixo", () => {
    const r = calcularDecimoTerceiroSR({ ...base, variaveis: meses({ 7: 100, 9: 100, 10: 100 }), mesesApurados: apurados })!;
    expect(r.mediaParcela1).toBe(75);
  });
});

describe("mês informado sem apuração (gorjeta paga por fora)", () => {
  test("conta para a pessoa quando o mês entra nos meses apurados dela", () => {
    // Mês 8 sem apuração: só conta se o serviço o inclui nos meses da pessoa.
    const global = new Set([7, 9, 10]);
    const semInformar = calcularDecimoTerceiroSR({ ...base, variaveis: meses({ 7: 100, 9: 100, 10: 100 }), mesesApurados: global })!;
    const informado = calcularDecimoTerceiroSR({ ...base, variaveis: meses({ 7: 100, 8: 400, 9: 100, 10: 100 }), mesesApurados: new Set([...global, 8]) })!;
    expect(semInformar.mediaParcela1).toBe(100);
    expect(informado.mediaParcela1).toBe(175);
  });
  test("motivo longo demais é recusado", () => {
    expect(validarVariavelInformada({ employeeId: "e1", ano: 2026, mes: 8, valor: 1, motivo: "x".repeat(301) })).not.toBeNull();
  });
});
