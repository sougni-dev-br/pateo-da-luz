import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { calcularRateio, emTesteNaGorjeta, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";
import { mesDoSalario } from "../tip-commission.service.js";

// Entrada na gorjeta (regra do Eli, 01/10/2026): "Quando contratamos alguém, ele começa
// fazendo teste [...]. Se decidimos ficar com a pessoa, decidimos quando ele entra no
// cálculo de gorjeta". A gorjeta conta desde inicioGorjeta; o salário do sem registro,
// desde a admissão (os dias de teste são pagos).
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SETEMBRO: RegrasPeriodo = {
  start: d("2026-08-26"), end: d("2026-09-25"), diasPadrao: 26,
  descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
  pointsTotal: 100, deductionPercent: 20, netPool: 16000,
  mesSalario: mesDoSalario(2026, 9),
};

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 4, ajuste: 0, fixedAmount: null,
    admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    vales: [],
    ...over,
  };
}

describe("emTesteNaGorjeta", () => {
  const fim = d("2026-09-25");
  test("participa sem data: em teste", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: null }, fim)).toBe(true);
  });
  test("participa com data depois do fim do ciclo: em teste neste período", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: d("2026-09-26") }, fim)).toBe(true);
  });
  test("participa com data até o fim do ciclo (inclusive): na gorjeta", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: d("2026-09-25") }, fim)).toBe(false);
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: d("2024-01-01") }, fim)).toBe(false);
  });
  test("quem não participa não está 'em teste' (é outra regra)", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: false, inicioGorjeta: null }, fim)).toBe(false);
  });
});

describe("presença na gorjeta conta desde a entrada na gorjeta", () => {
  test("entrada em 10/09 rende o mesmo que uma admissão em 10/09", () => {
    const desdeEntrada = calcularRateio(SETEMBRO, [
      pessoa({ admissao: d("2026-09-01"), inicioGorjeta: d("2026-09-10") }), pessoa(),
    ]).linhas[0];
    const admitidoNoDia = calcularRateio(SETEMBRO, [pessoa({ admissao: d("2026-09-10") }), pessoa()]).linhas[0];
    expect(desdeEntrada.diasElegiveis).toBe(16);
    expect(desdeEntrada.diasPrevistos).toBe(admitidoNoDia.diasPrevistos);
    expect(desdeEntrada.fatorPresenca).toBe(admitidoNoDia.fatorPresenca);
    expect(desdeEntrada.pontosFinais).toBe(admitidoNoDia.pontosFinais);
    expect(desdeEntrada.rateio).toBe(admitidoNoDia.rateio);
    expect(desdeEntrada.tipoCalculo).toBe("MES");
  });

  test("entrada antes do ciclo: mês cheio, como antes", () => {
    const [l] = calcularRateio(SETEMBRO, [pessoa({ admissao: d("2025-01-01"), inicioGorjeta: d("2025-03-01") })]).linhas;
    expect(l.diasElegiveis).toBe(31);
    expect(l.fatorPresenca).toBe(1);
  });

  test("data de entrada antes da admissão (digitada errada) não conta dias antes da admissão", () => {
    const [l] = calcularRateio(SETEMBRO, [pessoa({ admissao: d("2026-09-10"), inicioGorjeta: d("2026-09-01") })]).linhas;
    expect(l.diasElegiveis).toBe(16);
  });

  test("sem registro que entra no meio: gorjeta proporcional desde a entrada, salário do mês desde a admissão", () => {
    const [l] = calcularRateio(SETEMBRO, [pessoa({
      semRegistro: true, salarioBase: 3000, admissao: d("2026-09-01"), inicioGorjeta: d("2026-09-10"),
    })]).linhas;
    expect(l.foraDaGorjeta).toBe(false);
    expect(l.diasElegiveis).toBe(16);
    expect(l.pontosFinais).toBeLessThan(4);
    expect(l.pontosFinais).toBeGreaterThan(0);
    // Setembro inteiro desde a admissão em 01/09: 30 dias de salário.
    expect(l.diasSalario).toBe(30);
    expect(l.salarioProporcional).toBe(3000);
  });

  test("ausente (cadastro antigo/testes) segue a admissão", () => {
    const [l] = calcularRateio(SETEMBRO, [pessoa({ admissao: d("2026-09-10") })]).linhas;
    expect(l.diasElegiveis).toBe(16);
  });
});

describe("rescisão do sem registro em teste", () => {
  test("saiu antes de entrar na gorjeta: só o salário dos dias, gorjeta zero", () => {
    const [l] = calcularRateio(SETEMBRO, [pessoa({
      foraDaGorjeta: true, basePoints: 0, semRegistro: true, salarioBase: 2400,
      admissao: d("2026-09-15"), desligamento: d("2026-09-18"),
    })]).linhas;
    expect(l.rateio).toBe(0);
    expect(l.diasSalario).toBe(4);
    expect(l.salarioProporcional).toBe(320);
    expect(l.totalAPagar).toBe(320);
  });
});

describe("migration do backfill", () => {
  const pasta = join(__dirname, "../../../../prisma/migrations");
  const dir = readdirSync(pasta).find((n) => /^2026100120\d{4}_inicio_gorjeta$/.test(n));
  const sql = dir ? readFileSync(join(pasta, dir, "migration.sql"), "utf8") : "";

  test("existe e é aditiva (coluna DATE, nada de DROP)", () => {
    expect(dir).toBeTruthy();
    expect(sql).toMatch(/ALTER TABLE "Employee" ADD COLUMN "inicioGorjeta" DATE;/);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  test("preenche só quem participa, pela admissão, sem sobrescrever", () => {
    const update = sql.slice(sql.indexOf("UPDATE"));
    expect(update).toMatch(/SET "inicioGorjeta" = "admissionDate"::date/);
    expect(update).toMatch(/"participaGorjeta" = true/);
    expect(update).toMatch(/"inicioGorjeta" IS NULL/);
    expect(update).toMatch(/"admissionDate" IS NOT NULL/);
  });
});
