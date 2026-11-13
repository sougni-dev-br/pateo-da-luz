import { describe, expect, test } from "vitest";
import { type LinhaSalario, passosDaFicha, planejarSalarios, textoDoPasso } from "../salarios-da-ficha.js";

// Dados FICTÍCIOS (valores redondos inventados): o repositório é público.
const ficha = (admissao: string, salarioAdmissao: number, salarios: Array<[string, number]>) => ({
  dataAdmissao: admissao, salarioAdmissao,
  salarios: salarios.map(([vigencia, valor]) => ({ vigencia, valor, retroativoCompetencia: null })),
});
const linha = (valorAnterior: string, valorNovo: string, vigenteDesde: string, minuto: number, origem: string | null = null): LinhaSalario => ({
  campo: "baseSalary", valorAnterior, valorNovo, vigenteDesde: new Date(`${vigenteDesde}T00:00:00.000Z`),
  createdAt: new Date(Date.UTC(2026, 10, 13, 12, minuto)), origem,
});

const DESDE = "2026-11-01";
const dissidio = ficha("2024-04-17", 2000, [["2026-04-01", 2400], ["2026-07-01", 2500], ["2026-11-01", 2600]]);

describe("passosDaFicha", () => {
  test("só os degraus a partir da data, em ordem; o passado não é reescrito", () => {
    expect(passosDaFicha(dissidio, DESDE)).toEqual([{ vigencia: "2026-11-01", valor: 2600, origem: "ALTERACAO" }]);
  });
  test("a admissão também é um degrau (corrige salário de entrada errado)", () => {
    const novo = ficha("2026-11-01", 3000, []);
    expect(passosDaFicha(novo, DESDE)).toEqual([{ vigencia: "2026-11-01", valor: 3000, origem: "ADMISSAO" }]);
  });
  test("valor zero ou inválido não vira degrau", () => {
    expect(passosDaFicha(ficha("2026-11-01", 0, [["2026-11-02", Number.NaN]]), DESDE)).toEqual([]);
  });
});

describe("planejarSalarios", () => {
  test("cadastro parado no degrau anterior: propõe o novo, com a variação", () => {
    const plano = planejarSalarios(passosDaFicha(dissidio, DESDE), [], 2500, DESDE);
    expect(plano.avisos).toEqual([]);
    expect(plano.passos).toEqual([{ vigencia: "2026-11-01", valor: 2600, origem: "ALTERACAO", antes: 2500 }]);
    expect(textoDoPasso(plano.passos[0])).toMatch(/^desde 01\/11\/2026: R\$\s?2\.500,00 → R\$\s?2\.600,00 \(\+4%\) \[alteração salarial\]$/);
  });
  test("dois degraus seguidos: o segundo parte do valor do primeiro", () => {
    const f = ficha("2024-09-01", 2000, [["2026-11-01", 2300], ["2026-11-02", 2350]]);
    const plano = planejarSalarios(passosDaFicha(f, DESDE), [], 2200, DESDE);
    expect(plano.passos.map((p) => [p.vigencia, p.antes, p.valor])).toEqual([
      ["2026-11-01", 2200, 2300],
      ["2026-11-02", 2300, 2350],
    ]);
  });
  test("cadastro já igual à ficha: nada a fazer", () => {
    expect(planejarSalarios(passosDaFicha(dissidio, DESDE), [], 2600, DESDE)).toEqual({ passos: [], avisos: [] });
  });
  test("idempotente: depois de aplicado (com histórico), rodar de novo não acha nada", () => {
    const f = ficha("2024-09-01", 2000, [["2026-11-01", 2300], ["2026-11-02", 2350]]);
    const aplicado = [linha("2200.00", "2300.00", "2026-11-01", 1, "FICHA_REGISTRO"), linha("2300.00", "2350.00", "2026-11-02", 2, "FICHA_REGISTRO")];
    expect(planejarSalarios(passosDaFicha(f, DESDE), aplicado, 2350, DESDE)).toEqual({ passos: [], avisos: [] });
  });
  test("aplicação que parou no meio: completa o degrau que faltou, sem acusar as próprias linhas", () => {
    const f = ficha("2024-09-01", 2000, [["2026-11-01", 2300], ["2026-11-02", 2350]]);
    const metade = [linha("2200.00", "2300.00", "2026-11-01", 1, "FICHA_REGISTRO")];
    const plano = planejarSalarios(passosDaFicha(f, DESDE), metade, 2300, DESDE);
    expect(plano.avisos).toEqual([]);
    expect(plano.passos.map((p) => [p.vigencia, p.antes, p.valor])).toEqual([["2026-11-02", 2300, 2350]]);
  });
  test("salário de admissão gravado errado é corrigido desde a admissão", () => {
    const plano = planejarSalarios(passosDaFicha(ficha("2026-11-01", 3000, []), DESDE), [], 2800, DESDE);
    expect(plano.passos).toEqual([{ vigencia: "2026-11-01", valor: 3000, origem: "ADMISSAO", antes: 2800 }]);
  });
  test("cadastro já mexido à mão a partir da data e diferente da ficha: não propõe, avisa", () => {
    const aMao = [linha("2500.00", "2550.00", "2026-11-15", 1, "CADASTRO")];
    const plano = planejarSalarios(passosDaFicha(dissidio, DESDE), aMao, 2550, DESDE);
    expect(plano.passos).toEqual([]);
    expect(plano.avisos[0]).toMatch(/já tem mudança de salário valendo desde 15\/11\/2026/);
  });
  test("mudança antiga no histórico (antes da data) não impede", () => {
    const antiga = [linha("2400.00", "2500.00", "2026-07-01", 1)];
    const plano = planejarSalarios(passosDaFicha(dissidio, DESDE), antiga, 2500, DESDE);
    expect(plano.passos).toHaveLength(1);
    expect(plano.avisos).toEqual([]);
  });
});
