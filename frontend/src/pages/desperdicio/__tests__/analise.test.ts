import { describe, expect, test } from "vitest";
import type { WasteAnalysis, WasteAnalysisGroup, WasteAnalysisProduct, WasteEntry } from "../../../api/client";
import { PERIODOS_PRONTOS, csvDosLancamentos, intervaloDoPeriodo, lerPeriodo, periodoProntoDe, serieDoGrafico, variacao } from "../analise";

const grupo = (parcial: Partial<WasteAnalysisGroup> & { chave: string; nome: string }): WasteAnalysisGroup => ({
  lancamentos: 1, valor: 10, semCusto: 0, anteriorLancamentos: 0, anteriorValor: 0, ...parcial,
});

const produto = (parcial: Partial<WasteAnalysisProduct> & { chave: string; nome: string }): WasteAnalysisProduct => ({
  ...grupo(parcial), dias: 1, quantidade: 1, unidade: "KG", motivoPrincipal: "SPOILED", motivoPrincipalRotulo: "Estragado", comprado: null, taxaDePerda: null, ...parcial,
});

function analise(parcial: Partial<WasteAnalysis> = {}): WasteAnalysis {
  return {
    periodo: { from: "2026-10-01", to: "2026-10-14", dias: 14 },
    total: { lancamentos: 10, valor: 100, semCusto: 0 },
    anterior: { from: "2026-09-17", to: "2026-09-30", lancamentos: 10, valor: 100 },
    faturamento: null,
    porDia: [],
    porDiaDaSemana: [],
    porMotivo: [grupo({ chave: "SPOILED", nome: "Estragado", lancamentos: 4, valor: 30 }), grupo({ chave: "EXPIRED", nome: "Vencido", lancamentos: 6, valor: 70 })].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)),
    porSetor: [],
    porProduto: [],
    produtosTotal: 0,
    itensPara80: null,
    reincidentes: [],
    porPessoa: [],
    qualidade: { semCusto: 0, motivoOutro: 0, retroativos: 0, semFotoNosMaiores: 0, fichasPendentes: { pratos: 0, lancamentos: 0 }, diasSemRegistro: null, diasComVenda: null },
    ...parcial,
  };
}

describe("períodos prontos", () => {
  // 2026-10-14 é quarta-feira.
  const hoje = "2026-10-14";

  test.each([
    ["HOJE", "2026-10-14", "2026-10-14"],
    ["7D", "2026-10-08", "2026-10-14"],
    ["30D", "2026-09-15", "2026-10-14"],
    ["MES", "2026-10-01", "2026-10-14"],
    ["MES_ANTERIOR", "2026-09-01", "2026-09-30"],
  ] as const)("%s", (periodo, de, ate) => {
    expect(intervaloDoPeriodo(periodo, hoje)).toEqual({ de, ate });
  });

  test("mês passado em janeiro volta para dezembro do ano anterior", () => {
    expect(intervaloDoPeriodo("MES_ANTERIOR", "2026-01-10")).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
  });

  test("mês passado respeita ano bissexto", () => {
    expect(intervaloDoPeriodo("MES_ANTERIOR", "2024-03-05")).toEqual({ de: "2024-02-01", ate: "2024-02-29" });
  });

  test("reconhece qual atalho está ativo e nenhum quando o intervalo é outro", () => {
    expect(periodoProntoDe("2026-10-08", "2026-10-14", hoje)).toBe("7D");
    expect(periodoProntoDe("2026-10-02", "2026-10-14", hoje)).toBeNull();
    expect(PERIODOS_PRONTOS).toHaveLength(5);
  });
});

describe("variacao", () => {
  test("sobe, desce e fica igual", () => {
    expect(variacao(150, 100)).toEqual({ tipo: "SOBE", percentual: 50, diferenca: 50 });
    expect(variacao(75, 100)).toEqual({ tipo: "DESCE", percentual: 25, diferenca: -25 });
    expect(variacao(100, 100)).toEqual({ tipo: "IGUAL" });
  });

  test("sem base não inventa percentual", () => {
    expect(variacao(100, 0)).toEqual({ tipo: "SEM_BASE" });
    expect(variacao(100, null)).toEqual({ tipo: "SEM_BASE" });
    expect(variacao(null, 100)).toEqual({ tipo: "SEM_BASE" });
  });
});

