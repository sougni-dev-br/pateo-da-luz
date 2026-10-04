import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { FichaCadastralDetalhe } from "../../../../api/client";
import { FichaImpressao } from "../FichaImpressao";

// Pessoa e empresa fictícias.
const ficha = {
  id: "f1", tipo: "ADMISSAO", status: "FINALIZADA", dados: { nomeCompleto: "Joana Exemplo" }, arquivos: [],
  empresas: [{ id: "c1", tradeName: "Empresa Exemplo", legalName: "Empresa Exemplo Ltda", cnpj: "00000000000191" }],
  opcoes: { tiposArquivo: {}, rotulos: {} },
} as unknown as FichaCadastralDetalhe;

// O formato de moeda usa espaço não separável depois do "R$".
const textoImpresso = () => (document.body.textContent ?? "").replace(/ /g, " ");

describe("ficha impressa", () => {
  test("salário e VT digitados pelo RH ('1.500,00') saem em reais, não 'R$ NaN'", () => {
    render(<FichaImpressao ficha={ficha} empresa={{ companyId: "c1", salario: "1.500,00" as never, valorVt: "250" as never }} />);
    expect(textoImpresso()).toContain("R$ 1.500,00");
    expect(textoImpresso()).toContain("R$ 250,00");
    expect(textoImpresso()).not.toContain("NaN");
  });

  test("valor que veio do servidor (número) e vazio", () => {
    render(<FichaImpressao ficha={ficha} empresa={{ salario: 2500, valorVt: null }} />);
    expect(textoImpresso()).toContain("R$ 2.500,00");
    expect(textoImpresso()).not.toContain("NaN");
  });
});
