import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { InstallmentPlanDetail } from "../../../api/client";

// Dados fictícios.

const api = vi.hoisted(() => ({
  getInstallmentPlans: vi.fn(),
  getInstallmentPlan: vi.fn(),
  createInstallmentPlan: vi.fn(),
  renegotiateInstallmentPlan: vi.fn(),
  cancelInstallmentPlan: vi.fn(),
  payInstallment: vi.fn(),
  getSuppliers: vi.fn(),
  getCompanies: vi.fn(),
  getPaymentMethods: vi.fn(),
  getProducts: vi.fn()
}));
vi.mock("../../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../api/client")>()), ...api }));
vi.mock("../../../context/SessionContext", () => ({ useSession: () => ({ user: { id: "u1", role: "ADMIN", permissions: {} } }) }));
vi.mock("../../../lib/permissions", () => ({ hasPermission: () => true }));

import { HideValuesProvider } from "../../../design-system";
import { Parcelamentos } from "../../Parcelamentos";
import { DetalheParcelamento } from "../DetalheParcelamento";
import { FormularioParcelamento } from "../FormularioParcelamento";

const tela = (ui: React.ReactElement) => render(<HideValuesProvider><MemoryRouter>{ui}</MemoryRouter></HideValuesProvider>);

const emDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

const resumo = { total: 3, pagas: 1, abertas: 2, atrasadas: 1, canceladas: 0, valorPago: 100, saldoAberto: 200, proximoVencimento: "2026-11-10", quitado: false };

const plano = (over: Partial<InstallmentPlanDetail> = {}): InstallmentPlanDetail => ({
  id: "pl1", description: "Acordo fictício", supplierId: "s1", supplierName: "Fornecedor Fictício", companyId: "c1", productId: "p1",
  status: "ACTIVE", excludeFromDre: false, totalAmount: 300, installmentCount: 3, renegotiatedFromId: null, notes: null, resumo,
  parcelas: [
    { purchaseId: "a", installmentId: "i1", numero: 1, amount: 100, paidAmount: 100, dueDate: "2026-10-10", paidDate: "2026-10-09", situacao: "PAGA" },
    { purchaseId: "b", installmentId: "i2", numero: 2, amount: 100, paidAmount: null, dueDate: emDias(10), paidDate: null, situacao: "ABERTA" },
    { purchaseId: "c", installmentId: "i3", numero: 3, amount: 100, paidAmount: null, dueDate: emDias(90), paidDate: null, situacao: "ABERTA" }
  ],
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuppliers.mockResolvedValue([{ id: "s1", name: "Fornecedor Fictício" }]);
  api.getCompanies.mockResolvedValue([{ id: "c1", tradeName: "Empresa Teste" }]);
  api.getPaymentMethods.mockResolvedValue([{ id: "m1", name: "BOLETO" }]);
  api.getProducts.mockResolvedValue({ items: [] });
  api.getInstallmentPlan.mockResolvedValue(plano());
});

describe("Parcelamentos (lista)", () => {
  test("mostra andamento, saldo e atraso do parcelamento", async () => {
    api.getInstallmentPlans.mockResolvedValue([{ id: "pl1", description: "Acordo fictício", supplierName: "Fornecedor Fictício", status: "ACTIVE", excludeFromDre: false, totalAmount: 300, installmentCount: 3, createdAt: "2026-10-01", resumo }]);
    tela(<Parcelamentos />);
    expect((await screen.findAllByText("Acordo fictício")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 de 3 pagas · faltam 2 · 1 em atraso/).length).toBeGreaterThan(0);
  });

  test("lista vazia oferece criar o primeiro", async () => {
    api.getInstallmentPlans.mockResolvedValue([]);
    tela(<Parcelamentos />);
    expect(await screen.findByText("Nenhum parcelamento.")).toBeInTheDocument();
  });
});

