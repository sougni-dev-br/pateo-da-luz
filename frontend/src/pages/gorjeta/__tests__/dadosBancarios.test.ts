import { expect, test } from "vitest";
import { linhasDadosBancarios } from "../dadosBancarios";

// Dados fictícios.
test("PIX com o tipo da chave e a conta, cada um numa linha", () => {
  expect(linhasDadosBancarios({ pix: "fulana@exemplo.com", pixTipo: "EMAIL", contaBancaria: "Banco Fictício · Ag. 0001 · C/C 123-4" }))
    .toEqual(["PIX (e-mail): fulana@exemplo.com", "Banco Fictício · Ag. 0001 · C/C 123-4"]);
});

test("PIX sem tipo e conta ausente", () => {
  expect(linhasDadosBancarios({ pix: "11999990000", pixTipo: null, contaBancaria: null })).toEqual(["PIX: 11999990000"]);
});

test("sem nada no cadastro: lista vazia", () => {
  expect(linhasDadosBancarios({ pix: "  ", pixTipo: "CPF", contaBancaria: undefined })).toEqual([]);
});
