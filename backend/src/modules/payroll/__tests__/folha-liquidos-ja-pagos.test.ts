import { expect, test } from "vitest";
import { separarJaPagos, type LinhaFolha } from "../tip-conferencia.js";

const linha = (employeeId: string | null, nome: string, valor: number): LinhaFolha =>
  ({ employeeId, nome, grupo: "Sem registro", origem: "SEM_REGISTRO", valor, composicao: "", pix: null, aviso: null }) as LinhaFolha;

test("quem já teve o salário baixado sai da lista e do total e aparece como já pago", () => {
  const r = separarJaPagos(
    [linha("a", "Fulano de Tal", 1000), linha("b", "Beltrana Souza", 2000), linha(null, "Sem cadastro", 50)],
    new Map([["a", { valor: 1000, pagoEm: "2026-09-30" }]]),
  );
  expect(r.linhas.map((l) => l.nome)).toEqual(["Beltrana Souza", "Sem cadastro"]);
  expect(r.jaPagos).toEqual([{ employeeId: "a", nome: "Fulano de Tal", grupo: "Sem registro", valor: 1000, pagoEm: "2026-09-30" }]);
});
