import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BuffetDishCost } from "../../../../api/client";

vi.mock("../../../../api/client", () => ({
  searchBuffetDishes: vi.fn(), linkBuffetPlateDish: vi.fn(), createPendingBuffetDish: vi.fn(),
}));

import { createPendingBuffetDish, linkBuffetPlateDish, searchBuffetDishes } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { FichasDosPratos } from "../FichasDosPratos";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f);
const pratos = [{ id: "i1", nome: "Arroz branco" }, { id: "i2", nome: "Purê de batata" }];
const ok: BuffetDishCost = { state: "OK", dishId: "d1", dishName: "Arroz branco (ficha)", costPerKg: 8.5, reason: null };
const sem: BuffetDishCost = { state: "SEM_FICHA", dishId: null, dishName: null, costPerKg: null, reason: "Prato sem ficha técnica ligada." };

function montar(extra: Partial<React.ComponentProps<typeof FichasDosPratos>> = {}) {
  const aoMudar = vi.fn();
  render(<FichasDosPratos pratos={pratos} custos={{ i1: ok, i2: sem }} verCusto podeCriar podeEditar aoMudar={aoMudar} {...extra} />);
  return aoMudar;
}

beforeEach(() => {
  vi.clearAllMocks();
  m(searchBuffetDishes).mockResolvedValue([]);
  m(linkBuffetPlateDish).mockResolvedValue({ id: "i2", dishId: null });
  m(createPendingBuffetDish).mockResolvedValue({ dishId: "novo", reused: false });
});

describe("fichas e custo dos pratos", () => {
  test("mostra o custo por kg de quem tem ficha pronta e o motivo de quem não tem", () => {
    montar();
    expect(screen.getByText(/Custo calculado/)).toBeInTheDocument();
    expect(screen.getByText(/8,50/)).toBeInTheDocument();
    expect(screen.getByText("Sem ficha")).toBeInTheDocument();
    expect(screen.getByText("Prato sem ficha técnica ligada.")).toBeInTheDocument();
    expect(screen.getByText("1 sem custo")).toBeInTheDocument();
  });

  test("quem não vê custos não vê o valor em R$, só o estado", () => {
    montar({ verCusto: false });
    expect(screen.getByText("Custo calculado")).toBeInTheDocument();
    expect(screen.queryByText(/8,50/)).not.toBeInTheDocument();
  });

  test("criar ficha liga o prato, avisa e recarrega", async () => {
    const aoMudar = montar();
    fireEvent.click(screen.getByRole("button", { name: "Criar ficha" }));
    await waitFor(() => expect(createPendingBuffetDish).toHaveBeenCalledWith("i2"));
    expect(await screen.findByText(/Ficha de “Purê de batata” criada/)).toBeInTheDocument();
    expect(aoMudar).toHaveBeenCalled();
  });

  test("criar ficha de nome que já existe avisa que ligou à existente", async () => {
    m(createPendingBuffetDish).mockResolvedValue({ dishId: "d7", reused: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Criar ficha" }));
    expect(await screen.findByText(/ligado à ficha que já existia/)).toBeInTheDocument();
  });

  test("ligar a uma ficha existente: busca pelo nome e liga ao escolher", async () => {
    m(searchBuffetDishes).mockResolvedValue([{ id: "d9", name: "Purê de batata caseiro", unit: "KG", pending: true, production: false }]);
    const aoMudar = montar();
    fireEvent.click(screen.getAllByRole("button", { name: "Ligar a uma ficha" })[0]);
    fireEvent.change(screen.getByLabelText("Buscar ficha para Purê de batata"), { target: { value: "purê" } });
    fireEvent.click(await screen.findByRole("button", { name: /Purê de batata caseiro/ }));
    await waitFor(() => expect(linkBuffetPlateDish).toHaveBeenCalledWith("i2", "d9"));
    expect(searchBuffetDishes).toHaveBeenCalledWith("purê");
    expect(aoMudar).toHaveBeenCalled();
  });

  test("prato com ficha tem Trocar e Desligar, e não oferece criar outra", async () => {
    const aoMudar = montar();
    expect(screen.getByRole("button", { name: "Trocar ficha" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Criar ficha" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Desligar" }));
    await waitFor(() => expect(linkBuffetPlateDish).toHaveBeenCalledWith("i1", null));
    expect(aoMudar).toHaveBeenCalled();
  });

  test("sem permissão de editar não aparece nenhum botão; sem criar, some só o Criar ficha", () => {
    const { unmount } = render(<FichasDosPratos pratos={pratos} custos={{ i1: ok, i2: sem }} verCusto podeCriar={false} podeEditar={false} aoMudar={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    render(<FichasDosPratos pratos={pratos} custos={{ i1: ok, i2: sem }} verCusto podeCriar={false} podeEditar aoMudar={() => {}} />);
    expect(screen.queryByRole("button", { name: "Criar ficha" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ligar a uma ficha" })).toHaveLength(1);
  });

  test("carregando ou com erro, não mostra a lista (nem oferece criar ficha)", () => {
    const { unmount } = render(<FichasDosPratos pratos={pratos} custos={{}} verCusto status="carregando" podeCriar podeEditar aoMudar={() => {}} />);
    expect(screen.getByText("Carregando as fichas…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar ficha" })).not.toBeInTheDocument();
    unmount();
    render(<FichasDosPratos pratos={pratos} custos={{}} verCusto status="erro" podeCriar podeEditar aoMudar={() => {}} />);
    expect(screen.getByText(/Não foi possível carregar as fichas dos pratos/)).toBeInTheDocument();
    expect(screen.queryByText("Sem ficha")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar ficha" })).not.toBeInTheDocument();
  });

  test("erro da API aparece na tela", async () => {
    m(createPendingBuffetDish).mockRejectedValue(new Error("Este prato já tem ficha ligada."));
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Criar ficha" }));
    expect(await screen.findByText("Este prato já tem ficha ligada.")).toBeInTheDocument();
  });
});
