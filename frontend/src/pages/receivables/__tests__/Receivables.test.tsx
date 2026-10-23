import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, ReceivableDetail, ReceivableSummary, ReceivableView } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

const api = vi.hoisted(() => ({
  getReceivables: vi.fn(),
  getReceivableSummary: vi.fn(),
  getReceivableDetail: vi.fn(),
  markReceivableReceived: vi.fn(),
  cancelReceivable: vi.fn(),
  createReceivable: vi.fn(),
  reverseReceivableReceipt: vi.fn()
}));
vi.mock("../../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Receivables } from "../../Receivables";

function conta(id: string, over: Partial<ReceivableView> = {}): ReceivableView {
  return {
    id, companyId: null, companyName: null, sourceType: "KEETA_SETTLEMENT", sourceRef: null, ifoodSettlementId: null,
    customerName: null, customerDocument: null, description: `Fatura ${id}`, competenceYear: 2026, competenceMonth: 10,
    expectedDate: "2026-10-23", receivedDate: null, grossAmount: 1000, fees: 100, netAmount: 900, paidAmount: null, remainingAmount: 900,
    paymentMethod: null, bankAccountId: null, installmentNumber: null, totalInstallments: null, parentReceivableId: null,
    status: "OPEN", notes: null, cancelledAt: null, cancellationReason: null, daysUntilExpected: 0, isLate: false,
    createdAt: "2026-10-01T00:00:00.000Z", ...over
  };
}

const ATRASADA = conta("atrasada", { description: "Repasse iFood semana 1", sourceType: "IFOOD_SETTLEMENT", expectedDate: "2026-10-20", daysUntilExpected: -3, isLate: true, netAmount: 500, remainingAmount: 500 });
const HOJE = conta("hoje", { description: "Fatura Keeta semana 4", expectedDate: "2026-10-23", netAmount: 900, remainingAmount: 900 });
const PARCIAL = conta("parcial", { description: "Evento de formatura", sourceType: "EVENT", customerName: "Colégio Exemplo", expectedDate: "2026-10-28", daysUntilExpected: 5, status: "PARTIALLY_RECEIVED", netAmount: 1000, paidAmount: 400, remainingAmount: 600 });

const RESUMO: ReceivableSummary = {
  today: "2026-10-23",
  overdue: { count: 1, amount: 500 },
  dueToday: { count: 1, amount: 900 },
  next7: { count: 2, amount: 1500 },
  next30: { count: 2, amount: 1500 },
  pending: { count: 3, amount: 2000 },
  receivedThisMonth: { count: 4, amount: 3210.5 }
};

const ADMIN = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;
const SO_VER = { id: "v", name: "Visitante", role: "VISUALIZACAO", modulePermissions: { receivables: { view: true } } } as unknown as AppUser;
const sessao = (user: AppUser) => ({ user, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true }) as unknown as SessionContextValue;
const abrir = (user: AppUser = ADMIN) => render(
  <SessionContext.Provider value={sessao(user)}><HideValuesProvider><Receivables user={user} /></HideValuesProvider></SessionContext.Provider>
);

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 9, 0));
  api.getReceivableSummary.mockResolvedValue(RESUMO);
  api.getReceivables.mockImplementation(async (f: { status?: string }) => (f.status === "PENDING" ? [ATRASADA, HOJE, PARCIAL] : []));
  api.markReceivableReceived.mockResolvedValue(HOJE);
  api.cancelReceivable.mockResolvedValue(HOJE);
});
afterEach(() => { vi.useRealTimers(); });

