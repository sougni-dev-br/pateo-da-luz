import { describe, it, expect } from "vitest"
import type { Request } from "express"
import { resolvePermissionContext } from "../modules/security/menu-permissions.js"

const ctx = (method: string, path: string) =>
  resolvePermissionContext({ method, path, body: {} } as unknown as Request)

describe("regras da agenda de contagem", () => {
  it("criar, editar e desativar regra exigem Administrar em Contagem", async () => {
    // Configurar a agenda muda o que todos os estoquistas contam: e administracao
    // do modulo, nao registro do dia a dia. O frontend ja so mostrava o
    // formulario para quem tem Administrar (canConfigureAgenda).
    expect(await ctx("POST", "/inventory/agenda/rules")).toEqual({ menuId: "inventory-counting", action: "admin" })
    expect(await ctx("PUT", "/inventory/agenda/rules/r1")).toEqual({ menuId: "inventory-counting", action: "admin" })
    expect(await ctx("DELETE", "/inventory/agenda/rules/r1")).toEqual({ menuId: "inventory-counting", action: "admin" })
  })

  it("ler a agenda e a semana continua pedindo so Ver", async () => {
    expect(await ctx("GET", "/inventory/agenda")).toEqual({ menuId: "inventory-counting", action: "view" })
    expect(await ctx("GET", "/inventory/agenda/week")).toEqual({ menuId: "inventory-counting", action: "view" })
  })

  it("o resto da contagem nao muda", async () => {
    expect(await ctx("POST", "/inventory/count-sessions")).toEqual({ menuId: "inventory-counting", action: "create" })
    expect(await ctx("PATCH", "/inventory/count-sessions/s1/reopen")).toEqual({ menuId: "inventory-counting", action: "edit" })
    expect(await ctx("PATCH", "/inventory/agenda/a1/confirm")).toEqual({ menuId: "inventory-counting", action: "approve" })
  })

  it("a referencia da contagem (anterior + compras) e leitura de quem conta", async () => {
    expect(await ctx("GET", "/inventory/count-sessions/s1/referencia")).toEqual({ menuId: "inventory-counting", action: "view" })
  })
})
