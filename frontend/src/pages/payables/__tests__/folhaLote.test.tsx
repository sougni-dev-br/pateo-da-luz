import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

// Contas a Pagar: o título do lote de pagamento da folha é uma linha só ("Folha · lote"),
// expansível com as pessoas; retirar/devolver; a baixa (individual ou em lote) vai para a
// rota do lote, pelo total.
const api = vi.hoisted(() => ({
  getPayablesComLimite: vi.fn(),
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCompanies: vi.fn(),
  getAllBankAccounts: vi.fn(),
  checkPayrollPayBatch: vi.fn(),
  payFolhaLote: vi.fn(),
  payPayrollItem: vi.fn(),
  retirarDoFolhaLote: vi.fn(),
  devolverAoFolhaLote: vi.fn(),
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Payables } from "../../Payables";

const lote = (over: Partial<Payable> = {}): Payable => ({
  id: "l1", purchaseId: null, dueDate: "2026-10-06T00:00:00.000Z", paidDate: null, amount: "2700", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "FOLHA_LOTE", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: "Folha 09/2026 · Pateo Exemplo", purchaseNumber: null, invoiceNumber: null, purchaseDate: null,
  notes: "Folha · lote · 2 pessoa(s)", taxDocumentType: "Folha · lote", taxDescription: "2 pessoa(s)", taxCompanyName: "Folha 09/2026 · Pateo Exemplo",
  taxCompetenceDate: "2026-09-01T00:00:00.000Z", folhaLoteGrupo: "11111111000111",
  loteMembros: [
    { id: "p1", employeeId: "e1", nome: "Ana Exemplo", valor: "1500.00", origem: null, pago: false },
    { id: "p2", employeeId: "e2", nome: "Bruno Exemplo", valor: "1200.00", origem: null, pago: false },
  ],
  ...over,
} as Payable);

const USER = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SESSAO = { user: USER, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><Payables user={USER} /></HideValuesProvider></SessionContext.Provider>,
);

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.getPayablesComLimite.mockResolvedValue({ titulos: [lote()], truncado: false });
  api.getSuppliers.mockResolvedValue([]);
  api.getPaymentMethods.mockResolvedValue([{ id: "pix", name: "PIX" }]);
  api.getCompanies.mockResolvedValue([]);
  api.getAllBankAccounts.mockResolvedValue([]);
  api.checkPayrollPayBatch.mockResolvedValue({ suspeitos: [] });
  api.payFolhaLote.mockResolvedValue({ id: "l1", status: "PAGO", membros: 2, folhaPaga: false });
  api.retirarDoFolhaLote.mockResolvedValue({ aParte: { id: "l9", rotulo: "Folha à parte 09/2026" }, loteCancelado: false });
  api.devolverAoFolhaLote.mockResolvedValue({ destino: { id: "l1", rotulo: "Folha 09/2026 · Pateo Exemplo" }, folhaAParteCancelada: true });
});

describe("título do lote da folha no Contas a Pagar", () => {
  test("uma linha com o selo do lote, expansível com as pessoas e os valores", async () => {
    abrir();
    expect(await screen.findByText("Folha 09/2026 · Pateo Exemplo")).toBeInTheDocument();
    expect(screen.getByText("Folha · lote")).toBeInTheDocument();
    expect(screen.queryByText("Ana Exemplo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ver 2 pessoa(s)" }));
    const pessoas = screen.getByRole("list", { name: "Pessoas em Folha 09/2026 · Pateo Exemplo" });
    expect(within(pessoas).getByText("Ana Exemplo")).toBeInTheDocument();
    expect(within(pessoas).getByText("Bruno Exemplo")).toBeInTheDocument();
  });

  test("retirar uma pessoa chama a rota do lote e recarrega", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "ver 2 pessoa(s)" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirar Ana Exemplo do lote" }));
    await waitFor(() => expect(api.retirarDoFolhaLote).toHaveBeenCalledWith("l1", "p1"));
    expect(await screen.findByText(/foi para "Folha à parte 09\/2026"/)).toBeInTheDocument();
    expect(api.getPayablesComLimite.mock.calls.length).toBeGreaterThan(1);
  });

  test("na folha à parte, devolver em vez de retirar", async () => {
    api.getPayablesComLimite.mockResolvedValue({ titulos: [lote({
      id: "l9", supplierName: "Folha à parte 09/2026", folhaLoteGrupo: "A_PARTE", amount: "1500",
      loteMembros: [{ id: "p1", employeeId: "e1", nome: "Ana Exemplo", valor: "1500", origem: "Folha 09/2026 · Pateo Exemplo", pago: false }],
    })], truncado: false });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "ver 1 pessoa(s)" }));
    expect(screen.getByText(/saiu de Folha 09\/2026 · Pateo Exemplo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirar/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Devolver Ana Exemplo ao lote de origem" }));
    await waitFor(() => expect(api.devolverAoFolhaLote).toHaveBeenCalledWith("l9", "p1"));
  });

  test("pago: sem retirar nem devolver", async () => {
    api.getPayablesComLimite.mockResolvedValue({ titulos: [lote({ status: "PAID", paidDate: "2026-10-01T00:00:00.000Z", paidAmount: "2700" })], truncado: false });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Baixados" }));
    fireEvent.click(await screen.findByRole("button", { name: "ver 2 pessoa(s)" }));
    expect(screen.queryByRole("button", { name: /Retirar/ })).not.toBeInTheDocument();
  });

  test("baixa individual do título vai para a rota do lote, pelo total (valor travado)", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Baixar Folha 09/2026 · Pateo Exemplo" }));
    const janela = screen.getByRole("dialog");
    expect(within(janela).getByLabelText(/Valor pago/)).toHaveAttribute("readonly");
    fireEvent.change(within(janela).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar baixa" }));
    await waitFor(() => expect(api.payFolhaLote).toHaveBeenCalledTimes(1));
    expect(api.payFolhaLote.mock.calls[0][0]).toBe("l1");
    expect(api.payFolhaLote.mock.calls[0][1]).toMatchObject({ paidAmount: 2700, paidPaymentMethodId: "pix" });
    expect(api.payPayrollItem).not.toHaveBeenCalled();
  });

  test("na baixa em lote do Contas a Pagar, o título do lote é um título só", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar Folha 09/2026 · Pateo Exemplo para baixa em lote" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const janela = screen.getByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar baixa de 1" }));
    await waitFor(() => expect(api.payFolhaLote).toHaveBeenCalledTimes(1));
    expect(api.payFolhaLote.mock.calls[0][1]).toMatchObject({ paidAmount: 2700 });
    // A conferência de duplicidade entra pelos salários de dentro do título.
    expect(api.checkPayrollPayBatch).toHaveBeenCalledWith(["p1", "p2"]);
  });
});