describe("Contas a Receber — panorama e lista", () => {
  test("mostra o total a receber, o atrasado e os grupos por urgência", async () => {
    abrir();
    const total = await screen.findByLabelText("Total a receber");
    expect(total).toHaveTextContent("2.000,00");
    expect(within(total).getByText(/estão atrasados \(25% do total\)/)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: /Atrasadas/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Previstas para hoje/ })).toBeInTheDocument();
    expect(screen.getByText("Repasse iFood semana 1")).toBeInTheDocument();
    expect(screen.getByText("Evento de formatura")).toBeInTheDocument();
    expect(screen.getByText("a receber de", { exact: false })).toBeInTheDocument();
  });

  test("pede só o que falta receber na abertura (não o histórico inteiro)", async () => {
    abrir();
    await screen.findByText("Repasse iFood semana 1");
    expect(api.getReceivables).toHaveBeenCalledTimes(1);
    expect(api.getReceivables).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING", limit: 1000 }));
  });

  test("o cartão Atrasadas filtra a lista e a pílula remove o filtro", async () => {
    abrir();
    await screen.findByText("Repasse iFood semana 1");
    fireEvent.click(within(screen.getByRole("group", { name: /Totais/ })).getByRole("button", { name: /^Atrasadas/ }));

    expect(screen.getByText("Repasse iFood semana 1")).toBeInTheDocument();
    expect(screen.queryByText("Fatura Keeta semana 4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Atrasadas" }));
    expect(screen.getByText("Fatura Keeta semana 4")).toBeInTheDocument();
  });

  test("a agenda filtra pelo dia e as plataformas viram filtros com contagem", async () => {
    abrir();
    await screen.findByText("Repasse iFood semana 1");
    fireEvent.click(screen.getByRole("button", { name: /Ver recebimentos previstos para 28\/10: 1 conta/ }));
    expect(screen.getByText("Evento de formatura")).toBeInTheDocument();
    expect(screen.queryByText("Repasse iFood semana 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Remover filtro do dia/ }));

    const plataformas = screen.getByRole("group", { name: "Plataforma" });
    fireEvent.click(within(plataformas).getByRole("button", { name: /^iFood/ }));
    expect(screen.getByText("Repasse iFood semana 1")).toBeInTheDocument();
    expect(screen.queryByText("Fatura Keeta semana 4")).not.toBeInTheDocument();
  });

  test("busca por cliente e por valor; a tecla / leva o foco à busca", async () => {
    abrir();
    await screen.findByText("Repasse iFood semana 1");
    const busca = screen.getByRole("searchbox", { name: "Buscar contas a receber" });

    fireEvent.keyDown(window, { key: "/" });
    expect(busca).toHaveFocus();

    fireEvent.change(busca, { target: { value: "colegio" } });
    expect(screen.getByText("Evento de formatura")).toBeInTheDocument();
    expect(screen.queryByText("Fatura Keeta semana 4")).not.toBeInTheDocument();

    fireEvent.change(busca, { target: { value: "500" } });
    expect(screen.getByText("Repasse iFood semana 1")).toBeInTheDocument();
    expect(screen.queryByText("Evento de formatura")).not.toBeInTheDocument();
  });

  test("a vista Recebidas busca o histórico do mês pela data do recebimento", async () => {
    api.getReceivables.mockImplementation(async (f: { status?: string }) =>
      f.status === "PENDING" ? [HOJE] : [conta("pago", { description: "Fatura paga", status: "RECEIVED", receivedDate: "2026-10-05", paidAmount: 900, remainingAmount: 0 })]);
    abrir();
    await screen.findByText("Fatura Keeta semana 4");

    fireEvent.click(screen.getByRole("button", { name: "Recebidas" }));

    expect(await screen.findByText("Fatura paga")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /outubro de 2026/ })).toBeInTheDocument();
    expect(api.getReceivables).toHaveBeenCalledWith(expect.objectContaining({ status: "RECEIVED", dateField: "received", startDate: "2026-10-01", endDate: "2026-10-31" }));
  });

  test("falha de carga mostra o erro com 'Tentar de novo'", async () => {
    api.getReceivableSummary.mockRejectedValueOnce(new Error("Servidor fora do ar"));
    abrir();
    expect(await screen.findByText("Servidor fora do ar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByText("Repasse iFood semana 1")).toBeInTheDocument();
  });

  test("lista vazia explica o que aparece aqui", async () => {
    api.getReceivables.mockResolvedValue([]);
    abrir();
    expect(await screen.findByText("Tudo recebido: nada a receber agora.")).toBeInTheDocument();
  });
});

