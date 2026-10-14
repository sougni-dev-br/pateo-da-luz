import { describe, expect, test } from "vitest";
import { ehBuffet } from "../agile-categorias.js";
import {
  MIN_PESSOAS_FAIXA_PARA_AVISO, montarMargemBuffet, type CustoDoMes, type FaixaDeBuffet, type MesDeBuffet
} from "../agile-analise-margem-buffet.report.js";

const periodo = { inicio: "2026-09-01", fim: "2026-10-13" };
const faixa = (produto: string, comandas: number, pessoas: number, receita: number, over: Partial<FaixaDeBuffet> = {}): FaixaDeBuffet => ({ produto, comandas, pessoas, receita, receitaComPessoas: receita, ...over });
const mes = (ano: number, m: number, comandas: number, pessoas: number, receita: number, over: Partial<MesDeBuffet> = {}): MesDeBuffet => ({ ano, mes: m, comandas, pessoas, receita, receitaComPessoas: receita, ...over });
const custo = (ano: number, m: number, valor: number): CustoDoMes => ({ ano, mes: m, valor });
const montar = (over: Partial<Parameters<typeof montarMargemBuffet>[0]> = {}) =>
  montarMargemBuffet({
    periodo, faixas: [faixa("BUFFET PROMO 15", 100, 200, 17000)], meses: [mes(2026, 9, 80, 160, 13600), mes(2026, 10, 20, 40, 3400)],
    custos: [], historicoDeCustos: [], receitaTotalDoSalao: 25000, ...over
  });

describe("ehBuffet", () => {
  test.each([["BUFFET PROMO 15", true], ["  buffet promo", true], ["Buffet", true], ["BUFFET", true], ["BUFFETE DO CHEFE", false], ["PACOTE BUFFET", false], ["", false]])("%j -> %s", (nome, esperado) => {
    expect(ehBuffet(nome)).toBe(esperado);
  });
});

describe("lado da receita (sempre)", () => {
  test("pessoas, comandas, receita e receita por pessoa do periodo", () => {
    const r = montar();
    expect(r.buffet).toMatchObject({ comandas: 100, pessoas: 200, receita: 17000, receitaPorPessoa: 85 });
  });

  test("ticket por pessoa so das comandas com pessoas informadas (comanda sem pessoas nao infla o ticket)", () => {
    const r = montar({ meses: [mes(2026, 9, 100, 100, 10000, { receitaComPessoas: 8000 })], faixas: [faixa("BUFFET PROMO 15", 100, 100, 10000, { receitaComPessoas: 8000 })] });
    expect(r.buffet.receitaPorPessoa).toBe(80); // 8.000 / 100, nao 10.000 / 100
    expect(r.buffet.receita).toBe(10000);
  });

  test("participacao do buffet na receita do salao", () => {
    expect(montar().buffet.pctDaReceita).toBe(0.68); // 17.000 / 25.000
    expect(montar({ receitaTotalDoSalao: 0 }).buffet.pctDaReceita).toBe(0);
  });

  test("faixas de preco: ordenadas pela receita, com receita por pessoa e participacao", () => {
    const r = montar({ faixas: [faixa("BUFFET PROMO 20", 20, 40, 4000), faixa("BUFFET PROMO 15", 100, 200, 17000)] });
    expect(r.faixas.map((f) => f.produto)).toEqual(["BUFFET PROMO 15", "BUFFET PROMO 20"]);
    expect(r.faixas[1]).toMatchObject({ pessoas: 40, receitaPorPessoa: 100, pctReceita: expect.closeTo(4000 / 21000, 4) });
  });

  test("periodo sem buffet: tudo zero e sem divisao por zero", () => {
    const r = montar({ faixas: [], meses: [], receitaTotalDoSalao: 0 });
    expect(r.buffet).toMatchObject({ comandas: 0, pessoas: 0, receita: 0, receitaPorPessoa: 0, pctDaReceita: 0 });
    expect(r.margem).toBeNull();
    expect(r.meses).toEqual([]);
  });
});

