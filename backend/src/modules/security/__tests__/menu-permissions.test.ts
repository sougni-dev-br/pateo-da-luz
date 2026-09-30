import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { resolvePermissionContext } from "../menu-permissions.js";

const ctx = (method: string, path: string) =>
  resolvePermissionContext({ method, path, body: {}, query: {} } as unknown as Request);

// Falha de 29/09/2026: caixa diferente ou barra no fim caíam em "rota não
// catalogada" e passavam sem checar permissão.
describe("resolvePermissionContext — caminho normalizado", () => {
  it("maiúsculas não escapam do catálogo", async () => {
    expect(await ctx("GET", "/EMPLOYEES")).toEqual({ menuId: "employees", action: "view" });
    expect(await ctx("GET", "/Payroll/settings")).toEqual({ menuId: "payroll", action: "view" });
    expect(await ctx("DELETE", "/EMPLOYEES/abc")).toEqual({ menuId: "employees", action: "delete" });
  });

  it("barra no fim não escapa", async () => {
    expect(await ctx("GET", "/payroll/")).toEqual({ menuId: "payroll", action: "view" });
    expect(await ctx("PATCH", "/purchases/payables/abc/reverse/")).toEqual({ menuId: "payables", action: "delete" });
  });

  it("caminho normal continua igual", async () => {
    expect(await ctx("GET", "/employees")).toEqual({ menuId: "employees", action: "view" });
    expect(await ctx("POST", "/employees")).toEqual({ menuId: "employees", action: "create" });
  });

  it("rota fora do catálogo continua sem contexto", async () => {
    expect(await ctx("GET", "/auth/me")).toBeNull();
  });
});