describe("Contas a Receber — registrar recebimento", () => {
  test("a janela vem com o saldo, registra e recarrega a lista", async () => {
    abrir();
    await screen.findByText("Evento de formatura");
    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento de Evento de formatura" }));

    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByLabelText(/Valor recebido/)).toHaveValue("600,00");
    expect(within(janela).getByLabelText(/Data do recebimento/)).toHaveValue("2026-10-23");
    expect(within(janela).getByText(/Isso quita a conta/)).toBeInTheDocument();

    fireEvent.change(within(janela).getByLabelText(/Valor recebido/), { target: { value: "300" } });
    expect(within(janela).getByText(/ficam a receber/)).toBeInTheDocument();
    fireEvent.change(within(janela).getByLabelText(/Valor recebido/), { target: { value: "60000" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar recebimento" }));

    await waitFor(() => expect(api.markReceivableReceived).toHaveBeenCalledWith("parcial", expect.objectContaining({
      receivedDate: "2026-10-23", paidAmount: 600, paymentMethod: "PIX", differenceReason: null
    })));
    expect(await screen.findByText("Recebimento registrado: Evento de formatura")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.getReceivables.mock.calls.length).toBeGreaterThan(1);
  });

  test("valor acima do saldo só confirma com o motivo da diferença", async () => {
    abrir();
    await screen.findByText("Fatura Keeta semana 4");
    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento de Fatura Keeta semana 4" }));
    const janela = await screen.findByRole("dialog");

    fireEvent.change(within(janela).getByLabelText(/Valor recebido/), { target: { value: "90100" } });
    const confirmar = within(janela).getByRole("button", { name: "Confirmar recebimento" });
    expect(confirmar).toBeDisabled();

    fireEvent.change(within(janela).getByLabelText(/Motivo da diferença/), { target: { value: "ajuste da plataforma" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.markReceivableReceived).toHaveBeenCalledWith("hoje", expect.objectContaining({ paidAmount: 901, differenceReason: "ajuste da plataforma" })));
  });

  test("data futura e valor zero bloqueiam a confirmação", async () => {
    abrir();
    await screen.findByText("Fatura Keeta semana 4");
    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento de Fatura Keeta semana 4" }));
    const janela = await screen.findByRole("dialog");
    const confirmar = within(janela).getByRole("button", { name: "Confirmar recebimento" });

    fireEvent.change(within(janela).getByLabelText(/Data do recebimento/), { target: { value: "2026-10-24" } });
    expect(confirmar).toBeDisabled();
    expect(within(janela).getByText("A data não pode ser futura.")).toBeInTheDocument();

    fireEvent.change(within(janela).getByLabelText(/Data do recebimento/), { target: { value: "2026-10-23" } });
    fireEvent.change(within(janela).getByLabelText(/Valor recebido/), { target: { value: "" } });
    expect(confirmar).toBeDisabled();
  });

  test("erro do servidor aparece dentro da janela e ela continua aberta", async () => {
    api.markReceivableReceived.mockRejectedValueOnce(new Error("Esta conta já foi recebida."));
    abrir();
    await screen.findByText("Fatura Keeta semana 4");
    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento de Fatura Keeta semana 4" }));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar recebimento" }));

    expect(await within(janela).findByText("Esta conta já foi recebida.")).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: "Confirmar recebimento" })).toBeEnabled();
  });

  test("receber em lote soma os saldos selecionados e registra cada conta", async () => {
    abrir();
    await screen.findByText("Fatura Keeta semana 4");
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Fatura Keeta semana 4 para receber em lote" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Evento de formatura para receber em lote" }));
    const barra = screen.getByRole("region", { name: "Contas selecionadas" });
    expect(barra).toHaveTextContent("2 selecionada(s)");
    expect(barra).toHaveTextContent("1.500,00");

    fireEvent.click(within(barra).getByRole("button", { name: /Receber selecionadas/ }));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar recebimentos" }));

    await waitFor(() => expect(api.markReceivableReceived).toHaveBeenCalledTimes(2));
    expect(api.markReceivableReceived).toHaveBeenCalledWith("hoje", expect.objectContaining({ paidAmount: 900, receivedDate: "2026-10-23" }));
    expect(api.markReceivableReceived).toHaveBeenCalledWith("parcial", expect.objectContaining({ paidAmount: 600 }));
    expect(await screen.findByText("2 recebimentos registrados.")).toBeInTheDocument();
  });
});

