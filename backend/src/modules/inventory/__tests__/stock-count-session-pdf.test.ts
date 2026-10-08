import { describe, expect, it } from "vitest";
import { buildRows, createStockCountSessionPdf } from "../stock-count-session-pdf.js";

const item = (productName: string, sectorName: string | null, categoryName: string | null, anterior: number | null = null, compras = 0) => ({
  productCode: null, productName, sectorName, categoryName, unit: "UN", anterior, compras, notes: null
});

function gerar(itens: ReturnType<typeof item>[]) {
  return createStockCountSessionPdf({
    systemName: "Pateo", sessionCode: "CNT-TESTE", sessionTypeLabel: "Setorial",
    referenceDateLabel: "07/09/2026", generatedAtLabel: "", totalItems: itens.length, items: itens
  }).toString("latin1");
}

describe("folha de contagem impressa", () => {
  it("agrupa por setor e categoria, na ordem da tela, com o total do setor", () => {
    const rows = buildRows([
      item("SUCO", "ESTOQUE", "BEBIDAS"),
      item("ARROZ", "ESTOQUE", "INSUMOS"),
      item("ACUCAR", "ESTOQUE", "INSUMOS"),
      item("SALMAO", "FREEZER", "PEIXES"),
      item("SEM LUGAR", null, null)
    ]);
    expect(rows.map((r) => (r.kind === "item" ? r.item.productName : r.kind === "sector" ? `# ${r.label} (${r.count})` : `- ${r.label}`))).toEqual([
      "# ESTOQUE (3)", "- BEBIDAS", "SUCO", "- INSUMOS", "ACUCAR", "ARROZ",
      "# FREEZER (1)", "- PEIXES", "SALMAO",
      "# SEM SETOR (1)", "- Sem categoria", "SEM LUGAR"
    ]);
  });

  it("traz a conta da tela: anterior + compras = esperado", () => {
    const texto = gerar([item("VINHO", "ADEGA", "VINHOS", 5, 2.5)]);
    expect(texto).toContain("(Anterior)");
    expect(texto).toContain("(= Esperado)");
    expect(texto).toContain("(2,5)");
    expect(texto).toContain("(7,5)");
  });

  it("produto sem contagem aprovada sai sem esperado", () => {
    const texto = gerar([item("NOVO", "ADEGA", "VINHOS", null, 3)]);
    expect(texto).not.toContain("(3)");
  });

  it("travessao, aspas curvas e emoji nao saem como caractere de controle", () => {
    const texto = gerar([{ ...item("VINHO – SAFRA “2024” 🍷", "ADEGA", "VINHOS"), notes: "caixa…" }]);
    expect(texto).toContain('VINHO - SAFRA "2024" ?');
    expect(texto).toContain("caixa...");
    expect(texto).not.toMatch(/\\0[0-3][0-7]/);
  });

  it("nome em caixa alta longo quebra em vez de invadir a coluna da unidade", () => {
    const nome = "VINHO TINTO SECO CABERNET SAUVIGNON RESERVA ESPECIAL 750ML";
    const texto = gerar([item(nome, "ADEGA", "VINHOS")]);
    expect(texto).not.toContain(`(${nome})`);
    expect(texto).toContain("(VINHO TINTO SECO CABERNET");
  });

  it("codigo longo sem espaco e quebrado por letra", () => {
    const texto = gerar([{ ...item("ARROZ", "ESTOQUE", "INSUMOS"), productCode: "ABCDEFGHIJKLMN" }]);
    expect(texto).not.toContain("(ABCDEFGHIJKLMN)");
  });

  it("gera um PDF valido com varias paginas e repete o grupo na quebra", () => {
    const itens = Array.from({ length: 120 }, (_, i) => item(`PRODUTO ${i}`, i < 60 ? "ESTOQUE" : "FREEZER", `CAT ${Math.floor(i / 25)}`, i, 1));
    const texto = gerar(itens);
    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(texto)?.[1])).toBeGreaterThan(1);
    expect(texto).toContain("continua\\347\\343o");
    expect(texto).toContain("120 produto\\(s\\)");
  });
});
