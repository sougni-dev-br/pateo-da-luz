import { describe, expect, test } from "vitest";
import { filtroDaUrl } from "../regras";

describe("filtroDaUrl (link da tela de Impostos para Contas a Pagar)", () => {
  test("lê busca, intervalo de vencimento e aba", () => {
    expect(filtroDaUrl("?busca=07.20.26290.7165263-2&de=2026-10-01&ate=2026-10-31&aba=todos")).toEqual({
      titulo: null,
      abrirBaixa: false,
      origem: null,
      busca: "07.20.26290.7165263-2",
      aba: "all",
      periodo: { startDate: "2026-10-01", endDate: "2026-10-31" },
    });
  });

  test("sem parâmetros não muda nada: aba e período ficam como sempre", () => {
    expect(filtroDaUrl("")).toEqual({ titulo: null, abrirBaixa: false, origem: null, busca: "", aba: null, periodo: null });
    expect(filtroDaUrl("?noDueDate=1")).toEqual({ titulo: null, abrirBaixa: false, origem: null, busca: "", aba: null, periodo: null });
  });

  test("lê o título a abrir, o pedido de baixa e a origem (caminho de volta)", () => {
    const f = filtroDaUrl("?titulo=abc123&abrir=baixa&origem=impostos");
    expect(f).toMatchObject({ titulo: "abc123", abrirBaixa: true, origem: "impostos" });
  });

  test("origem desconhecida e abrir diferente de baixa são ignorados", () => {
    expect(filtroDaUrl("?origem=outra&abrir=sim")).toMatchObject({ origem: null, abrirBaixa: false });
  });

  test.each([
    ["datas inválidas", "?de=ontem&ate=hoje"],
    ["intervalo invertido", "?de=2026-10-31&ate=2026-10-01"],
    ["só uma ponta", "?de=2026-10-01"],
  ])("ignora o período com %s", (_n, query) => {
    expect(filtroDaUrl(query).periodo).toBeNull();
  });

  test("aceita as outras abas e ignora as desconhecidas", () => {
    expect(filtroDaUrl("?aba=pagos").aba).toBe("paid");
    expect(filtroDaUrl("?aba=abertos").aba).toBe("open");
    expect(filtroDaUrl("?aba=qualquer").aba).toBeNull();
  });

  test("limita o tamanho da busca", () => {
    expect(filtroDaUrl(`?busca=${"a".repeat(200)}`).busca).toHaveLength(80);
  });
});