describe("FormularioParcelamento", () => {
  const abrir = (onEnviar = vi.fn()) => tela(<FormularioParcelamento modo="renegociar" saldo={200} busy={false} erro={null} onVoltar={() => undefined} onEnviar={onEnviar} />);

  test("gera a prévia e só libera o envio com o motivo", async () => {
    const onEnviar = vi.fn();
    abrir(onEnviar);
    fireEvent.change(screen.getByPlaceholderText("12"), { target: { value: "2" } });
    expect(await screen.findByLabelText("Valor da parcela 2")).toHaveValue("100,00");
    const enviar = screen.getByRole("button", { name: "Renegociar saldo" });
    expect(enviar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Motivo da renegociação/), { target: { value: "novo acordo" } });
    await waitFor(() => expect(enviar).toBeEnabled());
    fireEvent.click(enviar);
    expect(onEnviar).toHaveBeenCalledWith(expect.objectContaining({ total: 200, quantidade: 2, motivo: "novo acordo" }));
  });

  test("bloqueia quando a soma das parcelas não fecha o total", async () => {
    abrir();
    fireEvent.change(screen.getByPlaceholderText("12"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Motivo da renegociação/), { target: { value: "novo acordo" } });
    fireEvent.change(await screen.findByLabelText("Valor da parcela 1"), { target: { value: "90,00" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Renegociar saldo" })).toBeDisabled());
    expect(screen.getByText(/para fechar o total/)).toBeInTheDocument();
  });

  test("no cadastro, produto de estoque aparece desabilitado com o motivo", async () => {
    api.getProducts.mockResolvedValue({ items: [
      { id: "p1", name: "CONDOMINIO", isActive: true, controlsStock: false, dreCategoryId: "d1", dreCategory: { dreGroup: "LOCACAO" } },
      { id: "p2", name: "FARINHA", isActive: true, controlsStock: true, dreCategoryId: "d2", dreCategory: { dreGroup: "CMV_COMPRAS" } }
    ] });
    tela(<FormularioParcelamento modo="novo" busy={false} erro={null} onVoltar={() => undefined} onEnviar={() => undefined} />);
    fireEvent.change(await screen.findByLabelText(/Buscar produto/), { target: { value: "co" } });
    const opcao = await screen.findByRole("option", { name: "FARINHA (controla estoque)" });
    expect(opcao).toBeDisabled();
    expect(screen.getByRole("option", { name: "CONDOMINIO" })).toBeEnabled();
  });
});

describe("DetalheParcelamento", () => {
  const abrir = () => tela(<DetalheParcelamento planId="pl1" podeBaixar podeAlterar onAlterou={() => undefined} onFechar={() => undefined} />);

  test("mostra as parcelas com a situação de cada uma", async () => {
    abrir();
    expect(await screen.findByText("Paga")).toBeInTheDocument();
    expect(screen.getAllByText("Em aberto")).toHaveLength(2);
    expect(screen.getByText(/1 de 3 pagas/)).toBeInTheDocument();
  });

  test("quitar exige forma de pagamento e baixa pela rota do Contas a Pagar", async () => {
    api.payInstallment.mockResolvedValue({ id: "i2", status: "PAID" });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas" }));
    const baixar = await screen.findByRole("button", { name: /Baixar 2 parcelas/ });
    expect(baixar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Forma de pagamento"), { target: { value: "m1" } });
    await waitFor(() => expect(baixar).toBeEnabled());
    fireEvent.click(baixar);
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(2));
    expect(api.payInstallment.mock.calls[0][0]).toBe("i2");
    expect(api.payInstallment.mock.calls[0][1]).toMatchObject({ paidAmount: 100, paidPaymentMethodId: "m1", payingCompanyId: "c1" });
  });

  test("desconto exige motivo e é repartido entre as parcelas marcadas", async () => {
    api.payInstallment.mockResolvedValue({ id: "x", status: "PAID" });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas" }));
    fireEvent.change(await screen.findByLabelText("Forma de pagamento"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText(/Desconto total/), { target: { value: "10,00" } });
    const baixar = screen.getByRole("button", { name: /Baixar 2 parcelas/ });
    expect(baixar).toBeDisabled();
    fireEvent.change(await screen.findByLabelText(/Motivo do desconto/), { target: { value: "antecipação" } });
    await waitFor(() => expect(baixar).toBeEnabled());
    fireEvent.click(baixar);
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(2));
    expect(api.payInstallment.mock.calls.map((c) => c[1].paidAmount)).toEqual([95, 95]);
    expect(api.payInstallment.mock.calls[0][1].differenceReason).toBe("antecipação");
  });

  test("juros e multa entram na baixa de cada parcela marcada, com motivo", async () => {
    api.payInstallment.mockResolvedValue({ id: "x", status: "PAID_LATE" });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas" }));
    fireEvent.change(await screen.findByLabelText("Forma de pagamento"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText(/Juros e multa total/), { target: { value: "20,00" } });
    const baixar = screen.getByRole("button", { name: /Baixar 2 parcelas/ });
    expect(baixar).toBeDisabled();
    fireEvent.change(await screen.findByLabelText(/Motivo do desconto ou dos juros/), { target: { value: "atraso" } });
    await waitFor(() => expect(baixar).toBeEnabled());
    fireEvent.click(baixar);
    await waitFor(() => expect(api.payInstallment).toHaveBeenCalledTimes(2));
    expect(api.payInstallment.mock.calls.map((c) => c[1].paidAmount)).toEqual([110, 110]);
    expect(api.payInstallment.mock.calls[0][1].differenceReason).toBe("atraso");
  });

  test("desconto e juros ao mesmo tempo é recusado", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas" }));
    fireEvent.change(await screen.findByLabelText("Forma de pagamento"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText(/Desconto total/), { target: { value: "5,00" } });
    fireEvent.change(screen.getByLabelText(/Juros e multa total/), { target: { value: "5,00" } });
    expect(await screen.findByText(/só desconto ou só juros e multa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baixar 2 parcelas/ })).toBeDisabled();
  });

  test("falha numa baixa para e diz quantas já foram feitas", async () => {
    api.payInstallment.mockResolvedValueOnce({ id: "i2", status: "PAID" }).mockRejectedValueOnce(new Error("Periodo fechado"));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas" }));
    fireEvent.change(await screen.findByLabelText("Forma de pagamento"), { target: { value: "m1" } });
    fireEvent.click(await screen.findByRole("button", { name: /Baixar 2 parcelas/ }));
    expect(await screen.findByText(/1 de 2 parcelas já foram baixadas/)).toBeInTheDocument();
  });

  test("ao abrir a quitação já vêm marcadas só as vencidas e as dos próximos 30 dias", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    expect(await screen.findByRole("button", { name: /Baixar 1 parcela/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todas" }));
    expect(await screen.findByRole("button", { name: /Baixar 2 parcelas/ })).toBeInTheDocument();
  });

  test("plano marcado fora do DRE mostra o aviso no detalhe", async () => {
    api.getInstallmentPlan.mockResolvedValue(plano({ excludeFromDre: true }));
    abrir();
    expect(await screen.findByText("fora do DRE")).toBeInTheDocument();
  });

  test("plano renegociado não oferece ações de alteração", async () => {
    api.getInstallmentPlan.mockResolvedValue(plano({ status: "RENEGOTIATED" }));
    abrir();
    await screen.findByText("Paga");
    expect(screen.queryByRole("button", { name: /Quitar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Renegociar saldo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar/ })).toBeNull();
  });
});
