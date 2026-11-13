import { describe, expect, it } from "vitest";
import { montarLinhasClt, parcelaDoRotulo } from "../decimo-terceiro-clt.js";

const pessoa = (id: string) => ({ employeeId: id, nome: `Pessoa ${id}`, setor: null });
const item = (employeeId: string, periodLabel: string, amount: number, status = "PENDING") => ({ employeeId, periodLabel, amount, status });

describe("parcelaDoRotulo", () => {
  it("lê a parcela do rótulo do extrato", () => {
    expect(parcelaDoRotulo("13º Salário - 1ª parcela (extrato)")).toBe(1);
    expect(parcelaDoRotulo("13º Salário - 2ª parcela (extrato)")).toBe(2);
  });
  it("não adivinha quando o rótulo não diz", () => {
    expect(parcelaDoRotulo("13º Salário (extrato)")).toBeNull();
  });
  it("ignora o 13º do período sem registro (outro rótulo)", () => {
    expect(parcelaDoRotulo("13º Salário - 1ª parcela")).toBeNull();
  });
});

describe("montarLinhasClt", () => {
  it("quem não tem lançamento aguarda o extrato (parcelas nulas)", () => {
    expect(montarLinhasClt([pessoa("a")], [])).toEqual([{ ...pessoa("a"), parcela1: null, parcela2: null }]);
  });
  it("coloca cada lançamento na sua parcela e marca o que está pago", () => {
    const [l] = montarLinhasClt([pessoa("a")], [item("a", "13º Salário - 1ª parcela (extrato)", 900, "PAID"), item("a", "13º Salário - 2ª parcela (extrato)", 700)]);
    expect(l.parcela1).toEqual({ valor: 900, pago: true });
    expect(l.parcela2).toEqual({ valor: 700, pago: false });
  });
  it("importar duas vezes a mesma parcela não soma", () => {
    const [l] = montarLinhasClt([pessoa("a")], [item("a", "13º Salário - 1ª parcela (extrato)", 900), item("a", "13º Salário - 1ª parcela (extrato)", 900)]);
    expect(l.parcela1?.valor).toBe(900);
  });
  it("ignora lançamento de outra pessoa, rótulo sem parcela e o 13º sem registro da mesma pessoa", () => {
    const [l] = montarLinhasClt([pessoa("a")], [
      item("b", "13º Salário - 1ª parcela (extrato)", 500), item("a", "13º Salário", 100), item("a", "13º Salário - 1ª parcela", 300),
    ]);
    expect(l.parcela1).toBeNull();
  });
});
