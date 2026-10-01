import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { menuDoFavorito, resolvePermissionContext } from "../menu-permissions.js";

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

  it("RH → Rescisões fica sob a Folha (o módulo que lança a rescisão)", async () => {
    expect(await ctx("GET", "/payroll/rescisoes")).toEqual({ menuId: "payroll", action: "view" });
    expect(await ctx("GET", "/payroll/rescisoes/abc")).toEqual({ menuId: "payroll", action: "view" });
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
    expect(await ctx("PUT", "/EXTRAS/Settings/")).toEqual({ menuId: "extras", action: "admin" });
  });

  it("painel e frequência são leitura do próprio módulo", async () => {
    expect(await ctx("GET", "/extras/painel")).toEqual({ menuId: "extras", action: "view" });
    expect(await ctx("GET", "/EXTRAS/Painel/")).toEqual({ menuId: "extras", action: "view" });
    expect(await ctx("GET", "/extras/habitualidade/")).toEqual({ menuId: "extras", action: "view" });
  });

  it("gerar pagamento é aprovar (também com barra no fim); cancelar é excluir", async () => {
    expect(await ctx("POST", "/extras/payments")).toEqual({ menuId: "extras", action: "approve" });
    expect(await ctx("POST", "/extras/payments/")).toEqual({ menuId: "extras", action: "approve" });
    expect(await ctx("POST", "/extras/payments/abc/cancel")).toEqual({ menuId: "extras", action: "delete" });
  });

  it("baixa e estorno pedem a permissão do Contas a Pagar", async () => {
    expect(await ctx("PATCH", "/extras/payments/abc/pay")).toEqual({ menuId: "payables", action: "edit" });
    expect(await ctx("PATCH", "/EXTRAS/payments/abc/reverse")).toEqual({ menuId: "payables", action: "delete" });
  });
});

describe("menuDoFavorito — itens do menu que herdam permissão", () => {
  it("módulo do catálogo é ele mesmo", () => {
    expect(menuDoFavorito("payroll")).toBe("payroll");
  });
  it("Rescisões e Retorno do RH herdam a Folha e a Gorjeta", () => {
    expect(menuDoFavorito("rescisoes")).toBe("payroll");
    expect(menuDoFavorito("rh-retorno")).toBe("payroll-tips");
  });
  it("chave inventada não vale", () => {
    expect(menuDoFavorito("qualquer")).toBeNull();
  });
});
