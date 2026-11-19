import { describe, expect, test } from "vitest";
import {
  combinadoProporcional, complementoDeFerias, janelaDeMeses, mediaDaGorjeta, semMarcasDoFeriasCombinado,
  foiSomadoAFerias, valorFeriasComCombinado, valorDoMesDaGorjeta, type MesDaGorjeta,
} from "../ferias-combinado.js";

// Valores fictícios: combinado 6.000, base 4.000, gorjeta média 1.500, recibo líquido 6.000.
describe("combinadoProporcional", () => {
  test("sem dias de férias no mês: combinado cheio, sem proporção", () => {
    expect(combinadoProporcional({ combinado: 6000, diasDeFerias: 0, diasNoMes: 30 })).toEqual({ valor: 6000, diasPagos: 30, diasDeFerias: 0, proporcional: false });
  });

  test("10 dias de férias: combinado × 20 / 30 (mesmo critério da gorjeta: mês de 30 dias)", () => {
    expect(combinadoProporcional({ combinado: 6000, diasDeFerias: 10, diasNoMes: 31 })).toEqual({ valor: 4000, diasPagos: 20, diasDeFerias: 10, proporcional: true });
  });

  test("diária arredondada a centavos antes de multiplicar (como o RH faz à mão)", () => {
    // 2.200 ÷ 30 = 73,33; 9 dias = 659,97
    expect(combinadoProporcional({ combinado: 2200, diasDeFerias: 21, diasNoMes: 30 }).valor).toBe(659.97);
  });

  test("mês inteiro de férias: combinado zero", () => {
    expect(combinadoProporcional({ combinado: 6000, diasDeFerias: 31, diasNoMes: 31 }).valor).toBe(0);
    expect(combinadoProporcional({ combinado: 6000, diasDeFerias: 28, diasNoMes: 28 }).valor).toBe(0);
  });

  test("dias de férias maiores que o mês são limitados ao mês", () => {
    expect(combinadoProporcional({ combinado: 6000, diasDeFerias: 40, diasNoMes: 30 }).valor).toBe(0);
  });
});

describe("janelaDeMeses", () => {
  test("12 competências anteriores ao mês do início do gozo", () => {
    const j = janelaDeMeses(2027, 1);
    expect(j).toHaveLength(12);
    expect(j[0]).toEqual({ ano: 2026, mes: 1, chave: "2026-01" });
    expect(j[11]).toEqual({ ano: 2026, mes: 12, chave: "2026-12" });
  });

  test("atravessa a virada do ano", () => {
    const j = janelaDeMeses(2026, 11);
    expect(j[0].chave).toBe("2025-11");
    expect(j[11].chave).toBe("2026-10");
  });
});

const m = (chave: string, valor: number | null, origem: MesDaGorjeta["origem"] = "APURACAO"): MesDaGorjeta => ({ chave, valor, origem });

describe("mediaDaGorjeta", () => {
  test("média dos meses com valor; mês sem apuração nem informado não entra e é listado", () => {
    const r = mediaDaGorjeta([m("2026-01", 1000), m("2026-02", 2000, "INFORMADA"), m("2026-03", null, "AUSENTE")]);
    expect(r.media).toBe(1500);
    expect(r.mesesContados).toBe(2);
    expect(r.mesesAusentes).toEqual(["2026-03"]);
  });

  test("nenhum mês com valor: média zero e todos ausentes", () => {
    const r = mediaDaGorjeta([m("2026-01", null, "AUSENTE")]);
    expect(r).toEqual({ media: 0, mesesContados: 0, mesesAusentes: ["2026-01"] });
  });

  test("zero informado conta como mês (pessoa sem gorjeta no mês)", () => {
    expect(mediaDaGorjeta([m("2026-01", 0), m("2026-02", 3000)]).media).toBe(1500);
  });
});

describe("complementoDeFerias", () => {
  test("caso base: (6.000 + 1.500) × 4/3 − 6.000 = 4.000", () => {
    const r = complementoDeFerias({ combinado: 6000, mediaGorjeta: 1500, liquidoRecibo: 6000 });
    expect(r.remuneracao).toBe(10000);
    expect(r.complemento).toBe(4000);
    expect(r.negativo).toBe(false);
  });

  test("recibo da contabilidade já acima do devido: complemento zero e marcado", () => {
    const r = complementoDeFerias({ combinado: 3000, mediaGorjeta: 0, liquidoRecibo: 5000 });
    expect(r.complemento).toBe(0);
    expect(r.negativo).toBe(true);
  });

  test("arredonda a centavos", () => {
    expect(complementoDeFerias({ combinado: 1000.01, mediaGorjeta: 0.01, liquidoRecibo: 0 }).remuneracao).toBe(1333.36);
  });
});

