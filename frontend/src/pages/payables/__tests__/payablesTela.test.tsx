import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const lista = (titulos: Payable[], truncado = false) => ({ titulos, truncado });
const ANA = titulo("a", "Ana Fornecedora");
const BETO = titulo("b", "Beto Distribuidora");

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.getPayablesComLimite.mockResolvedValue(lista([ANA, BETO]));
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
    const velha = adiado<{ titulos: Payable[]; truncado: boolean }>();
    api.getPayablesComLimite.mockReset();
    api.getPayablesComLimite
      // Primeira carga: período (lista e resumo) + vencidos de antes do período (lista e resumo).
      .mockImplementationOnce(() => velha.promessa)
      .mockImplementationOnce(() => velha.promessa)
      .mockImplementationOnce(() => velha.promessa)
      .mockImplementationOnce(() => velha.promessa)
      .mockResolvedValue(lista([BETO]));
    abrir();
    await waitFor(() => expect(api.getPayablesComLimite).toHaveBeenCalledTimes(4));
    fireEvent.click(within(screen.getByRole("group", { name: "Atalhos" })).getByRole("button", { name: "Vencidos" }));
    expect(await screen.findByRole("button", { name: "Baixar Beto Distribuidora" })).toBeInTheDocument();
    await act(async () => { velha.resolver(lista([ANA])); });
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

describe("Contas a Pagar — baixa em lote com a data de vencimento de cada título", () => {
  test("avisa a data de hoje com vencido antigo; com a opção, cada vencido baixa na data em que venceu", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const lote = screen.getByRole("dialog");
    expect(within(lote).getByRole("alert")).toHaveTextContent("2 títulos venceram há mais de uma semana — confira a data real do pagamento.");

    fireEvent.click(within(lote).getByRole("radio", { name: /No vencimento de cada título/ }));
    expect(within(lote).queryByText(/venceram há mais de uma semana/)).not.toBeInTheDocument();
    // Todos vencidos: a data única não serve para ninguém e some.
    expect(within(lote).queryByLabelText(/Data do pagamento|ainda não venceram/)).not.toBeInTheDocument();

    // Sem a forma, o aviso aparece ao lado do campo e nada é enviado.
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 2" }));
    expect(within(lote).getByText("Escolha a forma de pagamento.")).toBeInTheDocument();
    expect(within(lote).getByLabelText("Forma de pagamento *")).toHaveFocus();
    expect(api.payInstallment).not.toHaveBeenCalled();

    fireEvent.change(within(lote).getByLabelText("Forma de pagamento *"), { target: { value: "id:pix" } });
    expect(within(lote).queryByText("Escolha a forma de pagamento.")).not.toBeInTheDocument();
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 2" }));
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(2));
    expect(api.payInstallment.mock.calls.map((c) => c[1].paidDate)).toEqual(["2026-09-20", "2026-09-20"]);
  }, 20000);

  test("data apagada no modo vencimento: o campo continua à vista para corrigir", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const lote = screen.getByRole("dialog");
    fireEvent.change(within(lote).getByLabelText("Data do pagamento *"), { target: { value: "" } });
    fireEvent.click(within(lote).getByRole("radio", { name: /No vencimento de cada título/ }));
    expect(within(lote).getByLabelText("Data do pagamento *")).toHaveValue("");
  }, 20000);
});

describe("Contas a Pagar — baixa em lote com a forma de cada título", () => {
  test("cada título vai com a sua forma; o sem forma prevista usa a forma única", async () => {
    api.getPaymentMethods.mockResolvedValue([{ id: "pix", name: "PIX" }, { id: "boleto", name: "BOLETO" }, { id: "boleto2", name: "BOLETO 2X" }]);
    api.getPayablesComLimite.mockResolvedValue(lista([
      titulo("a", "Ana Fornecedora", { paymentMethodId: "boleto2" }),
      titulo("b", "Beto Distribuidora", { paymentMethodId: "pix" }),
      titulo("c", "Caio Hortifruti"),
    ]));
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const lote = screen.getByRole("dialog");

    fireEvent.click(within(lote).getByRole("radio", { name: /A forma de cada título/ }));
    expect(within(lote).getByLabelText("Títulos por forma de pagamento")).toHaveTextContent(/BOLETO 1.*PIX 1.*sem forma prevista 1/);

    // Só o título sem forma prevista precisa da forma única.
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 3" }));
    expect(within(lote).getByText("Escolha a forma de pagamento.")).toBeInTheDocument();
    expect(api.payInstallment).not.toHaveBeenCalled();

    fireEvent.change(within(lote).getByLabelText("Forma dos 1 sem forma prevista *"), { target: { value: "id:pix" } });
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 3" }));
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(3));
    expect(api.payInstallment.mock.calls.map((c) => [c[0], c[1].paidPaymentMethodId])).toEqual([["a", "boleto"], ["b", "pix"], ["c", "pix"]]);
  }, 20000);

  test("todos com forma prevista: a forma única some e nada mais é pedido", async () => {
    api.getPaymentMethods.mockResolvedValue([{ id: "pix", name: "PIX" }, { id: "boleto", name: "BOLETO" }]);
    api.getPayablesComLimite.mockResolvedValue(lista([
      titulo("a", "Ana Fornecedora", { paymentMethodId: "boleto" }),
      titulo("b", "Beto Distribuidora", { paymentMethodName: "PIX / 1x" }),
    ]));
    abrir();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Selecionar todos em aberto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar selecionados" }));
    const lote = screen.getByRole("dialog");
    fireEvent.click(within(lote).getByRole("radio", { name: /A forma de cada título/ }));
    expect(within(lote).queryByLabelText(/Forma de pagamento|sem forma prevista \*/)).not.toBeInTheDocument();
    fireEvent.click(within(lote).getByRole("button", { name: "Confirmar baixa de 2" }));
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(2));
    expect(api.payInstallment.mock.calls.map((c) => c[1].paidPaymentMethodId)).toEqual(["boleto", "pix"]);
  }, 20000);
});

