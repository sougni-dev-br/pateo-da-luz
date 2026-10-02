import { beforeEach, describe, expect, test } from "vitest";
import type { EmployeeBirthday } from "../../../api/client";
import { nomeParaExibir, ultimoSobrenome } from "../FolhaAniversariantes";
import { lerPreferencias } from "../opcoesImpressao";

// Pessoas fictícias.
const pessoa = (firstName: string, lastName: string, displayName: string | null = null): EmployeeBirthday =>
  ({ id: "p", firstName, lastName, displayName, birthDate: "1990-10-05", sector: null, position: null });

describe("nome na impressão de aniversariantes", () => {
  test("nome e sobrenome: o Nome inteiro + o último sobrenome", () => {
    expect(nomeParaExibir(pessoa("[nome omitido]", "Souza Lima"), "PRENOME_SOBRENOME")).toBe("[nome omitido] Lima");
    expect(nomeParaExibir(pessoa("Ana", "Batista da Silva"), "PRENOME_SOBRENOME")).toBe("Ana Silva");
    expect(nomeParaExibir(pessoa("Bruno", ""), "PRENOME_SOBRENOME")).toBe("Bruno");
  });

  test("agnome acompanha o sobrenome de antes", () => {
    expect(ultimoSobrenome("[nome omitido] Sobrinho")).toBe("[nome omitido]");
    expect(ultimoSobrenome("[nome omitido] [nome omitido]")).toBe("[nome omitido]");
    expect(ultimoSobrenome("Costa Júnior")).toBe("Costa Júnior");
    expect(ultimoSobrenome("Neto")).toBe("Neto");
  });

  test("as outras formas continuam como eram", () => {
    const p = pessoa("[nome omitido]", "Souza Lima", "Cida");
    expect(nomeParaExibir(p, "APELIDO")).toBe("Cida");
    expect(nomeParaExibir(p, "PRIMEIRO")).toBe("Maria");
    expect(nomeParaExibir(p, "COMPLETO")).toBe("[nome omitido] Souza Lima");
  });
});

describe("preferências da impressão", () => {
  beforeEach(() => window.localStorage.clear());

  test("sem nada salvo: o padrão é nome e sobrenome", () => {
    expect(lerPreferencias().formaNome).toBe("PRENOME_SOBRENOME");
  });

  test("preferência antiga (v2) mantém cor e modelo, mas o nome passa para o padrão novo", () => {
    window.localStorage.setItem("pateo.aniversariantes.impressao.v2", JSON.stringify({ paleta: "ROSA", modelo: "LISTA", formaNome: "APELIDO" }));
    expect(lerPreferencias()).toMatchObject({ paleta: "ROSA", modelo: "LISTA", formaNome: "PRENOME_SOBRENOME" });
  });

  test("escolha feita depois da mudança (v3) é respeitada", () => {
    window.localStorage.setItem("pateo.aniversariantes.impressao.v3", JSON.stringify({ formaNome: "APELIDO" }));
    expect(lerPreferencias().formaNome).toBe("APELIDO");
  });
});
