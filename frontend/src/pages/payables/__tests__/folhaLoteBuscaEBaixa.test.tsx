import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, MembroFolhaLote, Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

// Título do lote da folha no Contas a Pagar: a busca e o filtro de tipo de salário acham o
// título pelo que está dentro dele; o atalho "Folha" limpa o que outro atalho deixou; a baixa
// individual já vem com a empresa do título; a duplicidade lista todos os membros suspeitos
// e confirma só os ids deles.
const api = vi.hoisted(() => ({
  getPayablesComLimite: vi.fn(),
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCompanies: vi.fn(),
  getAllBankAccounts: vi.fn(),
  checkPayrollPayBatch: vi.fn(),
  payFolhaLote: vi.fn(),
  payPayrollItem: vi.fn(),
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { ApiError } from "../../../api/client";
import { Payables } from "../../Payables";
import { combinaSubtipo } from "../regras";

const DOIS: MembroFolhaLote[] = [
  { id: "p1", employeeId: "e1", nome: "Ana Exemplo", valor: "1500.00", origem: null, pago: false, tipo: "Salário" },
  { id: "p2", employeeId: "e2", nome: "Bruno Exemplo", valor: "1200.00", origem: null, pago: false, tipo: "Salário" },
];
const lote = (over: Partial<Payable> = {}): Payable => ({
  id: "l1", purchaseId: null, dueDate: "2026-10-06T00:00:00.000Z", paidDate: null, amount: "2700", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "FOLHA_LOTE", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: "Folha 09/2026 · Pateo Exemplo", purchaseNumber: null, invoiceNumber: null, purchaseDate: null,
  notes: "Folha · lote · 2 pessoa(s)", taxDocumentType: "Folha · lote", taxDescription: "2 pessoa(s)", taxCompanyName: "Folha 09/2026 · Pateo Exemplo",
  taxCompetenceDate: "2026-09-01T00:00:00.000Z", folhaLoteGrupo: "11111111000111", loteMembros: DOIS,
  ...over,
} as Payable);
const TITULO = "Folha 09/2026 · Pateo Exemplo";

const USER = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SESSAO = { user: USER, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><Payables user={USER} /></HideValuesProvider></SessionContext.Provider>,
);

const resumo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, tipo: "SALARIO", tipoRotulo: "Salário", rotulo: "Extrato 09/2026", competencia: "09/2026", inicioPeriodo: null,
  valor: 100, valorPago: 100, status: "PAID", vencimento: null, pagoEm: "2026-09-30", ...extra,
});
const suspeito = (id: string, pessoa: string) => ({
  item: resumo(id, { status: "PENDING", pagoEm: null, valorPago: null }), pessoa, jaPagos: [resumo(`x${id}`)], noLote: [],
});

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
});