describe("Contas a Pagar — vencidos de antes do período", () => {
  // Juliana (fictícia) venceu em agosto: só vem na busca de vencidos de antes do período.
  const JULIANA = titulo("j", "Juliana Exemplo", { dueDate: "2026-08-10T00:00:00.000Z", amount: "500" });
  const vencidosAntes = (args: Record<string, string>) => args.status === "OVERDUE" && args.endDate !== undefined && args.startDate === undefined;
  beforeEach(() => {
    api.getPayablesComLimite.mockImplementation(async (args: Record<string, string>) =>
      lista(vencidosAntes(args) ? [JULIANA] : [ANA]));
  });
  const cartaoVencido = () => within(screen.getByRole("group", { name: /Resumo financeiro/ })).getByRole("button", { name: /^Vencido/ });

  test("o cartão Vencido não muda ao clicar em Em aberto ou Pago no mês", async () => {
    abrir();
    await waitFor(() => expect(cartaoVencido()).toHaveTextContent("600,00"));
    fireEvent.click(within(screen.getByRole("group", { name: /Resumo financeiro/ })).getByRole("button", { name: /^Em aberto/ }));
    await waitFor(() => expect(screen.getByText(/Mês atual/)).toBeInTheDocument());
    await waitFor(() => expect(cartaoVencido()).toHaveTextContent("600,00"));
    fireEvent.click(within(screen.getByRole("group", { name: /Resumo financeiro/ })).getByRole("button", { name: /^Pago no mês/ }));
    await waitFor(() => expect(screen.getByText(/Pago no mês ·/)).toBeInTheDocument());
    expect(cartaoVencido()).toHaveTextContent("600,00");
  });

  test("Hoje e Próx. 7 dias: só o segundo puxa os vencidos históricos", async () => {
    abrir();
    await screen.findByRole("button", { name: "Baixar Juliana Exemplo" });
    api.getPayablesComLimite.mockClear();
    fireEvent.click(within(screen.getByRole("group", { name: "Atalhos" })).getByRole("button", { name: "Hoje" }));
    await waitFor(() => expect(api.getPayablesComLimite).toHaveBeenCalledTimes(2));
    expect(api.getPayablesComLimite.mock.calls.some((c) => vencidosAntes(c[0]))).toBe(false);
    expect(screen.queryByRole("button", { name: "Baixar Juliana Exemplo" })).not.toBeInTheDocument();

    api.getPayablesComLimite.mockClear();
    fireEvent.click(within(screen.getByRole("group", { name: "Atalhos" })).getByRole("button", { name: "Próx. 7 dias" }));
    expect(await screen.findByRole("button", { name: "Baixar Juliana Exemplo" })).toBeInTheDocument();
    expect(api.getPayablesComLimite.mock.calls.filter((c) => vencidosAntes(c[0]))).toHaveLength(2);
  });
});

describe("Contas a Pagar — limite de segurança da lista", () => {
  test("cabeçalho de lista cortada vira alerta; lista inteira, sem alerta", async () => {
    api.getPayablesComLimite.mockImplementation(async (args: Record<string, string>) => lista([ANA], !args.status));
    abrir();
    expect(await screen.findByText("A lista passou do limite de segurança: refine o período ou os filtros.")).toBeInTheDocument();
    api.getPayablesComLimite.mockResolvedValue(lista([ANA]));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await screen.findByRole("button", { name: "Baixar Ana Fornecedora" });
    expect(screen.queryByText(/limite de segurança/)).not.toBeInTheDocument();
  });
});

describe("Contas a Pagar — PDF financeiro", () => {
  test("duplo clique gera um PDF só", async () => {
    const pdf = adiado<void>();
    api.downloadPayablesFinancialPdf.mockImplementation(() => pdf.promessa);
    abrir();
    await screen.findByRole("button", { name: "Baixar Ana Fornecedora" });
    const botao = screen.getByRole("button", { name: "PDF financeiro" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(api.downloadPayablesFinancialPdf).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Gerando PDF…" })).toBeDisabled();
    await act(async () => { pdf.resolver(); });
    expect(screen.getByRole("button", { name: "PDF financeiro" })).not.toBeDisabled();
  });
});
