import { describe, expect, test } from "vitest";
import { classificarMeta, metaVigente, percentualDe, projetarMes, razaoParaPercentual, validarPercentuais, type MetaVigencia, classificarPedidos } from "../cmv-metas.logic.js";

const meta = (o: Partial<MetaVigencia>): MetaVigencia => ({
  id: "m", escopo: "GERAL", sectorId: null, alvoPercentual: 30, alertaPercentual: 27,
  vigenciaInicio: "2026-01-01", vigenciaFim: null, ...o,
});

describe("classificarMeta", () => {
  test("sem faturamento não há classificação", () => expect(classificarMeta(null, 30, 27)).toBe("SEM_DADOS"));
  test("abaixo do alerta é verde", () => expect(classificarMeta(26.9, 30, 27)).toBe("VERDE"));
  test("do alerta até a meta (inclusive) é amarelo", () => {
    expect(classificarMeta(27, 30, 27)).toBe("AMARELO");
    expect(classificarMeta(30, 30, 27)).toBe("AMARELO");
  });
  test("acima da meta é vermelho", () => expect(classificarMeta(30.01, 30, 27)).toBe("VERMELHO"));
});

describe("percentualDe", () => {
  test("calcula com 2 casas", () => expect(percentualDe(28, 100)).toBe(28));
  test("faturamento zero ou inválido devolve null", () => {
    expect(percentualDe(10, 0)).toBeNull();
    expect(percentualDe(10, Number.NaN)).toBeNull();
  });
});

describe("metaVigente", () => {
  const antiga = meta({ id: "a", alvoPercentual: 32, vigenciaInicio: "2026-01-01", vigenciaFim: "2026-06-30" });
  const nova = meta({ id: "b", alvoPercentual: 30, vigenciaInicio: "2026-07-01" });
  const setor = meta({ id: "c", escopo: "SETOR", sectorId: "s1", alvoPercentual: 12 });
  test("escolhe a vigência do dia", () => {
    expect(metaVigente([antiga, nova], "GERAL", null, "2026-03-15")?.id).toBe("a");
    expect(metaVigente([antiga, nova], "GERAL", null, "2026-11-01")?.id).toBe("b");
  });
  test("antes de qualquer vigência não há meta", () => expect(metaVigente([nova], "GERAL", null, "2026-01-10")).toBeNull());
  test("não mistura geral com setor nem setores diferentes", () => {
    expect(metaVigente([setor], "GERAL", null, "2026-11-01")).toBeNull();
    expect(metaVigente([setor], "SETOR", "s2", "2026-11-01")).toBeNull();
    expect(metaVigente([setor], "SETOR", "s1", "2026-11-01")?.id).toBe("c");
  });
});

describe("projetarMes", () => {
  test("projeta faturamento no ritmo e calcula a margem para comprar", () => {
    const p = projetarMes({ comprasAteHoje: 20000, pedidosAbertos: 5000, faturamentoAteHoje: 100000, diasDecorridos: 10, diasNoMes: 30, alvoPercentual: 30 });
    expect(p.faturamentoProjetado).toBe(300000);
    expect(p.comprasComprometidas).toBe(25000);
    expect(p.tetoDeCompras).toBe(90000);
    expect(p.margemParaComprar).toBe(65000);
    expect(p.percentualProjetado).toBe(8.33);
  });
  test("margem negativa quando já estourou o teto", () => {
    const p = projetarMes({ comprasAteHoje: 95000, pedidosAbertos: 0, faturamentoAteHoje: 100000, diasDecorridos: 10, diasNoMes: 30, alvoPercentual: 30 });
    expect(p.margemParaComprar).toBe(5000 - 10000);
  });
  test("sem faturamento não inventa projeção", () => {
    const p = projetarMes({ comprasAteHoje: 1000, pedidosAbertos: 0, faturamentoAteHoje: 0, diasDecorridos: 5, diasNoMes: 30, alvoPercentual: 30 });
    expect(p.faturamentoProjetado).toBeNull();
    expect(p.margemParaComprar).toBeNull();
    expect(p.comprasComprometidas).toBe(1000);
  });
});

describe("validarPercentuais", () => {
  test("aceita alerta menor ou igual à meta", () => expect(validarPercentuais(30, 27)).toBeNull());
  test("recusa alerta acima da meta, zero e acima de 100", () => {
    expect(validarPercentuais(30, 31)).not.toBeNull();
    expect(validarPercentuais(0, 0)).not.toBeNull();
    expect(validarPercentuais(101, 50)).not.toBeNull();
    expect(validarPercentuais(Number.NaN, 10)).not.toBeNull();
  });
});

describe("razaoParaPercentual", () => {
  test("o CMV do ciclo vem como razão e vira pontos percentuais", () => {
    expect(razaoParaPercentual(0.5871)).toBe(58.71);
    expect(razaoParaPercentual(0.7532)).toBe(75.32);
  });
});

describe("classificarPedidos", () => {
  const p = (codigo: string, status: string, referencia: string, totalCmv: number, faltaCmv: number) => ({ id: codigo, codigo, status, referencia, totalCmv, faltaCmv });
  const COMPROMETIDOS = ["EM_REVISAO", "APROVADO", "ENVIADO", "RECEBIDO_PARCIAL"];

  test("separa contados, parados e rascunhos pela janela, e ignora pedido sem CMV", () => {
    const r = classificarPedidos([
      p("PC-1", "RECEBIDO_PARCIAL", "2026-11-27", 500, 20),
      p("PC-2", "APROVADO", "2026-07-07", 50, 50),
      p("PC-3", "RASCUNHO", "2026-11-26", 1200, 1200),
      p("PC-4", "ENVIADO", "2026-11-20", 0, 0),
      p("PC-5", "ENVIADO", "2026-10-28", 300, 300),
    ], COMPROMETIDOS, "2026-10-28");
    expect(r.contados.map((x) => x.codigo)).toEqual(["PC-1", "PC-5"]);
    expect(r.parados.map((x) => x.codigo)).toEqual(["PC-2"]);
    expect(r.rascunhos.map((x) => x.codigo)).toEqual(["PC-3"]);
  });

  test("pedido já todo recebido não aparece como contado", () => {
    const r = classificarPedidos([p("PC-1", "RECEBIDO_PARCIAL", "2026-11-27", 500, 0)], COMPROMETIDOS, "2026-10-28");
    expect(r.contados).toEqual([]);
  });
});
