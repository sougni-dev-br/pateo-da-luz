import { describe, expect, test } from "vitest";
import { ajustarFiltros, avisoFolhaOculta, contarFiltrosAtivos, type FiltrosPagar } from "../regras";

const base: FiltrosPagar = { filter: "", supplierId: "", paymentMethodId: "", employeeId: "", status: "", sourceType: "", origin: "all", noDueDate: false };

describe("filtro Funcionário do Contas a Pagar", () => {
  test("conta como filtro ativo", () => {
    expect(contarFiltrosAtivos(base, null)).toBe(0);
    expect(contarFiltrosAtivos({ ...base, employeeId: "emp-1" }, null)).toBe(1);
  });

  test("escolher funcionário limpa fornecedor e forma de pagamento (folha não tem nenhum dos dois)", () => {
    const antes = { ...base, supplierId: "forn-1", paymentMethodId: "pix" };
    const depois = ajustarFiltros(antes, { ...antes, employeeId: "emp-1" });
    expect(depois).toMatchObject({ employeeId: "emp-1", supplierId: "", paymentMethodId: "" });
  });

  test("escolher fornecedor ou forma de pagamento limpa o funcionário", () => {
    const antes = { ...base, employeeId: "emp-1" };
    expect(ajustarFiltros(antes, { ...antes, supplierId: "forn-1" }).employeeId).toBe("");
    expect(ajustarFiltros(antes, { ...antes, paymentMethodId: "pix" }).employeeId).toBe("");
  });

  test("tipo Compras ou Impostos limpa o funcionário; escolher funcionário volta o tipo para Todos", () => {
    const comFuncionario = { ...base, employeeId: "emp-1" };
    expect(ajustarFiltros(comFuncionario, { ...comFuncionario, origin: "purchases" }).employeeId).toBe("");
    expect(ajustarFiltros(comFuncionario, { ...comFuncionario, origin: "taxes" }).employeeId).toBe("");
    expect(ajustarFiltros({ ...base, origin: "purchases" }, { ...base, origin: "purchases", employeeId: "emp-1" }).origin).toBe("all");
  });

  test("fornecedor escolhido tira o tipo Folha (a folha não tem fornecedor)", () => {
    const antes = { ...base, origin: "payroll" };
    expect(ajustarFiltros(antes, { ...antes, supplierId: "forn-1" }).origin).toBe("all");
  });

  test("escolher funcionário tira o sub-tipo de compras, que esvaziaria a lista; sub-tipo de folha fica", () => {
    for (const subtipo of ["DIRECT", "CARD_STATEMENT", "SUPPLIER_CYCLE"]) {
      const antes = { ...base, sourceType: subtipo };
      expect(ajustarFiltros(antes, { ...antes, employeeId: "emp-1" }).sourceType).toBe("");
    }
    const folha = { ...base, sourceType: "PAYROLL:Salário (acerto)" };
    expect(ajustarFiltros(folha, { ...folha, employeeId: "emp-1" }).sourceType).toBe("PAYROLL:Salário (acerto)");
  });

  test("limpar o fornecedor não mexe no funcionário", () => {
    const antes = { ...base, employeeId: "emp-1" };
    expect(ajustarFiltros(antes, { ...antes, supplierId: "" })).toEqual(antes);
  });
});

describe("aviso de folha escondida pelos filtros", () => {
  test("fornecedor ou forma de pagamento escondem folha, diárias e impostos: a tela avisa", () => {
    expect(avisoFolhaOculta({ ...base, supplierId: "forn-1" })).toMatch(/folha/i);
    expect(avisoFolhaOculta({ ...base, paymentMethodId: "pix" })).toMatch(/folha/i);
  });

  test("sem esses filtros, ou com o tipo escolhido de propósito, não avisa", () => {
    expect(avisoFolhaOculta(base)).toBeNull();
    expect(avisoFolhaOculta({ ...base, employeeId: "emp-1" })).toBeNull();
    expect(avisoFolhaOculta({ ...base, supplierId: "forn-1", origin: "purchases" })).toBeNull();
  });
});
