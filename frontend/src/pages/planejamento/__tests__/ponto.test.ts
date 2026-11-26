import { describe, expect, it } from "vitest";
import { comentarioFicticio } from "./fixturesComentarios";
import { agruparPorPonto, chaveDoPonto, contagemDoAno, grandezaDaMetrica, metricaDaGrandeza, rotuloDoPonto, textoDaContagem, turnoDaTela } from "../comentarios/ponto";

describe("ponto de comentário", () => {
  it("monta o rótulo com mês, métrica e turno", () => {
    expect(rotuloDoPonto({ mes: 10, metrica: "VENDAS", turno: "ALMOCO" }, 2026)).toBe("Out/2026 · Vendas · almoço");
    expect(rotuloDoPonto({ mes: null, metrica: "TICKET", turno: "TOTAL" }, 2026)).toBe("Ano inteiro · Ticket médio");
  });

  it("chave distingue ano inteiro de mês e turno", () => {
    expect(chaveDoPonto({ mes: null, metrica: "VENDAS", turno: "TOTAL" })).not.toBe(chaveDoPonto({ mes: 1, metrica: "VENDAS", turno: "TOTAL" }));
    expect(chaveDoPonto({ mes: 3, metrica: "VENDAS", turno: "JANTAR" })).toBe("3|VENDAS|JANTAR");
  });

  it("agrupa por ponto mantendo a ordem", () => {
    const lista = [comentarioFicticio({ id: "a" }), comentarioFicticio({ id: "b", turno: "JANTAR" }), comentarioFicticio({ id: "c" })];
    const mapa = agruparPorPonto(lista);
    expect(mapa.get("10|VENDAS|TOTAL")?.map((c) => c.id)).toEqual(["a", "c"]);
    expect(mapa.size).toBe(2);
  });

  it("separa o ano inteiro dos demais pontos com contagem", () => {
    const lista = [comentarioFicticio({ id: "a", mes: null }), comentarioFicticio({ id: "b" }), comentarioFicticio({ id: "c" }), comentarioFicticio({ id: "d", mes: 3, metrica: "CLIENTES" })];
    const { anoInteiro, outros } = contagemDoAno(lista);
    expect(anoInteiro.map((c) => c.id)).toEqual(["a"]);
    expect(outros.map((o) => o.quantidade)).toEqual([2, 1]);
  });

  it("converte grandeza e turno da tela", () => {
    expect(metricaDaGrandeza("ticket")).toBe("TICKET");
    expect(grandezaDaMetrica("CLIENTES")).toBe("clientes");
    expect(turnoDaTela("almoco")).toBe("ALMOCO");
  });

  it("concorda o plural", () => {
    expect(textoDaContagem(1)).toBe("1 comentário");
    expect(textoDaContagem(2)).toBe("2 comentários");
  });
});
