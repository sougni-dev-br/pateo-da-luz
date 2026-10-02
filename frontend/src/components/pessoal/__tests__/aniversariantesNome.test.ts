import { beforeEach, describe, expect, test } from "vitest";
import type { EmployeeBirthday } from "../../../api/client";
import { nomeParaExibir, ultimoSobrenome } from "../FolhaAniversariantes";
import { lerPreferencias } from "../opcoesImpressao";

// Pessoas fictícias.
const pessoa = (firstName: string, lastName: string, displayName: string | null = null): EmployeeBirthday =>
  ({ id: "p", firstName, lastName, displayName, birthDate: "1990-10-05", sector: null, position: null });

describe("nome na impressão de aniversariantes", () => {
  test("nome e sobrenome: o Nome inteiro + o último sobrenome", () => {
    expect(nomeParaExibir(pessoa("Ana Beatriz", "Souza Lima"), "PRENOME_SOBRENOME")).toBe("Ana Beatriz Lima");
    expect(nomeParaExibir(pessoa("Ana", "Moura da Silva"), "PRENOME_SOBRENOME")).toBe("Ana Silva");
    expect(nomeParaExibir(pessoa("Bruno", ""), "PRENOME_SOBRENOME")).toBe("Bruno");
  });

  test("agnome acompanha o sobrenome de antes", () => {
    expect(ultimoSobrenome("Rocha Prado Sobrinho")).toBe("Prado Sobrinho");
    expect(ultimoSobrenome("Lopes dos Reis Neto")).toBe("Reis Neto");
    expect(ultimoSobrenome("Costa Júnior")).toBe("Costa Júnior");
    expect(ultimoSobrenome("Neto")).toBe("Neto");
  });

  test("Completo usa o nome da carteira; sem ele, Nome + Sobrenome", () => {
    const comCarteira = { ...pessoa("Ana", "Lima"), nomeCompleto: "Ana Beatriz de Souza Lima" };
    expect(nomeParaExibir(comCarteira, "COMPLETO")).toBe("Ana Beatriz de Souza Lima");
    expect(nomeParaExibir({ ...comCarteira, nomeCompleto: "  " }, "COMPLETO")).toBe("Ana Lima");
  });

  test("espaços sobrando não vão para a impressão; partícula solta no fim é ignorada", () => {
    expect(nomeParaExibir(pessoa(" Ana  Beatriz ", "Souza   Lima "), "PRENOME_SOBRENOME")).toBe("Ana Beatriz Lima");
    expect(nomeParaExibir(pessoa("Ana ", " Souza Lima"), "COMPLETO")).toBe("Ana Souza Lima");
    expect(ultimoSobrenome("Silva de")).toBe("Silva");
    expect(ultimoSobrenome("de")).toBe("de");
  });

  test("as outras formas continuam como eram", () => {
    const p = pessoa("Ana Beatriz", "Souza Lima", "Bia");
    expect(nomeParaExibir(p, "APELIDO")).toBe("Bia");
    expect(nomeParaExibir(p, "PRIMEIRO")).toBe("Ana");
    expect(nomeParaExibir(p, "COMPLETO")).toBe("Ana Beatriz Souza Lima");
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

  test("valor salvo que não existe (ou JSON que não é objeto) volta ao padrão, sem quebrar", () => {
    window.localStorage.setItem("pateo.aniversariantes.impressao.v3", JSON.stringify({ paleta: "ROXO", modelo: 3, mostrarLogo: "sim", mensagem: "Oi" }));
    expect(lerPreferencias()).toMatchObject({ paleta: "DOURADO", modelo: "CARTAZ", mostrarLogo: true, mensagem: "Oi" });
    window.localStorage.setItem("pateo.aniversariantes.impressao.v3", JSON.stringify("abc"));
    expect(lerPreferencias()).toMatchObject({ paleta: "DOURADO", formaNome: "PRENOME_SOBRENOME" });
    expect(lerPreferencias()).not.toHaveProperty("0");
  });

  test("escolha feita depois da mudança (v3) é respeitada", () => {
    window.localStorage.setItem("pateo.aniversariantes.impressao.v3", JSON.stringify({ formaNome: "APELIDO" }));
    expect(lerPreferencias().formaNome).toBe("APELIDO");
  });
});