describe("Contas a Receber — cancelar, detalhe e permissões", () => {
  test("cancelar exige motivo e só existe para conta sem recebimento", async () => {
    abrir();
    await screen.findByText("Fatura Keeta semana 4");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mais ações de Evento de formatura" }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: /Cancelar conta/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: /Recebimentos e estorno/ })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mais ações de Fatura Keeta semana 4" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Cancelar conta/ }));

    const janela = await screen.findByRole("dialog");
    const confirmar = within(janela).getByRole("button", { name: "Cancelar conta" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(janela).getByLabelText(/Motivo do cancelamento/), { target: { value: "ab" } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(janela).getByLabelText(/Motivo do cancelamento/), { target: { value: "lançada em duplicidade" } });
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.cancelReceivable).toHaveBeenCalledWith("hoje", "lançada em duplicidade"));
    expect(await screen.findByText("Conta cancelada: Fatura Keeta semana 4")).toBeInTheDocument();
  });

  test("o detalhe mostra a composição do valor e permite estornar um recebimento", async () => {
    const detalhe: ReceivableDetail = {
      ...PARCIAL, grossAmount: 1100, fees: 100,
      receipts: [{ id: "rc1", receivedDate: "2026-10-10", amount: 400, paymentMethod: "PIX", bankAccountId: null, notes: null, createdByUserId: "u", createdAt: "2026-10-10T12:00:00.000Z", reversedAt: null, reversalReason: null, legacy: false }]
    };
    api.getReceivableDetail.mockResolvedValue(detalhe);
    api.reverseReceivableReceipt.mockResolvedValue(PARCIAL);
    abrir();
    await screen.findByText("Evento de formatura");

    fireEvent.click(screen.getByRole("button", { name: "Ver detalhes de Evento de formatura" }));
    const janela = await screen.findByRole("dialog");
    const composicao = await within(janela).findByRole("group", { name: "Composição do valor" });
    expect(composicao).toHaveTextContent("Taxas (9,1%)");
    expect(composicao).toHaveTextContent("Falta receber");
    expect(within(janela).getByText(/em 10\/10\/2026 · PIX/)).toBeInTheDocument();

    fireEvent.click(within(janela).getByRole("button", { name: /Estornar recebimento de 400,00 reais/ }));
    const dialogos = await screen.findAllByRole("dialog");
    const estorno = dialogos[dialogos.length - 1];
    fireEvent.change(within(estorno).getByLabelText(/Motivo do estorno/), { target: { value: "valor digitado errado" } });
    fireEvent.click(within(estorno).getByRole("button", { name: "Confirmar estorno" }));

    await waitFor(() => expect(api.reverseReceivableReceipt).toHaveBeenCalledWith("parcial", "rc1", "valor digitado errado"));
  });

  test("quem só visualiza não vê Receber, Nova conta, seleção nem cancelar", async () => {
    abrir(SO_VER);
    await screen.findByText("Fatura Keeta semana 4");
    expect(screen.queryByRole("button", { name: /Nova conta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar recebimento de/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mais ações de/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver detalhes de Fatura Keeta semana 4" })).toBeInTheDocument();
  });

  test("Nova conta lança um evento com o líquido calculado", async () => {
    api.createReceivable.mockResolvedValue(conta("nova"));
    abrir();
    await screen.findByText("Fatura Keeta semana 4");
    fireEvent.click(screen.getByRole("button", { name: /Nova conta/ }));
    const janela = await screen.findByRole("dialog");

    expect(within(janela).getByRole("button", { name: "Lançar conta" })).toBeDisabled();
    fireEvent.change(within(janela).getByLabelText(/Descrição/), { target: { value: "Evento de fim de ano" } });
    fireEvent.change(within(janela).getByLabelText(/Valor \(R\$\)/), { target: { value: "100000" } });
    fireEvent.change(within(janela).getByLabelText(/Taxas/), { target: { value: "10000" } });
    expect(within(janela).getByText(/Você vai receber/)).toHaveTextContent("900,00");
    fireEvent.click(within(janela).getByRole("button", { name: "Lançar conta" }));

    await waitFor(() => expect(api.createReceivable).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "EVENT", description: "Evento de fim de ano", grossAmount: 1000, fees: 100, netAmount: 900, expectedDate: "2026-10-23"
    })));
  });
});