async function baixarIndividual() {
  fireEvent.click(await screen.findByRole("button", { name: `Baixar ${TITULO}` }));
  const janela = screen.getByRole("dialog");
  fireEvent.change(within(janela).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
  return janela;
}

async function baixarSelecionado() {
  fireEvent.click(await screen.findByRole("checkbox", { name: `Selecionar ${TITULO} para baixa em lote` }));
  fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
  const janela = screen.getByRole("dialog");
  fireEvent.change(within(janela).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
  fireEvent.click(within(janela).getByRole("button", { name: "Confirmar baixa de 1" }));
  return janela;
}

describe("busca e filtro pelo que está dentro do título", () => {
  test("busca pelo nome e pelo valor de um membro", async () => {
    abrir();
    await screen.findByText(TITULO);
    const busca = screen.getByRole("searchbox", { name: "Buscar títulos" });
    fireEvent.change(busca, { target: { value: "bruno" } });
    expect(screen.getByText(TITULO)).toBeInTheDocument();
    fireEvent.change(busca, { target: { value: "1500" } });
    expect(screen.getByText(TITULO)).toBeInTheDocument();
    fireEvent.change(busca, { target: { value: "ninguem-assim" } });
    expect(screen.queryByText(TITULO)).not.toBeInTheDocument();
  });

  test("subtipos Salário CLT e Salário (acerto) trazem o título com esse tipo de salário", () => {
    const clt = lote();
    const acerto = lote({ loteMembros: [{ ...DOIS[0], tipo: "Salário (acerto)" }] });
    const semTipo = lote({ loteMembros: [{ ...DOIS[0], tipo: undefined }] });
    expect(combinaSubtipo(clt, "PAYROLL:Salário")).toBe(true);
    expect(combinaSubtipo(clt, "PAYROLL:Salário (acerto)")).toBe(false);
    expect(combinaSubtipo(acerto, "PAYROLL:Salário (acerto)")).toBe(true);
    expect(combinaSubtipo(acerto, "PAYROLL:Salário")).toBe(false);
    // Membro sem o tipo (resposta antiga): o título entra nos dois.
    expect(combinaSubtipo(semTipo, "PAYROLL:Salário")).toBe(true);
    expect(combinaSubtipo(semTipo, "PAYROLL:Salário (acerto)")).toBe(true);
    expect(combinaSubtipo(clt, "PAYROLL:Vale-transporte")).toBe(false);
  });
});

describe("atalho Folha", () => {
  test("vindo de Boleto: limpa a forma de pagamento e recarrega", async () => {
    api.getPaymentMethods.mockResolvedValue([{ id: "bol", name: "BOLETO" }, { id: "pix", name: "PIX" }]);
    abrir();
    await screen.findByText(TITULO);
    fireEvent.click(screen.getByRole("button", { name: "Boleto" }));
    await waitFor(() => expect(api.getPayablesComLimite.mock.calls.some((c) => c[0].paymentMethodId === "bol")).toBe(true));
    const antes = api.getPayablesComLimite.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Folha" }));
    await waitFor(() => expect(api.getPayablesComLimite.mock.calls.length).toBeGreaterThan(antes));
    expect(api.getPayablesComLimite.mock.calls.slice(antes).every((c) => !c[0].paymentMethodId)).toBe(true);
    expect(await screen.findByText(TITULO)).toBeInTheDocument();
  });
});

describe("baixa do título", () => {
  test("individual: já vem com a empresa do título e a conta dela", async () => {
    api.getCompanies.mockResolvedValue([{ id: "emp1", tradeName: "Pateo Exemplo", isActive: true }]);
    api.getAllBankAccounts.mockImplementation(async (id: string) => [{ id: `conta-${id}`, name: `Conta ${id}` }]);
    api.getPayablesComLimite.mockResolvedValue({ titulos: [lote({ companyId: "emp1" })], truncado: false });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: `Baixar ${TITULO}` }));
    const janela = screen.getByRole("dialog");
    await waitFor(() => expect(within(janela).getByLabelText("Empresa pagadora")).toHaveValue("emp1"));
    await waitFor(() => expect(within(janela).getByLabelText("Conta bancária")).toHaveValue("conta-emp1"));
  });

  test("individual com duplicidade: lista todos os membros e confirma pelos ids deles", async () => {
    api.payFolhaLote.mockRejectedValueOnce(new ApiError("dup", 409, {
      code: "BAIXA_DUPLICADA",
      message: `2 pessoa(s) do título "${TITULO}" já têm este pagamento feito em outro lançamento: Ana Exemplo, Bruno Exemplo. Baixar mesmo assim?`,
      suspeitos: [suspeito("p1", "Ana Exemplo"), suspeito("p2", "Bruno Exemplo")],
    }));
    abrir();
    const janela = await baixarIndividual();
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar baixa" }));
    const lista = await screen.findByRole("list", { name: "Pessoas com o pagamento já feito" });
    expect(within(lista).getByText(/Ana Exemplo/)).toBeInTheDocument();
    expect(within(lista).getByText(/Bruno Exemplo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Baixar mesmo assim" }));
    await waitFor(() => expect(api.payFolhaLote).toHaveBeenCalledTimes(2));
    expect(api.payFolhaLote.mock.calls[1][1]).toMatchObject({ confirmaDuplicidadeIds: ["p1", "p2"] });
    expect(api.payFolhaLote.mock.calls[1][1]).not.toHaveProperty("confirmaDuplicidade");
  });

  test("em lote: confere os membros do título e confirma só os suspeitos", async () => {
    api.checkPayrollPayBatch.mockResolvedValue({ suspeitos: [suspeito("p2", "Bruno Exemplo")] });
    abrir();
    const janela = await baixarSelecionado();
    await waitFor(() => expect(api.checkPayrollPayBatch).toHaveBeenCalledWith(["p1", "p2"]));
    fireEvent.click(await within(janela).findByRole("button", { name: "Baixar mesmo assim" }));
    await waitFor(() => expect(api.payFolhaLote).toHaveBeenCalledTimes(1));
    expect(api.payFolhaLote.mock.calls[0][1]).toMatchObject({ confirmaDuplicidadeIds: ["p2"] });
  });

  test("em lote: tirar o suspeito tira o título inteiro", async () => {
    api.checkPayrollPayBatch.mockResolvedValue({ suspeitos: [suspeito("p2", "Bruno Exemplo")] });
    abrir();
    const janela = await baixarSelecionado();
    fireEvent.click(await within(janela).findByRole("button", { name: "Tirar este do lote" }));
    expect(await screen.findByText(/nada foi baixado/)).toBeInTheDocument();
    expect(api.payFolhaLote).not.toHaveBeenCalled();
  });
});