describe("lerPeriodo: o que fazer", () => {
  test("período sem lançamento não tem leitura", () => {
    expect(lerPeriodo(analise({ total: { lancamentos: 0, valor: 0, semCusto: 0 } }), true)).toEqual([]);
  });

  test("alta relevante vira alerta e aponta quem mais cresceu", () => {
    const r = lerPeriodo(analise({
      total: { lancamentos: 12, valor: 200, semCusto: 0 },
      porMotivo: [grupo({ chave: "EXPIRED", nome: "Vencido", lancamentos: 5, valor: 150, anteriorValor: 40 }), grupo({ chave: "SPOILED", nome: "Estragado", lancamentos: 7, valor: 50, anteriorValor: 60 })],
    }), true);
    expect(r[0]).toMatchObject({ id: "alta", tom: "danger" });
    expect(r[0].titulo).toContain("100%");
    expect(r[0].detalhe).toContain("Vencido");
  });

  test("variação pequena em reais não alarma, mesmo sendo grande em percentual", () => {
    const r = lerPeriodo(analise({ total: { lancamentos: 3, valor: 30, semCusto: 0 }, anterior: { from: "", to: "", lancamentos: 1, valor: 10 }, porMotivo: [] }), true);
    expect(r.find((l) => l.id === "alta")).toBeUndefined();
  });

  test("queda relevante é registrada como boa notícia", () => {
    const r = lerPeriodo(analise({ total: { lancamentos: 5, valor: 50, semCusto: 0 }, porMotivo: [] }), true);
    expect(r.find((l) => l.id === "queda")).toMatchObject({ tom: "ok" });
  });

  test("motivo dominante traz o passo prático do motivo e filtra a lista", () => {
    const r = lerPeriodo(analise(), true);
    const motivo = r.find((l) => l.id === "motivo");
    expect(motivo?.titulo).toContain("Vencido responde por 70% do valor");
    expect(motivo?.acao).toMatch(/PVPS/);
    expect(motivo?.filtro).toEqual({ tipo: "motivo", valor: "EXPIRED" });
  });

  test("sem permissão de custo a leitura usa contagem e nunca cita reais", () => {
    const r = lerPeriodo(analise({
      total: { lancamentos: 10, valor: null, semCusto: 0 },
      anterior: { from: "", to: "", lancamentos: 4, valor: null },
      porMotivo: [grupo({ chave: "EXPIRED", nome: "Vencido", lancamentos: 7, valor: null, anteriorLancamentos: 1, anteriorValor: null })],
    }), false);
    expect(r.find((l) => l.id === "alta")?.titulo).toContain("150%");
    expect(r.find((l) => l.id === "motivo")?.titulo).toContain("dos lançamentos");
    expect(JSON.stringify(r)).not.toMatch(/R\$/);
  });

  test("item perdido em vários dias é reincidente, e aponta o processo", () => {
    const r = lerPeriodo(analise({ reincidentes: [produto({ chave: "p1", nome: "Tomate", dias: 5, lancamentos: 6, valor: 60, motivoPrincipal: "SPOILED", motivoPrincipalRotulo: "Estragado" })] }), true);
    const l = r.find((x) => x.id === "reincidente");
    expect(l?.titulo).toContain("Tomate foi perdido em 5 dias diferentes");
    expect(l?.filtro).toEqual({ tipo: "item", valor: "p1", rotulo: "Tomate" });
  });

  test("item que perdeu 10% ou mais do que comprou vira alerta, com a conta à vista", () => {
    const r = lerPeriodo(analise({ porProduto: [produto({ chave: "p1", nome: "Salmão", lancamentos: 4, quantidade: 12, unidade: "KG", comprado: 80, taxaDePerda: 15 })] }), true);
    const l = r.find((x) => x.id === "taxa-de-perda");
    expect(l?.titulo).toBe("Salmão perdeu 15% do que foi comprado no período");
    expect(l?.detalhe).toBe("12 KG perdidos de 80 KG comprados.");
    expect(l?.filtro).toEqual({ tipo: "item", valor: "p1", rotulo: "Salmão" });
  });

  test("taxa baixa, ou poucos lançamentos, não alarma", () => {
    expect(lerPeriodo(analise({ porProduto: [produto({ chave: "p1", nome: "A", lancamentos: 4, taxaDePerda: 4, comprado: 100 })] }), true).find((l) => l.id === "taxa-de-perda")).toBeUndefined();
    expect(lerPeriodo(analise({ porProduto: [produto({ chave: "p1", nome: "A", lancamentos: 1, taxaDePerda: 40, comprado: 5 })] }), true).find((l) => l.id === "taxa-de-perda")).toBeUndefined();
  });

  test("pratos aguardando ficha viram alerta específico, com o primeiro passo", () => {
    const base = analise().qualidade;
    const r = lerPeriodo(analise({ qualidade: { ...base, semCusto: 4, fichasPendentes: { pratos: 2, lancamentos: 4 } } }), true);
    const l = r.find((x) => x.id === "fichas-pendentes");
    expect(l?.titulo).toBe("2 pratos aguardam ficha técnica e deixam 4 lançamentos sem valor");
    expect(l?.acao).toMatch(/Aguardando ficha/);
    // O "sem custo" genérico não repete o que a pendência já explica.
    expect(r.find((x) => x.id === "sem-custo")).toBeUndefined();
  });

  test("um prato com um lançamento fala no singular", () => {
    const base = analise().qualidade;
    const l = lerPeriodo(analise({ qualidade: { ...base, fichasPendentes: { pratos: 1, lancamentos: 1 } } }), true).find((x) => x.id === "fichas-pendentes");
    expect(l?.titulo).toBe("1 prato aguarda ficha técnica e deixa 1 lançamento sem valor");
  });

  test("sem custo além dos pratos pendentes continua aparecendo, só com o que sobra", () => {
    const base = analise().qualidade;
    const r = lerPeriodo(analise({ qualidade: { ...base, semCusto: 9, fichasPendentes: { pratos: 1, lancamentos: 3 } } }), true);
    expect(r.find((x) => x.id === "sem-custo")?.titulo).toBe("6 lançamentos estão sem custo e não entram no valor");
  });

  test("quem não vê custos não recebe o aviso de ficha", () => {
    const base = analise().qualidade;
    expect(lerPeriodo(analise({ qualidade: { ...base, fichasPendentes: { pratos: 2, lancamentos: 4 } } }), false).find((x) => x.id === "fichas-pendentes")).toBeUndefined();
  });

  test("poucos itens concentrando 80% do valor", () => {
    const r = lerPeriodo(analise({ itensPara80: 2, produtosTotal: 12, porProduto: [produto({ chave: "a", nome: "Salmão" }), produto({ chave: "b", nome: "Camarão" })] }), true);
    expect(r.find((l) => l.id === "concentracao")?.titulo).toBe("2 de 12 itens concentram 80% do valor perdido");
  });

  test("dia da semana que pesa muito mais que a média", () => {
    const semana = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome, i) => ({ diaDaSemana: i, nome, lancamentos: nome === "Sexta" ? 6 : 1, valor: nome === "Sexta" ? 240 : 10, ocorrencias: 2 }));
    const r = lerPeriodo(analise({ total: { lancamentos: 10, valor: 300, semCusto: 0 }, porDiaDaSemana: semana }), true);
    const l = r.find((x) => x.id === "dia-da-semana");
    expect(l?.titulo).toMatch(/^Sexta perde/);
  });

  test("dias com venda e sem registro viram aviso de dado incompleto", () => {
    const r = lerPeriodo(analise({ qualidade: { semCusto: 0, motivoOutro: 0, retroativos: 0, semFotoNosMaiores: 0, fichasPendentes: { pratos: 0, lancamentos: 0 }, diasSemRegistro: 5, diasComVenda: 10 } }), true);
    expect(r.find((l) => l.id === "dias-sem-registro")).toMatchObject({ tom: "warn" });
  });

  test("poucos dias de venda não bastam para concluir que falta registro", () => {
    const r = lerPeriodo(analise({ qualidade: { semCusto: 0, motivoOutro: 0, retroativos: 0, semFotoNosMaiores: 0, fichasPendentes: { pratos: 0, lancamentos: 0 }, diasSemRegistro: 3, diasComVenda: 4 } }), true);
    expect(r.find((l) => l.id === "dias-sem-registro")).toBeUndefined();
  });

  test("ordena por gravidade e limita a seis", () => {
    const r = lerPeriodo(analise({
      total: { lancamentos: 20, valor: 400, semCusto: 4 },
      porMotivo: [grupo({ chave: "OTHER", nome: "Outro", lancamentos: 10, valor: 300, anteriorValor: 20 })],
      reincidentes: [produto({ chave: "p1", nome: "Pão", dias: 4 })],
      itensPara80: 1, produtosTotal: 8, porProduto: [produto({ chave: "p1", nome: "Pão" })],
      qualidade: { semCusto: 4, motivoOutro: 10, retroativos: 8, semFotoNosMaiores: 5, fichasPendentes: { pratos: 0, lancamentos: 0 }, diasSemRegistro: 5, diasComVenda: 10 },
    }), true);
    expect(r.length).toBeLessThanOrEqual(6);
    const tons = r.map((l) => l.tom);
    expect(tons).toEqual([...tons].sort((a, b) => ["danger", "warn", "info", "ok"].indexOf(a) - ["danger", "warn", "info", "ok"].indexOf(b)));
    expect(r[0].tom).toBe("danger");
  });
});

