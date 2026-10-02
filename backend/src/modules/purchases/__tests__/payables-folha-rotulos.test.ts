import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Contas a Pagar: o tipo da Folha distingue a 1ª quinzena (ADIANTAMENTO marcado) e o acerto da
// lista de pagamento (SALARIO de origem LISTA_PAGAMENTO), para a coluna e o filtro por sub-tipo.
vi.mock("../../../config/database.js", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));

import { prisma } from "../../../config/database.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/purchases", purchaseRouter);

// O tagged template chega com os pedaços (Prisma.sql) como valores: junta o texto dos dois.
const texto = (v: unknown): string => {
  const s = (v as { strings?: string[] } | null)?.strings;
  return Array.isArray(s) ? s.join("?") : "";
};
const sqlDaFolha = () => db.$queryRaw.mock.calls
  .map((c: unknown[]) => [(c[0] as string[]).join("?"), ...c.slice(1).map(texto)].join("\n"))
  .filter((s: string) => s.includes('FROM "PayrollItem"'));

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

describe("rótulos da Folha no Contas a Pagar", () => {
  test("1ª quinzena e acerto da lista têm rótulo próprio", async () => {
    const r = await request(app).get("/purchases/payables");
    expect(r.status).toBe(200);
    const [folha] = sqlDaFolha();
    expect(folha).toContain("primeiraQuinzena");
    expect(folha).toContain("'1ª quinzena'");
    expect(folha).toContain("LISTA_PAGAMENTO");
    expect(folha).toContain("'Salário (acerto)'");
    // Os demais continuam como antes.
    expect(folha).toContain("'Adiantamento'");
    expect(folha).toContain("'Salário'");
  });
});
