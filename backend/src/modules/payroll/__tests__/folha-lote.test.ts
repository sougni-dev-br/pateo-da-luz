import { describe, expect, test } from "vitest";
import { GRUPO_A_PARTE, GRUPO_SEM_REGISTRO, planejarLotes, rotuloDoLote, todosPagos, vencimentoDoLote } from "../folha-lote.js";

// Regras do lote de pagamento da folha, sem banco.
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("vencimento do título", () => {
  test("5º dia útil do mês seguinte (o mesmo do acerto da lista)", () => {
    expect(iso(vencimentoDoLote(2026, 9))).toBe("2026-10-06");
  });
  test("dezembro vence em janeiro do ano seguinte", () => {
    expect(vencimentoDoLote(2026, 12).getUTCFullYear()).toBe(2027);
    expect(vencimentoDoLote(2026, 12).getUTCMonth()).toBe(0);
  });
});

describe("rótulo", () => {
  test("empresa, sem registro e folha à parte", () => {
    expect(rotuloDoLote(2026, 9, "111", "Pateo Exemplo")).toBe("Folha 09/2026 · Pateo Exemplo");
    expect(rotuloDoLote(2026, 9, GRUPO_SEM_REGISTRO, null)).toBe("Folha 09/2026 · Sem registro");
    expect(rotuloDoLote(2026, 9, GRUPO_A_PARTE, null)).toBe("Folha à parte 09/2026");
  });
});

describe("planejar", () => {
  const extratos = [{ empresa: "PATEO EXEMPLO LTDA", cnpj: "11.111.111/0001-11" }];
  const empresas = new Map([["11111111000111", "Pateo Exemplo"]]);

  test("agrupa por CNPJ do extrato e leva todos os salários em aberto da pessoa", () => {
    const p = planejarLotes(2026, 9, [
      { employeeId: "e1", nome: "Ana Exemplo", grupo: "PATEO EXEMPLO LTDA", origem: "EXTRATO", valor: 1600 },
      { employeeId: "e2", nome: "Bruno Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 800 },
    ], extratos, [
      { id: "a", employeeId: "e1", amount: 1500 }, { id: "b", employeeId: "e1", amount: 100 }, { id: "c", employeeId: "e2", amount: 800 },
    ], empresas);
    expect(p.grupos.map((g) => [g.grupo, g.rotulo, g.total, g.membros.map((m) => m.payrollItemId)])).toEqual([
      ["11111111000111", "Folha 09/2026 · Pateo Exemplo", 1600, ["a", "b"]],
      [GRUPO_SEM_REGISTRO, "Folha 09/2026 · Sem registro", 800, ["c"]],
    ]);
    expect(p.avisos).toEqual([]);
  });

  test("quem já está em lote não entra de novo; salário fora da folha vira aviso", () => {
    const p = planejarLotes(2026, 9, [
      { employeeId: "e1", nome: "Ana Exemplo", grupo: "PATEO EXEMPLO LTDA", origem: "EXTRATO", valor: 1500 },
    ], extratos, [{ id: "z", employeeId: "e9", amount: 300 }], empresas, new Set(["e1"]));
    expect(p.grupos).toEqual([]);
    expect(p.avisos).toEqual(["1 pessoa(s) com salário de 09/2026 em aberto fora da folha de líquidos — não entram no lote."]);
  });

  test("linha sem cadastro fica fora com aviso", () => {
    const p = planejarLotes(2026, 9, [{ employeeId: null, nome: "PESSOA DO EXTRATO", grupo: "PATEO EXEMPLO LTDA", origem: "EXTRATO", valor: 10 }], extratos, [], empresas);
    expect(p.avisos[0]).toMatch(/não achado no cadastro/);
  });
});

test("todos pagos: só com lote vivo e todos PAGO", () => {
  expect(todosPagos([])).toBe(false);
  expect(todosPagos([{ status: "PAGO" }, { status: "CANCELADO" }])).toBe(true);
  expect(todosPagos([{ status: "PAGO" }, { status: "ABERTO" }])).toBe(false);
});

describe("permissão das rotas do lote (catálogo de menus)", () => {
  test("ações do título no Contas a Pagar valem a permissão da Folha, como a baixa individual", async () => {
    const { resolvePermissionContext } = await import("../../security/menu-permissions.js");
    const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {}, query: {} } as never);
    expect(await ctx("PATCH", "/payroll/folha-lotes/l1/pay")).toEqual({ menuId: "payroll", action: "edit" });
    expect(await ctx("PATCH", "/payroll/folha-lotes/l1/reverse")).toEqual({ menuId: "payroll", action: "delete" });
    expect(await ctx("PATCH", "/payroll/folha-lotes/l1/membros/p1/retirar")).toEqual({ menuId: "payroll", action: "edit" });
    expect(await ctx("POST", "/payroll/tip/periods/2026/9/folha-lotes/liberar")).toEqual({ menuId: "payroll-tips", action: "create" });
    expect(await ctx("POST", "/payroll/tip/periods/2026/9/folha-lotes/cancelar")).toEqual({ menuId: "payroll-tips", action: "delete" });
  });
});