describe("valorFeriasComCombinado", () => {
  const calc = complementoDeFerias({ combinado: 6000, mediaGorjeta: 1500, liquidoRecibo: 6000 });
  const meses = [m("2026-01", 1500)];
  test("valor do título = recibo + complemento; fórmula e fontes ficam nos detalhes", () => {
    const r = valorFeriasComCombinado({ liquidoRecibo: 6000, calc, combinado: 6000, media: { media: 1500, mesesContados: 1, mesesAusentes: [] }, meses });
    expect(r.valor).toBe(10000);
    expect(r.detalhes.origemValor).toBe("FERIAS_COMBINADO");
    expect(r.detalhes.liquidoExtrato).toBe(6000);
    expect(r.detalhes.complemento).toBe(4000);
    expect(r.detalhes.composicao).toContain("4/3");
    expect(r.detalhes.feriasCombinado.meses).toEqual(meses);
  });

  test("marcas somem ao reverter, sem tocar no resto dos detalhes", () => {
    const r = valorFeriasComCombinado({ liquidoRecibo: 6000, calc, combinado: 6000, media: { media: 1500, mesesContados: 1, mesesAusentes: [] }, meses });
    const limpo = semMarcasDoFeriasCombinado({ ...r.detalhes, recibo: { hash: "abc" } });
    expect(limpo).toEqual({ recibo: { hash: "abc" } });
    expect(foiSomadoAFerias(r.detalhes)).toBe(true);
    expect(foiSomadoAFerias(limpo)).toBe(false);
  });
});

describe("complementoDeFerias — férias fracionadas (dias do recibo)", () => {
  test("14 dias de gozo: remuneração proporcional a 14/30", () => {
    // (6.000 + 1.500) × 4/3 = 10.000 × 14/30 = 4.666,67; recibo 2.800 → complemento 1.866,67
    const r = complementoDeFerias({ combinado: 6000, mediaGorjeta: 1500, liquidoRecibo: 2800, dias: 14 });
    expect(r.remuneracao).toBe(4666.67);
    expect(r.complemento).toBe(1866.67);
  });

  test("30 dias, ausente ou acima de 30: valor cheio", () => {
    for (const dias of [30, undefined, 33]) expect(complementoDeFerias({ combinado: 6000, mediaGorjeta: 1500, liquidoRecibo: 6000, dias }).remuneracao).toBe(10000);
  });
});

// Regra (Eli, 19/11/2026, revista): valor INFORMADO (planilha) vale sobre a apuração do ERP, seja ela zero, aberta ou parcial;
// a apuração só entra quando não há informado. `apuracaoErp` leva a apuração como referência.
describe("valorDoMesDaGorjeta", () => {
  test("informado vale sobre a apuração > 0 (planilha fechou diferente do ERP aberto)", () => {
    expect(valorDoMesDaGorjeta({ apuracao: 2016.17, informada: 2593.97 })).toEqual({ valor: 2593.97, origem: "INFORMADA", apuracaoErp: 2016.17 });
  });
  test("informado vale sobre apuração zero", () => {
    expect(valorDoMesDaGorjeta({ apuracao: 0, informada: 1392.45 })).toEqual({ valor: 1392.45, origem: "INFORMADA", apuracaoErp: 0 });
  });
  test("informado 0 digitado também vale (zero explícito)", () => {
    expect(valorDoMesDaGorjeta({ apuracao: 1500, informada: 0 })).toEqual({ valor: 0, origem: "INFORMADA", apuracaoErp: 1500 });
  });
  test("sem informado: vale a apuração (inclusive zero)", () => {
    expect(valorDoMesDaGorjeta({ apuracao: 1500, informada: null })).toEqual({ valor: 1500, origem: "APURACAO", apuracaoErp: 1500 });
    expect(valorDoMesDaGorjeta({ apuracao: 0, informada: null })).toEqual({ valor: 0, origem: "APURACAO", apuracaoErp: 0 });
  });
  test("sem apuração: informado preenche; sem nada, ausente", () => {
    expect(valorDoMesDaGorjeta({ apuracao: null, informada: 800 })).toEqual({ valor: 800, origem: "INFORMADA", apuracaoErp: null });
    expect(valorDoMesDaGorjeta({ apuracao: null, informada: null })).toEqual({ valor: null, origem: "AUSENTE", apuracaoErp: null });
  });
});
