import { expect, test } from "vitest";
import { separarJaPagos, somarSalariosPagos, type LinhaFolha } from "../tip-conferencia.js";

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

test("pago a menos: a linha fica com o saldo e um aviso, e não vai para os já pagos", () => {
  const r = separarJaPagos([linha("a", "Fulano de Tal", 1000)], new Map([["a", { valor: 400, pagoEm: "2026-09-30" }]]));
  expect(r.jaPagos).toEqual([]);
  expect(r.linhas).toHaveLength(1);
  expect(r.linhas[0].valor).toBe(600);
  expect(r.linhas[0].aviso).toBe("Pago R$ 400,00 em 30/09; falta R$ 600,00.");
});

test("diferença de até 1 centavo conta como pago", () => {
  const r = separarJaPagos([linha("a", "Fulano de Tal", 1000)], new Map([["a", { valor: 999.99, pagoEm: "2026-09-30" }]]));
  expect(r.linhas).toEqual([]);
  expect(r.jaPagos[0].valor).toBe(999.99);
});

test("pago a menos mantém o aviso anterior da linha", () => {
  const l = { ...linha("a", "Fulano de Tal", 1000), aviso: "Não achado no cadastro: confira o PIX." };
  const r = separarJaPagos([l], new Map([["a", { valor: 100, pagoEm: "2026-09-05" }]]));
  expect(r.linhas[0].aviso).toBe("Não achado no cadastro: confira o PIX. Pago R$ 100,00 em 05/09; falta R$ 900,00.");
});

test("soma todos os salários pagos da pessoa (inclusive complemento) e guarda a data da última baixa", () => {
  const pagos = somarSalariosPagos([
    { employeeId: "a", paidAmount: 600, amount: 700, paymentDate: new Date("2026-09-15T12:00:00Z") },
    { employeeId: "a", paidAmount: null, amount: 400, paymentDate: new Date("2026-09-30T12:00:00Z") },
    { employeeId: "b", paidAmount: 50.1, amount: 50.1, paymentDate: new Date("2026-09-20T12:00:00Z") },
  ]);
  expect(pagos.get("a")).toEqual({ valor: 1000, pagoEm: "2026-09-30" });
  expect(pagos.get("b")).toEqual({ valor: 50.1, pagoEm: "2026-09-20" });
  // Com a soma, um salário de 1000 pago em duas baixas sai da lista.
  const r = separarJaPagos([linha("a", "Fulano de Tal", 1000)], pagos);
  expect(r.linhas).toEqual([]);
});
