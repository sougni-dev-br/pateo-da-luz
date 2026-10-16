import { describe, expect, test } from "vitest";
import { suggestCategory } from "../sugestao-categoria.js";

describe("categoria sugerida pelo nome do fornecedor", () => {
  test("cada guia vai para o seu imposto, não tudo para Simples", () => {
    expect(suggestCategory("Simples Nacional")).toBe("Simples Nacional");
    expect(suggestCategory("Guia DAS mensal")).toBe("Simples Nacional");
    expect(suggestCategory("DARF Receita Federal")).toBe("IRRF / DARF");
    expect(suggestCategory("IRRF sobre serviço")).toBe("IRRF / DARF");
    expect(suggestCategory("GARE ICMS")).toBe("GARE / ICMS");
    expect(suggestCategory("ICMS ST")).toBe("GARE / ICMS");
  });

  test("ISS não tem categoria própria e fica sem sugestão", () => {
    expect(suggestCategory("ISS Prefeitura")).toBeNull();
  });

  test("encargos da folha continuam em Pessoal", () => {
    expect(suggestCategory("INSS patronal")).toBe("INSS");
    expect(suggestCategory("FGTS digital")).toBe("FGTS");
  });

  test("regras de outros fornecedores seguem iguais", () => {
    expect(suggestCategory("Enel Distribuição")).toBe("Energia Elétrica");
    expect(suggestCategory("Escritório de Contabilidade Exemplo")).toBe("Contador");
    expect(suggestCategory("Fornecedor Qualquer")).toBeNull();
  });
});
