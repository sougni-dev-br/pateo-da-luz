import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

// Contas a Pagar: a folha não tem fornecedor, então o filtro "Funcionário" e o tipo "Folha"
// são o caminho para achar o salário de alguém (ex.: acerto vencido de quem recebe por quinzena).
const api = vi.hoisted(() => ({
  getPayablesComLimite: vi.fn(),
  getPayablesPessoas: vi.fn(),
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCompanies: vi.fn(),
  getAllBankAccounts: vi.fn(),
  downloadPayablesFinancialPdf: vi.fn(),
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Payables } from "../../Payables";

const salario = { id: "s1", purchaseId: null, dueDate: "2026-10-31T00:00:00.000Z", paidDate: null, amount: "1000", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "PAYROLL", status: "OVERDUE", rawValue: null,
  supplierId: null, supplierName: "Rafael da Hora", purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
  taxDocumentType: "Salário (acerto)", taxDescription: "Acerto (lista de pagamento)", taxCompanyName: "Rafael da Hora" } as unknown as Payable;

const USER = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SESSAO = { user: USER, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><Payables user={USER} /></HideValuesProvider></SessionContext.Provider>,
);
const chamadas = () => api.getPayablesComLimite.mock.calls.map((c) => c[0] as Record<string, unknown>);

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.getPayablesComLimite.mockResolvedValue({ titulos: [salario], truncado: false });
  api.getPayablesPessoas.mockResolvedValue([{ id: "emp-1", nome: "Rafael da Hora" }, { id: "emp-2", nome: "Ana Souza" }]);
  api.getSuppliers.mockResolvedValue([{ id: "forn-1", name: "Hortifruti Boa Safra" }]);
  api.getPaymentMethods.mockResolvedValue([]);
  api.getCompanies.mockResolvedValue([]);
  api.getAllBankAccounts.mockResolvedValue([]);
});

async function abrirFiltros() {
  abrir();
  await screen.findByText("Rafael da Hora");
  fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
}

describe("Contas a Pagar — filtro por funcionário", () => {
  test("lista as pessoas da folha e filtra a busca pelo funcionário escolhido", async () => {
    await abrirFiltros();
    const seletor = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Rafael da Hora" })).toBeInTheDocument());
    api.getPayablesComLimite.mockClear();
    fireEvent.change(seletor, { target: { value: "emp-1" } });
    await waitFor(() => expect(chamadas().some((c) => c.employeeId === "emp-1")).toBe(true));
    // Os vencidos de antes do período (o caso do acerto de outubro) também saem filtrados pela pessoa.
    // O resumo dos cartões é a única busca que ignora os filtros, de propósito.
    expect(chamadas().some((c) => c.status === "OVERDUE" && c.employeeId === "emp-1")).toBe(true);
  });

  test("o funcionário escolhido fica à vista como filtro ativo e a pílula o remove", async () => {
    await abrirFiltros();
    const seletor = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Rafael da Hora" })).toBeInTheDocument());
    fireEvent.change(seletor, { target: { value: "emp-1" } });
    const pilula = await screen.findByRole("button", { name: "Remover filtro Funcionário: Rafael da Hora" });
    api.getPayablesComLimite.mockClear();
    fireEvent.click(pilula);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remover filtro Funcionário: Rafael da Hora" })).not.toBeInTheDocument());
    await waitFor(() => expect(chamadas().length).toBeGreaterThan(0));
    expect(chamadas().every((c) => !c.employeeId)).toBe(true);
  });

  test("o tipo Folha e extras pede só a folha ao servidor", async () => {
    await abrirFiltros();
    const tipo = await screen.findByLabelText("Tipo");
    api.getPayablesComLimite.mockClear();
    fireEvent.change(tipo, { target: { value: "payroll" } });
    await waitFor(() => expect(chamadas().some((c) => c.origin === "payroll")).toBe(true));
  });

  test("o PDF financeiro não sai com funcionário filtrado (não saberia filtrar) e explica o motivo", async () => {
    await abrirFiltros();
    const seletor = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Rafael da Hora" })).toBeInTheDocument());
    fireEvent.change(seletor, { target: { value: "emp-1" } });
    await waitFor(() => expect(chamadas().some((c) => c.employeeId === "emp-1")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "PDF financeiro" }));
    expect(await screen.findByText(/ainda não filtra por funcionário/i)).toBeInTheDocument();
    expect(api.downloadPayablesFinancialPdf).not.toHaveBeenCalled();
  });

  test("com fornecedor escolhido avisa que a folha não aparece e aponta o caminho", async () => {
    await abrirFiltros();
    const fornecedor = await screen.findByLabelText("Fornecedor");
    await waitFor(() => expect(screen.getByRole("option", { name: "Hortifruti Boa Safra" })).toBeInTheDocument());
    fireEvent.change(fornecedor, { target: { value: "forn-1" } });
    expect(await screen.findByText(/não traz folha/i)).toBeInTheDocument();
  });
});