describe("margem com o custo informado", () => {
  test("custo do mes: margem por pessoa, margem total e % do ticket", () => {
    const r = montar({ custos: [custo(2026, 9, 35)] });
    const set = r.meses.find((m) => m.mes === 9);
    expect(set).toMatchObject({ pessoas: 160, receitaPorPessoa: 85, custoPorPessoa: 35, margemPorPessoa: 50, margemTotal: 8000, margemPct: expect.closeTo(50 / 85, 4), status: "com-custo" });
    expect(r.meses.find((m) => m.mes === 10)).toMatchObject({ custoPorPessoa: null, margemPorPessoa: null, margemTotal: null, status: "sem-custo" });
  });

  test("a margem do periodo so soma os meses COM custo (mes sem custo nao vira margem de 100%)", () => {
    const r = montar({ custos: [custo(2026, 9, 35)] });
    expect(r.margem).toMatchObject({ pessoas: 160, receita: 13600, custo: 5600, margem: 8000, custoPorPessoa: 35, margemPorPessoa: 50 });
    expect(r.cobertura).toMatchObject({ pessoasComCusto: 160, pessoasTotal: 200, pctComCusto: 0.8, mesesSemCusto: 1 });
  });

  test("custo por pessoa do periodo e a media PONDERADA pelas pessoas de cada mes", () => {
    const r = montar({ custos: [custo(2026, 9, 30), custo(2026, 10, 50)] }); // 160 x 30 + 40 x 50 = 6.800 / 200 = 34
    expect(r.margem?.custoPorPessoa).toBe(34);
    expect(r.margem?.custo).toBe(6800);
    expect(r.cobertura.pctComCusto).toBe(1);
    expect(r.cobertura.mesesSemCusto).toBe(0);
  });

  test("ticket do mes so das comandas com pessoas informadas: a margem nao conta receita sem pessoa", () => {
    // 10.000 de receita, mas so 8.000 de comandas com pessoas (100): ticket 80; custo 30 => margem 50 por pessoa, total 8.000 - 3.000 = 5.000.
    const r = montar({ meses: [mes(2026, 9, 100, 100, 10000, { receitaComPessoas: 8000 })], custos: [custo(2026, 9, 30)] });
    expect(r.meses[0]).toMatchObject({ receita: 10000, receitaPorPessoa: 80, margemPorPessoa: 50, margemTotal: 5000, margemPct: 0.625 });
    expect(r.margem).toMatchObject({ receita: 8000, custo: 3000, margem: 5000 });
  });

  test("so cortesia (receita zero com pessoas): a margem total aparece negativa e o percentual fica sem dado, nao 0%", () => {
    const r = montar({ meses: [mes(2026, 9, 10, 20, 0)], faixas: [faixa("BUFFET STAFF", 10, 20, 0)], custos: [custo(2026, 9, 30)] });
    expect(r.meses[0]).toMatchObject({ margemTotal: -600, margemPct: null });
    expect(r.margem).toMatchObject({ margem: -600, margemPct: null });
  });

  test("custo maior que o ticket: margem negativa continua negativa", () => {
    const r = montar({ custos: [custo(2026, 9, 100)] });
    expect(r.meses.find((m) => m.mes === 9)).toMatchObject({ margemPorPessoa: -15, margemTotal: -2400 });
  });

  test("custo cadastrado de mes fora do periodo nao entra", () => {
    const r = montar({ custos: [custo(2026, 8, 40)] });
    expect(r.margem).toBeNull();
    expect(r.meses.every((m) => m.status === "sem-custo")).toBe(true);
  });

  test("mes do periodo sem pessoas informadas: sem ticket por pessoa, sem margem", () => {
    const r = montar({ meses: [mes(2026, 9, 10, 0, 1000, { receitaComPessoas: 0 })], faixas: [faixa("BUFFET PROMO 15", 10, 0, 1000, { receitaComPessoas: 0 })], custos: [custo(2026, 9, 35)] });
    expect(r.meses[0]).toMatchObject({ receitaPorPessoa: 0, margemPorPessoa: null, status: "sem-pessoas" });
    expect(r.margem).toBeNull();
  });

  test("referencia: o ultimo custo informado (mais recente primeiro) para o usuario partir dele", () => {
    const r = montar({ historicoDeCustos: [custo(2026, 6, 30), custo(2026, 8, 33), custo(2026, 7, 31)] });
    expect(r.referencia).toEqual({ ano: 2026, mes: 8, valor: 33 });
    expect(montar().referencia).toBeNull();
  });
});

describe("avisos", () => {
  test("custo informado maior que o ticket do mes: alerta", () => {
    const r = montar({ custos: [custo(2026, 9, 100)] });
    expect(r.insights[0]).toMatchObject({ id: "custo-acima-do-ticket", tom: "alerta" });
  });

  test("faixa de preco com ticket abaixo do custo do periodo: alerta com a faixa (so com pessoas suficientes)", () => {
    const r = montar({
      faixas: [faixa("BUFFET PROMO 15", 300, 600, 60000), faixa("BUFFET PROMO 5", 200, 400, 14000)], // 100 por pessoa e 35 por pessoa
      meses: [mes(2026, 9, 500, 1000, 74000)], custos: [custo(2026, 9, 40)]
    });
    const ins = r.insights.find((i) => i.id === "faixa-abaixo-do-custo");
    expect(ins?.titulo).toContain("BUFFET PROMO 5");
    expect(ins?.tom).toBe("alerta");
  });

  test("faixa pequena (poucas pessoas) nao dispara o aviso", () => {
    const r = montar({
      faixas: [faixa("BUFFET PROMO 15", 300, 600, 60000), faixa("BUFFET STAFF", 2, MIN_PESSOAS_FAIXA_PARA_AVISO - 1, 100)],
      meses: [mes(2026, 9, 302, 600 + MIN_PESSOAS_FAIXA_PARA_AVISO - 1, 60100)], custos: [custo(2026, 9, 40)]
    });
    expect(r.insights.map((i) => i.id)).not.toContain("faixa-abaixo-do-custo");
  });

  test("o limite de pessoas da faixa e inclusivo: exatamente o minimo ja dispara o aviso", () => {
    const r = montar({
      faixas: [faixa("BUFFET PROMO 15", 300, 600, 60000), faixa("BUFFET PROMO 5", 20, MIN_PESSOAS_FAIXA_PARA_AVISO, 50 * 10)],
      meses: [mes(2026, 9, 320, 600 + MIN_PESSOAS_FAIXA_PARA_AVISO, 60500)], custos: [custo(2026, 9, 40)]
    });
    expect(r.insights.map((i) => i.id)).toContain("faixa-abaixo-do-custo");
  });

  test("custo informado so para parte das pessoas: aviso de informacao pedindo os meses que faltam", () => {
    const r = montar({ custos: [custo(2026, 9, 35)] });
    const ins = r.insights.find((i) => i.id === "custo-parcial");
    expect(ins).toMatchObject({ tom: "info" });
    expect(ins?.titulo).toMatch(/80%/);
  });

  test("nenhum custo informado: aviso convida a informar, sem inventar margem", () => {
    const r = montar();
    expect(r.insights.map((i) => i.id)).toEqual(["sem-custo-informado"]);
  });

  test("tudo informado e acima do custo: sem aviso", () => {
    expect(montar({ custos: [custo(2026, 9, 30), custo(2026, 10, 30)] }).insights).toEqual([]);
  });
});
