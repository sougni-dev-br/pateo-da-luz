import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { resolvePermissionContext } from "../menu-permissions.js";

const req = (method: string, path: string) => ({ method, path, body: {}, query: {} }) as unknown as Request;
const ctx = (method: string, path: string) => resolvePermissionContext(req(method, path));

describe("resolvePermissionContext — caminho normalizado", () => {
  // Falha de 29/09/2026: caixa diferente ou barra no fim caíam em "rota não
  // catalogada" e passavam sem checar permissão.
  it("maiúsculas não escapam do catálogo", async () => {
    expect(await ctx("GET", "/EMPLOYEES")).toEqual({ menuId: "employees", action: "view" });
    expect(await ctx("GET", "/Payroll/settings")).toEqual({ menuId: "payroll", action: "view" });
  });

  it("barra no fim não escapa", async () => {
    expect(await ctx("GET", "/payroll/")).toEqual({ menuId: "payroll", action: "view" });
    expect(await ctx("POST", "/extras/payments/")).toEqual({ menuId: "extras", action: "approve" });
  });

  it("rota fora do catálogo continua sem contexto", async () => {
    expect(await ctx("GET", "/auth/me")).toBeNull();
  });
});

describe("resolvePermissionContext — extras", () => {
  it("lançar diária é criar; editar é editar; excluir é excluir", async () => {
    expect(await ctx("POST", "/extras/shifts")).toEqual({ menuId: "extras", action: "create" });
    expect(await ctx("PUT", "/extras/shifts/abc")).toEqual({ menuId: "extras", action: "edit" });
    expect(await ctx("DELETE", "/extras/shifts/abc")).toEqual({ menuId: "extras", action: "delete" });
  });

  it("mudar o valor da diária exige administrar", async () => {
    expect(await ctx("PUT", "/extras/settings")).toEqual({ menuId: "extras", action: "admin" });
    expect(await ctx("GET", "/extras/settings")).toEqual({ menuId: "extras", action: "view" });
  });

  it("gerar pagamento é aprovar; cancelar é excluir", async () => {
    expect(await ctx("POST", "/extras/payments")).toEqual({ menuId: "extras", action: "approve" });
    expect(await ctx("POST", "/extras/payments/abc/cancel")).toEqual({ menuId: "extras", action: "delete" });
  });

  it("baixa e estorno pedem a permissão do Contas a Pagar", async () => {
    expect(await ctx("PATCH", "/extras/payments/abc/pay")).toEqual({ menuId: "payables", action: "edit" });
    expect(await ctx("PATCH", "/EXTRAS/payments/abc/reverse")).toEqual({ menuId: "payables", action: "delete" });
  });
});
