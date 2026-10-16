import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

const api = vi.hoisted(() => ({
  getPayablesComLimite: vi.fn(),
  downloadPayablesFinancialPdf: vi.fn(),
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCompanies: vi.fn(),
  getAllBankAccounts: vi.fn(),
  checkPayrollPayBatch: vi.fn(),
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Payables } from "../../Payables";

const titulo = (id: string, nome: string, dia: string, amount = "100"): Payable => ({
  id, purchaseId: "c" + id, dueDate: `${dia}T00:00:00.000Z`, paidDate: null, amount, paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "PURCHASE", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: nome, purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
} as Payable);

const USER = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SESSAO = { user: USER, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><Payables user={USER} /></HideValuesProvider></SessionContext.Provider>,
);

// Hoje fixo (10/10/2026): 12 e 13 caem em "Próximos 7 dias"; 25 fica mais adiante.
const ANA = titulo("a", "Ana Fornecedora", "2026-10-12");
const BETO = titulo("b", "Beto Distribuidora", "2026-10-12", "250");
const CAIO = titulo("c", "Caio Hortifruti", "2026-10-13");
const DORA = titulo("d", "Dora Laticínios", "2026-10-25");

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 9, 0));
  api.getPayablesComLimite.mockResolvedValue({ titulos: [ANA, BETO, CAIO, DORA], truncado: false });
  api.getSuppliers.mockResolvedValue([]);
  api.getPaymentMethods.mockResolvedValue([{ id: "pix", name: "PIX" }]);
  api.getCompanies.mockResolvedValue([]);
  api.getAllBankAccounts.mockResolvedValue([]);
  api.checkPayrollPayBatch.mockResolvedValue({ suspeitos: [] });
});
afterEach(() => { vi.useRealTimers(); });

describe("Contas a Pagar — panorama", () => {
  test("a agenda soma o que vence em cada dia e o clique filtra a lista, com pílula para remover", async () => {
    abrir();
    const dia12 = await screen.findByRole("button", { name: /Ver vencimentos de 12\/10: 2 títulos/ });
    expect(screen.getByRole("button", { name: /Ver vencimentos de 11\/10: nada vence/ })).toBeDisabled();

    fireEvent.click(dia12);
    expect(screen.getByRole("button", { name: "Remover filtro Vencimento: 12/10" })).toBeInTheDocument();
    expect(screen.getByText("Ana Fornecedora")).toBeInTheDocument();
    expect(screen.getByText("Beto Distribuidora")).toBeInTheDocument();
    expect(screen.queryByText("Caio Hortifruti")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Vencimento: 12/10" }));
    expect(screen.getByText("Caio Hortifruti")).toBeInTheDocument();
  });

  test("dia fora do período carregado fica desabilitado", async () => {
    abrir();
    await screen.findByRole("button", { name: /Ver vencimentos de 12\/10/ });
    // Mês atual termina em 31/10: o dia 24/10 ainda cobre; já 11/11 nem entra nos 14 dias.
    expect(screen.queryByRole("button", { name: /Ver vencimentos de 11\/11/ })).not.toBeInTheDocument();
  });

  test("a barra mostra o total a pagar e quanto já venceu", async () => {
    abrir();
    const total = await screen.findByLabelText("Total a pagar");
    expect(total).toHaveTextContent("550,00");
    expect(within(total).getByText(/Nada vencido/)).toBeInTheDocument();
  });

  test("Baixar grupo seleciona só os títulos do grupo e abre o lote", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Baixar os 3 títulos de "Próximos 7 dias"/ }));
    const lote = await screen.findByRole("dialog");
    expect(within(lote).getByText("Baixar 3 título(s)")).toBeInTheDocument();
    expect(within(lote).queryByText(/Dora/)).not.toBeInTheDocument();
  });

  test("grupo pode ser recolhido", async () => {
    abrir();
    const alternar = await screen.findByRole("button", { name: "Próximos 7 dias" });
    expect(screen.getByText("Caio Hortifruti")).toBeInTheDocument();
    fireEvent.click(alternar);
    await waitFor(() => expect(screen.queryByText("Caio Hortifruti")).not.toBeInTheDocument());
    expect(alternar).toHaveAttribute("aria-expanded", "false");
  });
});
