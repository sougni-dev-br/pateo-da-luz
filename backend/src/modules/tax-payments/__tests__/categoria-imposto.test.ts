import { describe, expect, test } from "vitest";
import { categoriaIdPorNome, sugerirCategoriaImposto } from "../categoria-imposto.js";

describe("categoria do DRE sugerida pelo tipo da guia", () => {
  test.each([
    ["FGTS", null, "FGTS"],
    ["GPS", null, "INSS"],
    ["GPS / INSS", null, "INSS"],
    ["PRECIDENCIA SOCIAL", null, "INSS"],
    ["Simples Nacional / DAS", null, "Simples Nacional"],
    ["SIMPLES NACIONAL - DASN", "IRPJ - CSLL - COFINS - PIS - INSS - ICMS", "Simples Nacional"],
    ["DASN", null, "Simples Nacional"],
    ["DARE", null, "GARE / ICMS"],
    ["DARE-SP", null, "GARE / ICMS"],
    ["GARE ICMS", null, "GARE / ICMS"],
    ["TFE", "Taxa de Fiscalização de Estabelecimentos (Municipal)", "Taxas Municipais"],
    ["IPTU", null, "IPTU"],
    ["DARF", null, "IRRF / DARF"],
    ["DARF IR", null, "IRRF / DARF"],
    ["IRRF", null, "IRRF / DARF"],
  ])("%s → %s", (tipo, descricao, esperado) => {
    expect(sugerirCategoriaImposto(tipo, descricao)).toBe(esperado);
  });

  test("parcelamento vence o tipo da guia, mesmo sendo um DAS", () => {
    expect(sugerirCategoriaImposto("SIMPLES NACIONAL - DASN", "PARCELAMENTO SIMPLES NACIONAL")).toBe("Parcelamentos Tributarios");
    expect(sugerirCategoriaImposto("Parcelamento Tributário", null)).toBe("Parcelamentos Tributarios");
    expect(sugerirCategoriaImposto("SIMPLES NACIONAL - DASN", "REC. DIV ATIVA - R D ATIVA")).toBe("Parcelamentos Tributarios");
    expect(sugerirCategoriaImposto("SIMPLES NACIONAL - DASN", "REC. DIVIDA ATIVA")).toBe("Parcelamentos Tributarios");
  });

  test("GPS de parcelamento continua em INSS", () => {
    expect(sugerirCategoriaImposto("GPS", "PARCELAMENTO: 000000000")).toBe("INSS");
  });

  test("DARF da Receita só com contribuição previdenciária vai para INSS", () => {
    expect(sugerirCategoriaImposto("RECEITA FEDERAL", "CONTR PREV DESCONTA SEGURADO")).toBe("INSS");
    expect(sugerirCategoriaImposto("RECEITA FEDERAL", "CP SEGURADOS")).toBe("INSS");
  });

  test("DARF da Receita que tem imposto de renda vai para IRRF / DARF, mesmo com INSS junto", () => {
    expect(sugerirCategoriaImposto("RECEITA FEDERAL", "CONTR PREV - IRRF - RENDIMENTO TRABALHO ASSALARIADO")).toBe("IRRF / DARF");
    expect(sugerirCategoriaImposto("RECEITA FEDERAL", "IMPOSTO SOBRE RENDA DA PESSOA FISICA")).toBe("IRRF / DARF");
    expect(sugerirCategoriaImposto("DARF - RECEITA FEDERAL", null)).toBe("IRRF / DARF");
  });

  test("multa da DASN paga em DARF não vira Simples", () => {
    expect(sugerirCategoriaImposto("RECEITA FEDERAL", "MULTA POR ATRASO NA ENTREGA DA DASN - SIMEI")).toBe("IRRF / DARF");
  });

  test("ISS e tipos desconhecidos ficam sem sugestão", () => {
    expect(sugerirCategoriaImposto("ISS", null)).toBeNull();
    expect(sugerirCategoriaImposto("GARE ISS", null)).toBeNull();
    expect(sugerirCategoriaImposto("Outros", "qualquer coisa")).toBeNull();
    expect(sugerirCategoriaImposto("", null)).toBeNull();
  });

  test("ignora caixa e acento", () => {
    expect(sugerirCategoriaImposto("fgts", null)).toBe("FGTS");
    expect(sugerirCategoriaImposto("Previdência Social", null)).toBe("INSS");
  });
});

describe("categoria pelo nome", () => {
  const categorias = [
    { id: "c1", name: "Parcelamentos Tributários" },
    { id: "c2", name: "FGTS" },
    { id: "c3", name: "IRRF / DARF" },
  ];

  test("acha ignorando acento e caixa", () => {
    expect(categoriaIdPorNome(categorias, "Parcelamentos Tributarios")).toBe("c1");
    expect(categoriaIdPorNome(categorias, "fgts")).toBe("c2");
  });

  test("sem nome ou categoria inexistente devolve null", () => {
    expect(categoriaIdPorNome(categorias, null)).toBeNull();
    expect(categoriaIdPorNome(categorias, "INSS")).toBeNull();
  });
});
