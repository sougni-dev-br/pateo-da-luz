import { describe, expect, test } from "vitest";
import { aplicarOrdem } from "../ordenacao";

type Linha = { nome: string; gorjeta: number | null; funcao: string | null };

const lista: Linha[] = [
  { nome: "Élio", gorjeta: 745.32, funcao: "Pia 2" },
  { nome: "ana", gorjeta: null, funcao: "Adm" },
  { nome: "Bruno", gorjeta: 1863.3, funcao: null },
  { nome: "Carla", gorjeta: 745.32, funcao: "Pia 10" },
];
const ex = { nome: (l: Linha) => l.nome, gorjeta: (l: Linha) => l.gorjeta, funcao: (l: Linha) => l.funcao };
const nomes = (l: Linha[]) => l.map((x) => x.nome);

describe("aplicarOrdem", () => {
  test("sem ordem devolve a lista como veio", () => {
    expect(nomes(aplicarOrdem(lista, null, ex))).toEqual(["Élio", "ana", "Bruno", "Carla"]);
  });

  test("texto ignora caixa e acento", () => {
    expect(nomes(aplicarOrdem(lista, { coluna: "nome", direcao: "asc" }, ex))).toEqual(["ana", "Bruno", "Carla", "Élio"]);
  });

  test("número decrescente com empate estável e vazio no fim", () => {
    expect(nomes(aplicarOrdem(lista, { coluna: "gorjeta", direcao: "desc" }, ex))).toEqual(["Bruno", "Élio", "Carla", "ana"]);
  });

  test("vazio fica no fim também em ordem crescente", () => {
    expect(nomes(aplicarOrdem(lista, { coluna: "gorjeta", direcao: "asc" }, ex))).toEqual(["Élio", "Carla", "Bruno", "ana"]);
  });

  test("texto com número ordena como gente: Pia 2 antes de Pia 10", () => {
    expect(nomes(aplicarOrdem(lista, { coluna: "funcao", direcao: "asc" }, ex))).toEqual(["ana", "Élio", "Carla", "Bruno"]);
  });

  test("coluna desconhecida não mexe na ordem", () => {
    expect(nomes(aplicarOrdem(lista, { coluna: "xyz", direcao: "asc" }, ex))).toEqual(["Élio", "ana", "Bruno", "Carla"]);
  });
});
