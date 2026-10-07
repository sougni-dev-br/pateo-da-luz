import type { Request } from "express";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

import { resolvePermissionContext } from "../../security/menu-permissions.js";

const ctx = (method: string, path: string) =>
  resolvePermissionContext({ method, path, body: {}, query: {} } as unknown as Request);

// A posicao do estoque mostra quantidade e custo da base oficial do CMV, a
// mesma informacao do inventario. Sem regra propria ela caia em "inventory"
// (estoque generico): quem nao ve inventario lia os custos, e quem ve recebia 403.
describe("permissao das rotas da tela de Inventario", () => {
  test("posicao do estoque pertence ao inventario oficial", async () => {
    expect((await ctx("GET", "/inventory/posicao"))?.menuId).toBe("inventory-official");
  });

  test("conferencia segue no inventario oficial", async () => {
    expect((await ctx("GET", "/inventory/operational/abc/conferencia"))?.menuId).toBe("inventory-official");
  });
});
