import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Employee } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";

// Lançar afastamento não remunerado pela Folha: intervalo + motivo (≥ 5 letras), sem valor
// (não é despesa). Lista os do mês com editar e excluir.
vi.mock("../../../api/client", async (original) => ({
  ...(await original<typeof import("../../../api/client")>()),
  getAfastamentos: vi.fn(),
  lancarAfastamento: vi.fn(),
  editarAfastamento: vi.fn(),
  excluirAfastamento: vi.fn(),
}));
import { editarAfastamento, excluirAfastamento, getAfastamentos, lancarAfastamento } from "../../../api/client";
import { AfastamentoModal } from "../AfastamentoModal";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const funcionarios = [{ id: "e1", firstName: "Ana", lastName: "Lima", sector: "Salão" }] as Employee[];
const existente = { employeeId: "e1", employeeName: "Ana Lima", inicio: "2026-09-01", fim: "2026-09-20", dias: 20, motivo: "Pedido pessoal" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAfastamentos).mockResolvedValue({ year: 2026, month: 9, afastamentos: [] });
  vi.mocked(lancarAfastamento).mockResolvedValue({ ...existente, motivo: "Pedido pessoal", substituidas: 2, avisos: [] });
});

function abrir() {
  const onAlterado = vi.fn();
  render(<AfastamentoModal employees={funcionarios} year={2026} month={9} onFechar={vi.fn()} onAlterado={onAlterado} />);
  return onAlterado;
}
const campo = (rotulo: RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;

describe("lançar afastamento", () => {
  test("recusa motivo com menos de 5 letras sem chamar o servidor", async () => {
    abrir();
    fireEvent.change(screen.getByRole("combobox", { name: /Funcionário/ }), { target: { value: "e1" } });
    fireEvent.change(campo(/^De/), { target: { value: "2026-09-01" } });
    fireEvent.change(campo(/^Até/), { target: { value: "2026-09-20" } });
    fireEvent.change(campo(/Motivo/), { target: { value: "a.b 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar afastamento" }));
    expect(await screen.findByText(/Informe o motivo do afastamento \(pelo menos 5 letras\)/)).toBeTruthy();
    expect(lancarAfastamento).not.toHaveBeenCalled();
  });

  test("lança o intervalo com o motivo, recarrega a lista e avisa quantas marcas foram trocadas", async () => {
    const onAlterado = abrir();
    fireEvent.change(screen.getByRole("combobox", { name: /Funcionário/ }), { target: { value: "e1" } });
    fireEvent.change(campo(/^De/), { target: { value: "2026-09-01" } });
    fireEvent.change(campo(/^Até/), { target: { value: "2026-09-20" } });
    fireEvent.change(campo(/Motivo/), { target: { value: "  Pedido pessoal " } });
    vi.mocked(getAfastamentos).mockResolvedValue({ year: 2026, month: 9, afastamentos: [existente] });
    fireEvent.click(screen.getByRole("button", { name: "Lançar afastamento" }));
    await waitFor(() => expect(lancarAfastamento).toHaveBeenCalledWith({ employeeId: "e1", inicio: "2026-09-01", fim: "2026-09-20", motivo: "Pedido pessoal" }));
    expect(await screen.findByText(/20 dia\(s\).*2 marcação\(ões\) da escala substituída/)).toBeTruthy();
    expect(await screen.findByRole("cell", { name: "01/09 a 20/09" })).toBeTruthy();
    expect(onAlterado).toHaveBeenCalled();
  });

  test("fim antes do início: avisa", async () => {
    abrir();
    fireEvent.change(screen.getByRole("combobox", { name: /Funcionário/ }), { target: { value: "e1" } });
    fireEvent.change(campo(/^De/), { target: { value: "2026-09-20" } });
    fireEvent.change(campo(/^Até/), { target: { value: "2026-09-01" } });
    fireEvent.change(campo(/Motivo/), { target: { value: "Pedido pessoal" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar afastamento" }));
    expect(await screen.findByText(/não pode ser antes do início/)).toBeTruthy();
  });
});

describe("afastamentos do mês", () => {
  beforeEach(() => vi.mocked(getAfastamentos).mockResolvedValue({ year: 2026, month: 9, afastamentos: [existente] }));

  test("editar carrega o intervalo no formulário e grava com as datas antigas", async () => {
    vi.mocked(editarAfastamento).mockResolvedValue({ ...existente, fim: "2026-09-25", dias: 25, motivo: "Pedido pessoal", substituidas: 0, avisos: [] });
    abrir();
    const linha = (await screen.findByRole("cell", { name: "01/09 a 20/09" })).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: /Editar/ }));
    expect(campo(/^De/).value).toBe("2026-09-01");
    expect(campo(/Motivo/).value).toBe("Pedido pessoal");
    fireEvent.change(campo(/^Até/), { target: { value: "2026-09-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(editarAfastamento).toHaveBeenCalledWith({
      employeeId: "e1", inicioAtual: "2026-09-01", fimAtual: "2026-09-20", inicio: "2026-09-01", fim: "2026-09-25", motivo: "Pedido pessoal",
    }));
  });

  test("excluir pede confirmação e apaga o intervalo", async () => {
    vi.mocked(excluirAfastamento).mockResolvedValue({ ok: true, dias: 20, avisos: [] });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    abrir();
    const linha = (await screen.findByRole("cell", { name: "01/09 a 20/09" })).closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: /Excluir/ }));
    expect(confirmar).toHaveBeenCalled();
    await waitFor(() => expect(excluirAfastamento).toHaveBeenCalledWith({ employeeId: "e1", inicio: "2026-09-01", fim: "2026-09-20" }));
    confirmar.mockRestore();
  });
});
