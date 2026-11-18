import { describe, expect, test } from "vitest";
import { aparecemNaEquipe } from "../equipeVisivel";

const m = (id: string, isActive: boolean, terminationDate: string | null = null) => ({ id, isActive, terminationDate });
const equipe = [
  m("ativo", true),
  m("saiu-setembro", false, "2026-09-17T00:00:00.000Z"),
  m("saiu-no-ciclo", false, "2026-11-03T00:00:00.000Z"),
  m("saiu-no-primeiro-dia", false, "2026-10-26T00:00:00.000Z"),
  m("inativo-sem-data", false, null),
];
const ids = (l: Array<{ id: string }>) => l.map((x) => x.id);

describe("Equipe da gorjeta: desligados", () => {
  test("esconde quem saiu antes do início do ciclo, mesmo participando no cadastro", () => {
    expect(ids(aparecemNaEquipe(equipe, "2026-10-26", false))).toEqual(["ativo", "saiu-no-ciclo", "saiu-no-primeiro-dia"]);
  });
  test("com o seletor ligado mostra todos", () => {
    expect(aparecemNaEquipe(equipe, "2026-10-26", true)).toHaveLength(5);
  });
  test("sem período aberto só esconde inativo sem data de saída", () => {
    expect(ids(aparecemNaEquipe(equipe, null, false))).toEqual(["ativo", "saiu-setembro", "saiu-no-ciclo", "saiu-no-primeiro-dia"]);
  });
});