describe("csvDosLancamentos", () => {
  const item = (parcial: Partial<WasteEntry> = {}): WasteEntry => ({
    id: "1", kind: "INSUMO", productId: "p", dishId: null, productName: "Arroz", productCode: "364", quantity: 0.1, unit: "UN",
    enteredQuantity: 500, enteredUnit: "G", reason: "EXPIRED", reasonLabel: "Vencido", occurredOn: "2026-10-13", sectorName: "ESTOQUE",
    notes: null, createdAt: "2026-10-13T12:00:00Z", cancelledAt: null, cancelReason: null, hasPhoto: false, hasCost: true, registeredById: "u", totalCost: 2.5,
    ...parcial,
  });

  test("BOM, separador ponto e vírgula, vírgula decimal e data em pt-BR", () => {
    const csv = csvDosLancamentos([item()], true);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cabecalho, linha] = csv.trim().split("\r\n");
    expect(cabecalho).toContain("Valor (R$)");
    expect(linha).toBe("13/10/2026;Arroz;364;ESTOQUE;500;G;0,1;UN;Vencido;2,5;;Ativo");
  });

  test("sem permissão de custo não há coluna de valor", () => {
    const csv = csvDosLancamentos([item({ totalCost: undefined })], false);
    expect(csv).not.toContain("Valor");
    expect(csv).not.toContain("2,5");
  });

  test("texto que começa como fórmula é neutralizado e aspas são escapadas", () => {
    const csv = csvDosLancamentos([item({ productName: "=HYPERLINK(\"x\")", notes: "disse \"oi\"; tchau" })], true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"disse \"\"oi\"\"; tchau\"");
  });

  test("lançamento cancelado diz o motivo", () => {
    const csv = csvDosLancamentos([item({ cancelledAt: "2026-10-14T00:00:00Z", cancelReason: "digitei errado" })], true);
    expect(csv).toContain("Cancelado: digitei errado");
  });
});

