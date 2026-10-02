import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { employee: { findMany: vi.fn() }, $queryRaw: vi.fn() }
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"), requireRole: vi.fn()
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { supplierRouter } from "../supplier.routes.js";
import { employeePaymentDetails, employeeToSupplierDraft, formatCpf, type EmployeeForSupplier } from "../employee-supplier.js";

const app = express();
app.use(express.json());
app.use("/suppliers", supplierRouter);

const ANA: EmployeeForSupplier = {
  id: "e1", firstName: "Ana", lastName: " Exemplo  Silva", cpf: "12345678901", phone: "11 90000-0000", email: null,
  position: "Garçom", isActive: true, bankName: "Banco Fictício", bankAgency: "0001", bankAccount: "12345",
  bankAccountDigit: "6", bankAccountType: "CONTA_CORRENTE", pixKeyType: "CPF", pixKey: "123.456.789-01"
};
const BRUNO: EmployeeForSupplier = {
  ...ANA, id: "e2", firstName: "Bruno", lastName: "Exemplo", cpf: "98765432100", isActive: false,
  bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null, pixKeyType: null, pixKey: null
};

describe("rascunho de fornecedor a partir do funcionário", () => {
  test("preenche nome completo, CPF formatado, contato e categoria", () => {
    const draft = employeeToSupplierDraft(ANA);
    expect(draft).toMatchObject({
      name: "Ana Exemplo Silva", document: "123.456.789-01", phone: "11 90000-0000", email: "", mainCategory: "Funcionário"
    });
  });

  test("leva PIX e conta para a observação financeira", () => {
    expect(employeePaymentDetails(ANA)).toBe("PIX (CPF): 123.456.789-01 | Banco Banco Fictício · Ag. 0001 · Conta corrente 12345-6");
  });

  test("sem dados bancários a observação fica vazia", () => {
    expect(employeePaymentDetails(BRUNO)).toBe("");
  });

  test("CPF fora do tamanho não é mascarado", () => {
    expect(formatCpf("1234")).toBe("1234");
  });
});

describe("GET /suppliers/employee-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", role: "VISUALIZACAO" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(true);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([ANA, BRUNO] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "s1", name: "Ana (fornecedor)", isActive: true, digits: "12345678901" }] as never);
  });

  test("lista funcionários com o rascunho e o fornecedor que já tem o mesmo CPF", async () => {
    const r = await request(app).get("/suppliers/employee-options");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0]).toMatchObject({ employeeId: "e1", name: "Ana Exemplo Silva", existingSupplier: { id: "s1" } });
    expect(r.body[0].draft.document).toBe("123.456.789-01");
    expect(r.body[1]).toMatchObject({ employeeId: "e2", isActive: false, existingSupplier: null });
  });

  test("sem permissão de ver Funcionários não expõe CPF/PIX", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, menu) => menu !== "employees");
    const r = await request(app).get("/suppliers/employee-options");
    expect(r.status).toBe(403);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  test("sem permissão de criar fornecedor é recusado", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, menu, acao) => !(menu === "suppliers" && acao === "create"));
    const r = await request(app).get("/suppliers/employee-options");
    expect(r.status).toBe(403);
  });

  test("sem sessão devolve 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const r = await request(app).get("/suppliers/employee-options");
    expect(r.status).toBe(401);
  });
});
