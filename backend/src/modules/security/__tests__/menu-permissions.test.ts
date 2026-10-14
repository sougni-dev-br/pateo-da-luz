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
    expect(menuDoFavorito("payroll-vt")).toBe("payroll");
    expect(menuDoFavorito("payroll-adiantamento")).toBe("payroll");
  });
  it("chave inventada não vale", () => {
    expect(menuDoFavorito("qualquer")).toBeNull();
  });
});

describe("resolvePermissionContext — desperdício", () => {
  // Prefixo de topo sem mapeamento ficaria público (requireMenuAccess deixa passar o que não resolve).
  it("toda rota de /waste cai no módulo inventory-waste", async () => {
    expect(await ctx("GET", "/waste")).toEqual({ menuId: "inventory-waste", action: "view" });
    expect(await ctx("GET", "/WASTE/summary/")).toEqual({ menuId: "inventory-waste", action: "view" });
    expect(await ctx("GET", "/waste/dishes")).toEqual({ menuId: "inventory-waste", action: "view" });
    expect(await ctx("POST", "/waste")).toEqual({ menuId: "inventory-waste", action: "create" });
  });

  it("foto: enviar é criar, ver é ver, apagar é excluir", async () => {
    expect(await ctx("POST", "/waste/abc/photo")).toEqual({ menuId: "inventory-waste", action: "create" });
    expect(await ctx("GET", "/waste/abc/photo")).toEqual({ menuId: "inventory-waste", action: "view" });
    expect(await ctx("DELETE", "/waste/abc/photo")).toEqual({ menuId: "inventory-waste", action: "delete" });
  });

  it("cancelar pede excluir", async () => {
    expect(await ctx("POST", "/waste/abc/cancel")).toEqual({ menuId: "inventory-waste", action: "delete" });
  });

  it("o limite do aviso exige administrar, inclusive para ler", async () => {
    expect(await ctx("GET", "/waste/settings")).toEqual({ menuId: "inventory-waste", action: "admin" });
    expect(await ctx("PUT", "/waste/settings")).toEqual({ menuId: "inventory-waste", action: "admin" });
    expect(await ctx("PUT", "/WASTE/Settings/")).toEqual({ menuId: "inventory-waste", action: "admin" });
  });
});

describe("resolvePermissionContext — Análise do Salão", () => {
  // Um prefixo novo sem mapeamento ficaria público (requireMenuAccess deixa passar o que não resolve).
  const LEITURAS = [
    "/integrations/agile/analise/resumo", "/integrations/agile/analise/demanda", "/integrations/agile/analise/cardapio", "/integrations/agile/analise/perdas",
    "/integrations/agile/analise/margem", "/integrations/agile/analise/margem-bebidas", "/integrations/agile/analise/margem-buffet", "/integrations/agile/analise/metas", "/integrations/agile/analise/vendas-por-pessoa",
    "/integrations/agile/analise/cancelamentos", "/integrations/agile/analise/itens-cancelados", "/integrations/agile/analise/descontos"
  ];
  const GRAVACOES = ["/integrations/agile/analise/metas", "/integrations/agile/analise/margem/vinculo", "/integrations/agile/analise/margem-bebidas/vinculo", "/integrations/agile/analise/margem-buffet/custo"];

  it.each(LEITURAS)("GET %s exige ver a análise do salão", async (caminho) => {
    expect(await ctx("GET", caminho)).toEqual({ menuId: "analise-salao", action: "view" });
  });

  it.each(GRAVACOES)("PUT %s exige EDITAR (ver não basta)", async (caminho) => {
    expect(await ctx("PUT", caminho)).toEqual({ menuId: "analise-salao", action: "edit" });
  });

  it("maiúsculas, barra no fim e barras duplas já normalizadas não escapam", async () => {
    expect(await ctx("GET", "/INTEGRATIONS/AGILE/ANALISE/Margem-Bebidas/")).toEqual({ menuId: "analise-salao", action: "view" });
    expect(await ctx("PUT", "/Integrations/Agile/Analise/Metas/")).toEqual({ menuId: "analise-salao", action: "edit" });
  });

  it("o sync e o heartbeat do agente ficam fora do portão (têm token próprio), sem virar a análise", async () => {
    expect(await ctx("POST", "/integrations/agile/sync")).toBeNull();
    expect(await ctx("POST", "/integrations/agile/heartbeat")).toBeNull();
  });
});
