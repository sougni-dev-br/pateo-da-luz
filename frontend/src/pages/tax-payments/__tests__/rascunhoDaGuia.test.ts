import { beforeEach, describe, expect, test } from "vitest";
import { FORM_VAZIO } from "../formularioGuia";
import { apagarRascunho, guardarRascunho, lerRascunho } from "../rascunhoDaGuia";

describe("rascunho do lançamento (sessão expirada)", () => {
  beforeEach(() => sessionStorage.clear());
  const form = { ...FORM_VAZIO, documentType: "DARF", documentNumber: "07.16.26253.0501136-1" };

  test("guarda e devolve o que foi digitado", () => {
    guardarRascunho(form, "u1", 1_000);
    const r = lerRascunho("u1", 2_000);
    expect(r?.form.documentNumber).toBe("07.16.26253.0501136-1");
    expect(r?.salvoEm).toBe(1_000);
  });

  test("passou de 4 horas: não vale mais e é apagado", () => {
    guardarRascunho(form, "u1", 0);
    expect(lerRascunho("u1", 4 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
  });

  test("outra pessoa na mesma aba não vê o rascunho de quem foi expulso, e ele é apagado", () => {
    guardarRascunho(form, "ana");
    expect(lerRascunho("bia")).toBeNull();
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
    guardarRascunho(form, "ana");
    expect(lerRascunho("ana")?.form.documentType).toBe("DARF");
  });

  test("campos que o rascunho não tinha voltam vazios, nunca indefinidos", () => {
    sessionStorage.setItem("impostos:rascunho:v1", JSON.stringify({ salvoEm: Date.now(), usuarioId: "", form: { documentType: "FGTS", linhas: [] } }));
    const r = lerRascunho();
    expect(r?.form.workersCount).toBe("");
    expect(r?.form.employeeId).toBe("");
    expect(r?.form.totalDoPapel).toBe("");
  });

  test("conteúdo estranho ou corrompido é descartado, sem erro", () => {
    sessionStorage.setItem("impostos:rascunho:v1", "{nao é json");
    expect(lerRascunho()).toBeNull();
    sessionStorage.setItem("impostos:rascunho:v1", JSON.stringify({ salvoEm: Date.now(), form: { documentType: 5 } }));
    expect(lerRascunho()).toBeNull();
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
  });

  test("apagar remove; sem nada guardado devolve null", () => {
    expect(lerRascunho()).toBeNull();
    guardarRascunho(form);
    apagarRascunho();
    expect(lerRascunho()).toBeNull();
  });
});
