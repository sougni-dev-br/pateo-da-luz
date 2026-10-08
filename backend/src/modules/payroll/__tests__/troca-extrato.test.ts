import { describe, expect, test } from "vitest";
import { diferencasDoExtrato, salariosDesatualizados, type LinhaExtrato } from "../tip-conferencia.js";

// Trocar o extrato: o que mudou entre o guardado e o novo, e quais salários do Contas a
// Pagar ficaram diferentes do líquido novo.
const l = (employeeId: string | null, nome: string, liquido: number, gorjeta: number | null = 0): LinhaExtrato =>
  ({ employeeId, nome, liquido, gorjeta, adiantamento: null, situacao: null });

describe("diferencasDoExtrato", () => {
  test("só quem mudou, entrou ou saiu", () => {
    const antes = [l("a", "ANA", 1000, 100), l("b", "BRUNO", 900), l("c", "CARLA", 800)];
    const depois = [l("a", "ANA", 1000, 100), l("b", "BRUNO", 901), l(null, "DAVI SEM CADASTRO", 700)];
    expect(diferencasDoExtrato(antes, depois).map((d) => [d.nome, d.situacao])).toEqual([
      ["BRUNO", "MUDOU"], ["DAVI SEM CADASTRO", "ENTROU"], ["CARLA", "SAIU"],
    ]);
  });
});

describe("salariosDesatualizados", () => {
  test("compara o líquido guardado (no salário combinado o valor do título é outro de propósito)", () => {
    const abertos = [
      { employeeId: "a", nome: "Ana", amount: 1000, details: { liquido: 1000 }, titulo: null },
      { employeeId: "b", nome: "Bruno", amount: 1800, details: { liquidoExtrato: 900, origemValor: "SALARIO_COMBINADO" }, titulo: "Folha 09/2026 · Pateo Exemplo" },
      { employeeId: "c", nome: "Carla", amount: 800, details: null, titulo: null },
    ];
    expect(salariosDesatualizados(abertos, [l("a", "ANA", 1000), l("b", "BRUNO", 901), l("c", "CARLA", 800)])).toEqual([
      { employeeId: "b", nome: "Bruno", noContasAPagar: 900, extratoNovo: 901, titulo: "Folha 09/2026 · Pateo Exemplo" },
    ]);
  });
});
