import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, SupplierEmployeeOption } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";

const api = vi.hoisted(() => ({
  getSuppliers: vi.fn(),
  getPaymentMethods: vi.fn(),
  getSupplierEmployeeOptions: vi.fn(),
  saveSupplier: vi.fn(),
}));
vi.mock("../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
import { Suppliers } from "../Suppliers";

const ANA: SupplierEmployeeOption = {
  employeeId: "e1", name: "Ana Exemplo", position: "Garçom", isActive: true,
  draft: {
    name: "Ana Exemplo", document: "123.456.789-01", phone: "11 90000-0000", email: "", mainCategory: "Funcionário",
    defaultFinancialNotes: "PIX (CPF): 123.456.789-01", notes: "Cadastro reaproveitado do funcionário (reembolsos)."
  },
  existingSupplier: null,
};

const abrir = (user: AppUser) => {
  const sessao = { user, setUser: () => undefined } as unknown as SessionContextValue;
  return render(<SessionContext.Provider value={sessao}><Suppliers /></SessionContext.Provider>);
};
const ADMIN = { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} } as unknown as AppUser;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getSuppliers.mockResolvedValue([]);
  api.getPaymentMethods.mockResolvedValue([{ id: "boleto", name: "BOLETO", isActive: true }, { id: "pix", name: "PIX", isActive: true }]);
  api.getSupplierEmployeeOptions.mockResolvedValue([ANA]);
  api.saveSupplier.mockResolvedValue({});
});

describe("fornecedor a partir de funcionário", () => {
  test("escolher o funcionário preenche o cadastro e salva com PIX em 1 parcela", async () => {
    abrir(ADMIN);
    fireEvent.click(await screen.findByRole("button", { name: /A partir de funcionário/ }));
    const select = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Ana Exemplo — Garçom" })).toBeTruthy());
    fireEvent.change(select, { target: { value: "e1" } });

    expect((screen.getByDisplayValue("123.456.789-01") as HTMLInputElement).value).toBe("123.456.789-01");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    await waitFor(() => expect(api.saveSupplier).toHaveBeenCalled());
    expect(api.saveSupplier.mock.calls[0][0]).toMatchObject({
      name: "Ana Exemplo", document: "123.456.789-01", mainCategory: "Funcionário",
      defaultPaymentMethodId: "pix", defaultInstallmentCount: 1,
      defaultFinancialNotes: "PIX (CPF): 123.456.789-01",
    });
  });

  test("avisa quando já existe fornecedor com o mesmo CPF", async () => {
    api.getSupplierEmployeeOptions.mockResolvedValue([{ ...ANA, existingSupplier: { id: "s1", name: "Ana Antiga", isActive: false } }]);
    abrir(ADMIN);
    fireEvent.click(await screen.findByRole("button", { name: /A partir de funcionário/ }));
    const select = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Ana Exemplo — Garçom" })).toBeTruthy());
    fireEvent.change(select, { target: { value: "e1" } });
    expect(await screen.findByText(/Já existe fornecedor com este CPF: Ana Antiga \(inativo\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cadastrar mesmo assim" })).toBeTruthy();
  });

  test("mostra o resumo do que veio do funcionário e Desfazer limpa o formulário", async () => {
    api.getSupplierEmployeeOptions.mockResolvedValue([{ ...ANA, draft: { ...ANA.draft, defaultFinancialNotes: "" } }]);
    abrir(ADMIN);
    fireEvent.click(await screen.findByRole("button", { name: /A partir de funcionário/ }));
    const select = await screen.findByLabelText("Funcionário");
    await waitFor(() => expect(screen.getByRole("option", { name: "Ana Exemplo — Garçom" })).toBeTruthy());
    fireEvent.change(select, { target: { value: "e1" } });

    expect(screen.getByText("PIX · 1 parcela")).toBeTruthy();
    expect(screen.getByText(/Sem PIX nem conta no cadastro do funcionário/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    expect(screen.queryByDisplayValue("123.456.789-01")).toBeNull();
    expect((select as HTMLSelectElement).value).toBe("");
  });

  test("cadastro comum mostra só o atalho; o atalho troca para o modo funcionário", async () => {
    abrir(ADMIN);
    fireEvent.click((await screen.findAllByRole("button", { name: "+ Novo fornecedor" }))[0]);
    expect(screen.queryByLabelText("Funcionário")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reaproveitar funcionário" }));
    expect(await screen.findByLabelText("Funcionário")).toBeTruthy();
  });

  test("reabrir o fluxo recarrega a lista (o aviso de CPF repetido muda depois de cadastrar)", async () => {
    abrir(ADMIN);
    const botao = await screen.findByRole("button", { name: /A partir de funcionário/ });
    fireEvent.click(botao);
    await waitFor(() => expect(api.getSupplierEmployeeOptions).toHaveBeenCalledTimes(1));
    fireEvent.click(botao);
    await waitFor(() => expect(api.getSupplierEmployeeOptions).toHaveBeenCalledTimes(2));
  });

  test("sem permissão de ver Funcionários a opção não aparece e nada é buscado", async () => {
    const semRh = { id: "u2", name: "Compras", role: "VISUALIZACAO", modulePermissions: { suppliers: { view: true, create: true, edit: true } } } as unknown as AppUser;
    abrir(semRh);
    await waitFor(() => expect(api.getSuppliers).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /A partir de funcionário/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "+ Novo fornecedor" })[0]);
    expect(screen.queryByLabelText("Funcionário")).toBeNull();
    expect(api.getSupplierEmployeeOptions).not.toHaveBeenCalled();
  });
});
