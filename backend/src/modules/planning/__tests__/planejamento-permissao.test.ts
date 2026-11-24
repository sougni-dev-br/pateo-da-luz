import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { resolvePermissionContext } from "../../security/menu-permissions.js";

const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {} } as unknown as Request);

describe("permissões do Planejamento", () => {
  it("ver o comparativo e os cenários pede só Ver", async () => {
    expect(await ctx("GET", "/planning/comparativo")).toEqual({ menuId: "planning", action: "view" });
    expect(await ctx("GET", "/planning/cenarios/c1")).toEqual({ menuId: "planning", action: "view" });
  });

  it("a prévia da projeção só calcula: pede Ver, mesmo sendo POST", async () => {
    expect(await ctx("POST", "/planning/projecao")).toEqual({ menuId: "planning", action: "view" });
  });

  it("buscar o realizado do DRE pede Editar no Planejamento", async () => {
    expect(await ctx("GET", "/planning/realizado")).toEqual({ menuId: "planning", action: "edit" });
    expect(await ctx("GET", "/planning/realizado-caixa")).toEqual({ menuId: "planning", action: "edit" });
  });

  it("criar, salvar e excluir cenário pedem criar, editar e excluir", async () => {
    expect(await ctx("POST", "/planning/cenarios")).toEqual({ menuId: "planning", action: "create" });
    expect(await ctx("PUT", "/planning/cenarios/c1")).toEqual({ menuId: "planning", action: "edit" });
    expect(await ctx("DELETE", "/planning/cenarios/c1")).toEqual({ menuId: "planning", action: "delete" });
  });
});
