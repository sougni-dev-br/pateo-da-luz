import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Decimo13Linha, Decimo13LinhaClt } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";

const api = vi.hoisted(() => ({ getDecimoTerceiro: vi.fn(), gerarDecimoTerceiro: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../api/client")>()), ...api }));

import { Decimo13 } from "../../Decimo13";

// 13º com sem registro e CLT na mesma lista. Dados fictícios.
const calculo = { ano: 2026, avos: 12, desde: "2026-01-01", salario: 2000, mediaVariaveis: 100, base: 2100, total: 2100,
  parcela1: 1000, parcela2: 1100, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "" };
const sr = (over: Partial<Decimo13Linha>): Decimo13Linha => ({
  employeeId: "s1", nome: "Ana Exemplo", setor: null, calculo, motivoSemCalculo: null, parcela1Existe: false, parcela2Existe: false,
  preRegistro: false, semRegistroAte: null, registroEm: null, ...over });
const clt = (over: Partial<Decimo13LinhaClt>): Decimo13LinhaClt => ({ employeeId: "c1", nome: "CARLOS EXEMPLO", setor: null, parcela1: null, parcela2: null, ...over });

const sessao = (): SessionContextValue => ({
  user: { id: "u1", name: "Fulano", role: "ADMIN", permissions: {} },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue);
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={sessao()}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getDecimoTerceiro.mockResolvedValue({
    ano: 2026,
    linhas: [sr({}), sr({ employeeId: "s2", nome: "Bia Exemplo", parcela1Existe: true })],
    clt: [clt({}), clt({ employeeId: "c2", nome: "Dora Exemplo", parcela1: { valor: 900, pago: true } })],
  });
  api.gerarDecimoTerceiro.mockResolvedValue({ ano: 2026, criadas: 1, semCalculo: [] });
});

test("mostra os dois grupos e a situação de cada pessoa", async () => {
  render(<Decimo13 />);
  expect(await screen.findByText("Ana Exemplo")).toBeInTheDocument();
  const tabela = within(screen.getByRole("table"));
  expect(tabela.getByText("Carlos Exemplo")).toBeInTheDocument(); // nome normalizado
  expect(tabela.getByText("Aguardando extrato")).toBeInTheDocument();
  expect(tabela.getByText("Paga")).toBeInTheDocument();
  expect(tabela.getByText("Falta lançar")).toBeInTheDocument();
  expect(tabela.getByText("Lançada")).toBeInTheDocument();
});

test("o passo atual é lançar enquanto falta lançar alguém", async () => {
  render(<Decimo13 />);
  await screen.findByText("Ana Exemplo");
  const passos = screen.getByRole("list", { name: "Passos da 1ª parcela" });
  expect(within(passos).getAllByRole("listitem")[1].getAttribute("aria-current")).toBe("step");
  expect(within(passos).getByRole("button", { name: /Lançar 1ª parcela \(1\)/ })).toBeInTheDocument();
});

test("filtra por nome sem acento em todos os grupos", async () => {
  render(<Decimo13 />);
  await screen.findByText("Ana Exemplo");
  fireEvent.change(screen.getByRole("textbox", { name: "Filtrar por nome" }), { target: { value: "dóra" } });
  expect(screen.queryByText("Ana Exemplo")).toBeNull();
  expect(screen.getByText("Dora Exemplo")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Filtrar por nome" }), { target: { value: "zzz" } });
  expect(screen.getByText(/Ninguém com/)).toBeInTheDocument();
});

test("lança só a parcela da aba, depois de confirmar", async () => {
  render(<Decimo13 />);
  await screen.findByText("Ana Exemplo");
  fireEvent.click(screen.getByRole("tab", { name: "2ª parcela" }));
  fireEvent.click(await screen.findByRole("button", { name: /Lançar 2ª parcela/ }));
  expect(api.gerarDecimoTerceiro).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar lançamento" }));
  await waitFor(() => expect(api.gerarDecimoTerceiro).toHaveBeenCalledWith(expect.any(Number), 2));
});
