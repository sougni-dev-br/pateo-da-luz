import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

const api = vi.hoisted(() => ({
  getPayables: vi.fn(),
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCompanies: vi.fn(),
  getAllBankAccounts: vi.fn(),
  payInstallment: vi.fn(),
  checkPayrollPayBatch: vi.fn(),
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Payables } from "../../Payables";

const titulo = (id: string, nome: string, over: Partial<Payable> = {}): Payable => ({
  id, purchaseId: "c" + id, dueDate: "2026-09-20T00:00:00.000Z", paidDate: null, amount: "100", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "PURCHASE", status: "OVERDUE", rawValue: null,
  supplierId: null, supplierName: nome, purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
  ...over,
} as Payable);

const USER = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SESSAO = { user: USER, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><Payables user={USER} /></HideValuesProvider></SessionContext.Provider>,
);

function adiado<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => { resolver = r; });
  return { promessa, resolver };
}

const ANA = titulo("a", "Ana Fornecedora");
const BETO = titulo("b", "Beto Distribuidora");

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.getPayables.mockResolvedValue([ANA, BETO]);
  api.getSuppliers.mockResolvedValue([]);
  api.getPaymentMethods.mockResolvedValue([{ id: "pix", name: "PIX" }]);
  api.getCompanies.mockResolvedValue([
    { id: "emp1", tradeName: "Pateo Frei", isActive: true },
    { id: "emp2", tradeName: "Pateo Peposo", isActive: true },
  ]);
  api.getAllBankAccounts.mockImplementation(async (id: string) => [{ id: `conta-${id}`, name: `Conta ${id}` }]);
  api.payInstallment.mockResolvedValue({});
  api.checkPayrollPayBatch.mockResolvedValue({ suspeitos: [] });
});
afterEach(() => { vi.useRealTimers(); });

describe("Contas a Pagar — baixa em lote não herda a baixa individual", () => {
  test("lote abre limpo (data de hoje, sem forma, empresa, conta e observação) e não envia a conta herdada", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Baixar Ana Fornecedora" }));
    const individual = screen.getByRole("dialog");
    fireEvent.change(within(individual).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
    fireEvent.change(within(individual).getByLabelText("Observação"), { target: { value: "pago no caixa" } });
    fireEvent.change(within(individual).getByLabelText("Empresa pagadora"), { target: { value: "emp1" } });
    await waitFor(() => expect(within(individual).getByLabelText("Conta bancária")).toHaveValue("conta-emp1"));
    fireEvent.change(within(individual).getByLabelText("Data do pagamento *"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(individual).getByRole("button", { name: "Fechar (Esc)" }));

    // Muda o relógio depois que o módulo carregou: a data do lote é a de agora.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 2, 0, 30));
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Beto Distribuidora para baixa em lote" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const lote = screen.getByRole("dialog");
    expect(within(lote).getByLabelText("Data do pagamento *")).toHaveValue("2026-10-02");
    expect(within(lote).getByLabelText("Forma de pagamento *")).toHaveValue("");
    expect(within(lote).getByLabelText("Observação")).toHaveValue("");
    expect(within(lote).getByLabelText("Empresa pagadora")).toHaveValue("");

    fireEvent.change(within(lote).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 1" }));
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(1));
    expect(api.payInstallment.mock.calls[0][1]).toMatchObject({
      paidDate: "2026-10-02", payingCompanyId: null, companyBankAccountId: null, paymentNotes: null,
    });
  }, 20000);
});

describe("Contas a Pagar — respostas fora de ordem", () => {
  test("carga antiga que chega depois não sobrescreve a nova", async () => {
    const velha = adiado<Payable[]>();
    api.getPayables.mockReset();
    api.getPayables
      .mockImplementationOnce(() => velha.promessa)
      .mockImplementationOnce(() => velha.promessa)
      .mockResolvedValue([BETO]);
    abrir();
    await waitFor(() => expect(api.getPayables).toHaveBeenCalledTimes(2));
    fireEvent.click(within(screen.getByRole("group", { name: "Atalhos" })).getByRole("button", { name: "Vencidos" }));
    expect(await screen.findByRole("button", { name: "Baixar Beto Distribuidora" })).toBeInTheDocument();
    await act(async () => { velha.resolver([ANA]); });
    expect(screen.queryByRole("button", { name: "Baixar Ana Fornecedora" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar Beto Distribuidora" })).toBeInTheDocument();
  });

  test("contas de uma empresa que deixou de ser a escolhida são ignoradas", async () => {
    const contasEmp1 = adiado<Array<{ id: string; name: string }>>();
    api.getAllBankAccounts.mockImplementation((id: string) =>
      id === "emp1" ? contasEmp1.promessa : Promise.resolve([{ id: "conta-emp2", name: "Conta emp2" }]));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Baixar Ana Fornecedora" }));
    const janela = screen.getByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Empresa pagadora"), { target: { value: "emp1" } });
    fireEvent.change(within(janela).getByLabelText("Empresa pagadora"), { target: { value: "emp2" } });
    await waitFor(() => expect(within(janela).getByLabelText("Conta bancária")).toHaveValue("conta-emp2"));
    await act(async () => { contasEmp1.resolver([{ id: "conta-emp1", name: "Conta emp1" }]); });
    expect(within(janela).getByLabelText("Conta bancária")).toHaveValue("conta-emp2");
    expect(within(janela).queryByRole("option", { name: "Conta emp1" })).not.toBeInTheDocument();
  });
});

describe("Contas a Pagar — selecionar todos só pega o que está na tela", () => {
  test("filtrar tira da seleção o que sumiu; marcar todos marca só os visíveis", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    expect(screen.getByRole("region", { name: "Títulos selecionados" })).toHaveTextContent("2 selecionado(s)");

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar títulos" }), { target: { value: "beto" } });
    // Ana sumiu da tela: sai da seleção.
    await waitFor(() => expect(screen.getByRole("region", { name: "Títulos selecionados" })).toHaveTextContent("1 selecionado(s)"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar títulos" }), { target: { value: "" } });
    expect(screen.getByRole("region", { name: "Títulos selecionados" })).toHaveTextContent("1 selecionado(s)");

    // Com um oculto selecionado antes, o "todos" compara com os visíveis (não com o tamanho do conjunto).
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    expect(screen.getByRole("region", { name: "Títulos selecionados" })).toHaveTextContent("2 selecionado(s)");
    expect(screen.getByRole("checkbox", { name: /Selecionar todos em aberto/ })).toBeChecked();
  });
});
