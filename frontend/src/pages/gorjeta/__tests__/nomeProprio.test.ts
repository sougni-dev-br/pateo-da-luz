import { expect, test } from "vitest";
import { nomeProprio } from "../NomePessoa";

test("nome todo em maiúsculas vira nome próprio, com partículas em minúsculas", () => {
  expect(nomeProprio("FULANA DOS SANTOS DE TAL")).toBe("Fulana dos Santos de Tal");
  expect(nomeProprio("JOÃO DA SILVA")).toBe("João da Silva");
});

test("nome já escrito como próprio fica como está", () => {
  expect(nomeProprio("Maria José de Tal")).toBe("Maria José de Tal");
  expect(nomeProprio("Ana McLaren")).toBe("Ana McLaren");
});
