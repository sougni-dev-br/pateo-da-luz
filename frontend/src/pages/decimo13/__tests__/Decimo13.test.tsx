import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { lancada, linhaClt, linhaSr, parcela } from "./fixtures";

const api = vi.hoisted(() => ({ getDecimoTerceiro: vi.fn(), gerarDecimoTerceiro: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../api/client")>()), ...api }));

import { Decimo13 } from "../../Decimo13";

// 13º com sem registro e CLT na mesma lista. Dados fictícios.
const sessao = (): SessionContextValue => ({
  user: { id: "u1", name: "Fulano", role: "ADMIN", permissions: {} },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue);
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={sessao()}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const previa = (over: object = {}) => ({
  ano: 2026, novembroFechado: true, avisos: [],
  linhas: [linhaSr(), linhaSr({ employeeId: "s2", nome: "Bia Exemplo", p1: lancada(1000) })],
  clt: [linhaClt(), linhaClt({ employeeId: "c2", nome: "Dora Exemplo", parcela1: { valor: 900, pago: true } })],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getDecimoTerceiro.mockResolvedValue(previa());
  api.gerarDecimoTerceiro.mockResolvedValue({ ano: 2026, parcela: 1, criadas: 1, atualizadas: 0, restauradas: 0, semCalculo: 0, avisos: [] });
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

test("2ª parcela fica travada até a gorjeta de novembro fechar, e diz por quê", async () => {
  api.getDecimoTerceiro.mockResolvedValue(previa({ novembroFechado: false }));
  render(<Decimo13 />);
  await screen.findByText("Ana Exemplo");
  fireEvent.click(screen.getByRole("tab", { name: "2ª parcela" }));
  expect(await screen.findByText(/gorjeta de novembro estiver fechada/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Lançar 2ª parcela/ })).toBeNull();
  // a 1ª não depende disso
  fireEvent.click(screen.getByRole("tab", { name: "1ª parcela" }));
  expect(await screen.findByRole("button", { name: /Lançar 1ª parcela/ })).toBeInTheDocument();
});

test("parcela em aberto com valor desatualizado mostra para quanto vai e conta como a atualizar", async () => {
  api.getDecimoTerceiro.mockResolvedValue(previa({ linhas: [linhaSr({ p1: lancada(900, { devido: 1000, gerar: true }) })], clt: [] }));
  render(<Decimo13 />);
  expect(await screen.findByText(/passa a R\$\s?1\.000,00 ao gerar de novo/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Lançar 1ª parcela \(1\)/ }));
  expect(screen.getByText(/atualizar 1 em aberto/)).toBeInTheDocument();
});

test("parcela excluída à mão aparece como tal e não conta como a lançar", async () => {
  api.getDecimoTerceiro.mockResolvedValue(previa({ linhas: [linhaSr({ p1: parcela({ existe: true, lancado: null, gerar: false }) })], clt: [] }));
  render(<Decimo13 />);
  expect(await screen.findByText("Excluída à mão")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Lançar 1ª parcela/ })).toBeNull();
});

test("mostra os avisos da base (gorjeta aberta) e os avisos da geração", async () => {
  api.getDecimoTerceiro.mockResolvedValue(previa({ avisos: ["Gorjeta ainda não fechada em 11/2026: a média pode mudar."] }));
  api.gerarDecimoTerceiro.mockResolvedValue({ ano: 2026, parcela: 1, criadas: 1, atualizadas: 2, restauradas: 0, semCalculo: 0, avisos: ["Ana: parcela excluída à mão."] });
  render(<Decimo13 />);
  expect(await screen.findByText(/Gorjeta ainda não fechada/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Lançar 1ª parcela/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar lançamento" }));
  expect(await screen.findByText(/parcela excluída à mão/)).toBeInTheDocument();
  expect(await screen.findByText(/1 lançada\(s\) e 2 atualizada\(s\)/)).toBeInTheDocument();
});
