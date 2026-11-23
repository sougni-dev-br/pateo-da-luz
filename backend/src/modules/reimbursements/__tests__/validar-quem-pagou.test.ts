import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

import { validarQuemPagou } from "../reimbursement.service.js";

const txCom = (fornecedor: { id: string; name: string; isActive: boolean } | null) =>
  ({ $queryRaw: vi.fn().mockResolvedValue(fornecedor ? [fornecedor] : []) }) as never;

describe("quem pagou o reembolso", () => {
  it("aceita qualquer fornecedor ativo, não só funcionário (sócio, terceiro)", async () => {
    const socio = { id: "socio-1", name: "Sócio Fulano", isActive: true };
    await expect(validarQuemPagou(txCom(socio), "socio-1", "loja-1")).resolves.toEqual(socio);
  });

  it("recusa fornecedor inativo ou inexistente", async () => {
    await expect(validarQuemPagou(txCom({ id: "a", name: "A", isActive: false }), "a", "loja-1")).rejects.toThrow(/inativo/);
    await expect(validarQuemPagou(txCom(null), "x", "loja-1")).rejects.toThrow(/nao encontrado/);
  });

  it("recusa a própria loja da compra como quem pagou", async () => {
    await expect(validarQuemPagou(txCom({ id: "loja-1", name: "Loja", isActive: true }), "loja-1", "loja-1")).rejects.toThrow(/loja/);
  });
});