describe("serieDoGrafico", () => {
  const dias = (n: number, valor: number | null = 10) => Array.from({ length: n }, (_, i) => ({ dia: `2026-01-${String(i + 1).padStart(2, "0")}`, lancamentos: 1, valor }));

  test("até 62 dias: uma barra por dia", () => {
    const r = serieDoGrafico(dias(30));
    expect(r.porSemana).toBe(false);
    expect(r.barras).toHaveLength(30);
    expect(r.barras[0]).toMatchObject({ inicio: "2026-01-01", fim: "2026-01-01", valor: 10 });
  });

  test("período longo agrupa em semanas e soma cada bloco", () => {
    const longo = Array.from({ length: 100 }, (_, i) => ({ dia: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), lancamentos: 1, valor: 5 }));
    const r = serieDoGrafico(longo);
    expect(r.porSemana).toBe(true);
    expect(r.barras).toHaveLength(15);
    expect(r.barras[0]).toMatchObject({ lancamentos: 7, valor: 35 });
    // 100 dias = 14 semanas cheias + 2 dias: a última barra é parcial e não perde nada.
    expect(r.barras[14]).toMatchObject({ lancamentos: 2, valor: 10 });
    expect(r.barras.reduce((s, b) => s + b.lancamentos, 0)).toBe(100);
  });

  test("sem permissão de custo as barras seguem em contagem", () => {
    expect(serieDoGrafico(dias(5, null)).barras.every((b) => b.valor === null)).toBe(true);
  });
});
