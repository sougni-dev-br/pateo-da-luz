import { describe, expect, test } from "vitest";
import {
  agruparPendencias,
  descreverPendencia,
  nomeDaChave,
  GRUPOS_DO_FECHAMENTO
} from "../fechamento-apresentacao";

describe("descreverPendencia", () => {
  test("separa título e detalhe no primeiro dois-pontos", () => {
    const d = descreverPendencia("card:c1", "Cartão Visa (final 1234): fatura não conferida com o extrato");
    expect(d.titulo).toBe("Cartão Visa (final 1234)");
    expect(d.detalhe).toBe("fatura não conferida com o extrato");
  });

  test("fornecedor: o nome é o título, não a palavra 'Fornecedor'", () => {
    const d = descreverPendencia("supplier:s1", "Fornecedor: Condomínio do Shopping");
    expect(d.titulo).toBe("Condomínio do Shopping");
    expect(d.detalhe).toMatch(/sem lançamento/);
  });

  test("lançamento obrigatório do fornecedor: título com o nome do lançamento", () => {
    const d = descreverPendencia("supplier:s1:r2", "Fornecedor: Condomínio do Shopping — Parcelamento de dívida");
    expect(d.titulo).toBe("Condomínio do Shopping — Parcelamento de dívida");
    expect(d.detalhe).toMatch(/lançamento obrigatório/i);
  });

  test("sem dois-pontos, separa no travessão", () => {
    const d = descreverPendencia(
      "block:purchasesWithoutItems",
      "3 compra(s) sem itens, somando R$ 10,00 — nao entram no CMV (Hortifruti)"
    );
    expect(d.titulo).toBe("3 compra(s) sem itens, somando R$ 10,00");
    expect(d.detalhe).toBe("nao entram no CMV (Hortifruti)");
  });

  test("texto curto sem separador vira só título", () => {
    const d = descreverPendencia("block:finalInventory", "Inventario final do mes ausente");
    expect(d.titulo).toBe("Inventario final do mes ausente");
    expect(d.detalhe).toBe("");
  });

  test("dois-pontos distante demais não é título", () => {
    const longo = `${"palavra ".repeat(15)}: resto`;
    expect(descreverPendencia("block:x", longo).detalhe).toBe("");
  });

  test("o travessão vem antes do dois-pontos: vale o travessão", () => {
    const d = descreverPendencia("block:y", "Fatura aberta — veja: detalhes");
    expect(d.titulo).toBe("Fatura aberta");
    expect(d.detalhe).toBe("veja: detalhes");
  });
});

describe("grupos", () => {
  const grupoDe = (key: string) => descreverPendencia(key, "x").grupo;

  test("cada chave cai na área certa", () => {
    expect(grupoDe("card:abc")).toBe("Cartões de crédito");
    expect(grupoDe("delivery:KEETA")).toBe("Faturamento");
    expect(grupoDe("block:eventRevenue")).toBe("Faturamento");
    expect(grupoDe("block:revenue")).toBe("Faturamento");
    expect(grupoDe("block:payrollNotLaunched")).toBe("Pessoal");
    expect(grupoDe("block:tipsNotClosed")).toBe("Pessoal");
    expect(grupoDe("block:taxes")).toBe("Impostos");
    expect(grupoDe("block:finalInventory")).toBe("Estoque");
    expect(grupoDe("supplier:1")).toBe("Fornecedores obrigatórios");
  });

  test("chave desconhecida vai para Outros, nunca some", () => {
    expect(grupoDe("block:novaCoisa")).toBe("Outros");
  });
});

describe("nomeDaChave", () => {
  test("chaves fixas têm nome curto", () => {
    expect(nomeDaChave("block:eventRevenue")).toBe("Eventos / empreitada");
    expect(nomeDaChave("delivery:KEETA")).toBe("Delivery Keeta");
  });

  test("cartão e fornecedor dependem de cadastro: quem chama resolve", () => {
    expect(nomeDaChave("card:c1")).toBeNull();
    expect(nomeDaChave("supplier:s1")).toBeNull();
  });

  test("chave desconhecida mostra a própria chave, nunca vazio", () => {
    expect(nomeDaChave("block:novaCoisa")).toBe("block:novaCoisa");
  });
});

describe("agruparPendencias", () => {
  const itens = [
    { key: "block:finalInventory", label: "Inventario final do mes ausente" },
    { key: "card:c1", label: "Cartão A: sem fatura" },
    { key: "delivery:IFOOD", label: "Delivery iFood: nenhum faturamento" },
    { key: "card:c2", label: "Cartão B: sem fatura" }
  ];

  test("agrupa na ordem fixa das áreas, mantendo a ordem dentro de cada uma", () => {
    const grupos = agruparPendencias(itens);
    expect(grupos.map((g) => g.grupo)).toEqual(["Faturamento", "Cartões de crédito", "Estoque"]);
    expect(grupos[1].itens.map((i) => i.key)).toEqual(["card:c1", "card:c2"]);
  });

  test("não inventa grupo vazio", () => {
    expect(agruparPendencias([])).toEqual([]);
  });

  test("todas as áreas conhecidas estão na ordem de exibição", () => {
    expect(GRUPOS_DO_FECHAMENTO).toContain("Outros");
    expect(GRUPOS_DO_FECHAMENTO[GRUPOS_DO_FECHAMENTO.length - 1]).toBe("Outros");
  });
});
