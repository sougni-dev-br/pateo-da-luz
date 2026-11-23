import { describe, expect, it } from "vitest";
import type { PlanejamentoLinhaDeGasto, PlanejamentoRealizadoDoGrupo } from "../../../api/client";
import { aplicarRealizado, temSugestao } from "../realizado";

const linha = (grupo: PlanejamentoLinhaDeGasto["grupo"], nome: string, modo: "FIXO" | "PERCENTUAL" = "FIXO", v = 0): PlanejamentoLinhaDeGasto => ({ grupo, nome, modo, valores: Array(12).fill(v) });
const sugestao = (grupo: PlanejamentoRealizadoDoGrupo["grupo"], sobre: Partial<PlanejamentoRealizadoDoGrupo> = {}): PlanejamentoRealizadoDoGrupo => ({
  grupo, origemNoDre: true, valoresPorMes: [100, 200, ...Array(10).fill(null)], media: 150, mesesConsiderados: [1, 2], mesesSemLancamento: [], percentualDaReceita: 0.08, ...sobre
});

describe("aplicarRealizado", () => {
  it("modo média: preenche os 12 meses da linha do grupo com a média", () => {
    const r = aplicarRealizado([linha("OCUPACAO", "Ocupação", "FIXO", 1)], [sugestao("OCUPACAO")], "MEDIA");
    expect(r.gastos[0].valores).toEqual(Array(12).fill(150));
    expect(r.gruposAplicados).toEqual(["OCUPACAO"]);
  });

  it("modo mesmo mês: usa o realizado de cada mês e a média onde o mês não fechou", () => {
    const r = aplicarRealizado([linha("OCUPACAO", "Ocupação")], [sugestao("OCUPACAO")], "MESMO_MES");
    expect(r.gastos[0].valores.slice(0, 3)).toEqual([100, 200, 150]);
  });

  it("mesmo mês: mês fora da média (sem lançamento) recebe a média, não zero", () => {
    const s = sugestao("OCUPACAO", { valoresPorMes: [50000, 54000, 0, ...Array(9).fill(null)], mesesConsiderados: [1, 2], mesesSemLancamento: [3], media: 52000 });
    const r = aplicarRealizado([linha("OCUPACAO", "Ocupação")], [s], "MESMO_MES");
    expect(r.gastos[0].valores.slice(0, 4)).toEqual([50000, 54000, 52000, 52000]);
  });

  it("soma negativa ou percentual acima de 100% não vira sugestão (o cenário não aceitaria ao salvar)", () => {
    expect(temSugestao(sugestao("OUTROS", { media: -500 }))).toBe(false);
    expect(temSugestao(sugestao("OUTROS", { media: 0 }))).toBe(true);
    const negativa = aplicarRealizado([linha("OUTROS", "Outros", "FIXO", 3)], [sugestao("OUTROS", { media: -500 })], "MEDIA");
    expect(negativa.gastos[0].valores[0]).toBe(3);
    const acima = aplicarRealizado([linha("TRIBUTOS", "Tributos", "PERCENTUAL", 0.1)], [sugestao("TRIBUTOS", { percentualDaReceita: 1.4 })], "MEDIA");
    expect(acima.gruposAplicados).toEqual([]);
  });

  it("linha em % recebe o percentual da receita, não a média em reais; sem percentual não mexe", () => {
    const ok = aplicarRealizado([linha("TRIBUTOS", "Tributos", "PERCENTUAL", 0.1)], [sugestao("TRIBUTOS")], "MEDIA");
    expect(ok.gastos[0].valores.every((v) => v === 0.08)).toBe(true);
    const sem = aplicarRealizado([linha("TRIBUTOS", "Tributos", "PERCENTUAL", 0.1)], [sugestao("TRIBUTOS", { percentualDaReceita: null })], "MEDIA");
    expect(sem.gastos[0].valores.every((v) => v === 0.1)).toBe(true);
    expect(sem.gruposAplicados).toEqual([]);
  });

  it("só a primeira linha do grupo é alterada", () => {
    const r = aplicarRealizado([linha("OUTROS", "Marketing", "FIXO", 5), linha("OUTROS", "Diversos", "FIXO", 7)], [sugestao("OUTROS")], "MEDIA");
    expect(r.gastos[0].valores[0]).toBe(150);
    expect(r.gastos[1].valores[0]).toBe(7);
  });

  it("grupo sem linha ganha uma linha nova com nome livre; tributos nasce em %", () => {
    const r = aplicarRealizado([linha("OUTROS", "Folha de pagamento")], [sugestao("FOLHA"), sugestao("TRIBUTOS")], "MEDIA");
    expect(r.gastos.map((g) => g.nome)).toEqual(["Folha de pagamento", "Folha de pagamento (2)", "Tributos"]);
    expect(r.gastos[2].modo).toBe("PERCENTUAL");
    expect(r.gastos[2].valores[0]).toBe(0.08);
  });

  it("sugestão sem média não cria nem altera nada, e não muda a lista original", () => {
    const original = [linha("OCUPACAO", "Ocupação", "FIXO", 9)];
    const r = aplicarRealizado(original, [sugestao("OCUPACAO", { media: null }), sugestao("SEGUROS", { media: null, origemNoDre: false })], "MEDIA");
    expect(r.gastos).toEqual(original);
    expect(r.gruposAplicados).toEqual([]);
    aplicarRealizado(original, [sugestao("OCUPACAO")], "MEDIA");
    expect(original[0].valores[0]).toBe(9);
  });
});
