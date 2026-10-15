import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const searchRequisitionProducts = vi.fn();
const createRequisition = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  searchRequisitionProducts: (...args: unknown[]) => searchRequisitionProducts(...args),
  createRequisition: (...args: unknown[]) => createRequisition(...args),
  getRequisitions: vi.fn()
}));

import { ApiError } from "../../../api/client";
import { FormularioDaRequisicao } from "../FormularioDaRequisicao";
import { lerRascunho } from "../rascunho";

const user = { id: "u1" } as never;
const farinha = { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null };

function montar(saldos: Map<string, number> | null = new Map([["p1", 3]]), onCriada = vi.fn()) {
  render(<FormularioDaRequisicao user={user} sectors={[]} saldos={saldos} modelo={null} onCriada={onCriada} onAviso={vi.fn()} />);
  return onCriada;
}

async function adicionarFarinha() {
  fireEvent.change(screen.getByLabelText("Buscar produto para adicionar"), { target: { value: "far" } });
  const opcao = await screen.findByRole("option", { name: /FARINHA/ });
  fireEvent.mouseDown(opcao.querySelector("button")!);
}

describe("FormularioDaRequisicao", () => {
  beforeEach(() => {
    localStorage.clear();
    searchRequisitionProducts.mockResolvedValue([farinha]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("500 g de um item com 3 kg de saldo é aceito e mostra a conversão", async () => {
    montar();
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "500" } });

    expect(await screen.findByText(/500 G = 0,5 KG/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Registrar requisição" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("quantidade acima do saldo bloqueia o botão e diz quanto falta", async () => {
    montar();
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "5" } });

    expect((await screen.findAllByText(/Faltam 2 KG/)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Registrar requisição" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("item sem registro de saldo é marcado antes de registrar", async () => {
    montar(new Map());
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "1" } });
    expect((await screen.findAllByText(/Sem saldo em estoque/)).length).toBeGreaterThan(0);
  });

  test("guarda rascunho e registra enviando a unidade escolhida", async () => {
    const onCriada = montar();
    createRequisition.mockResolvedValue({ id: "r1", code: "REQ-1", items: [] });
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "500" } });

    await waitFor(() => expect(lerRascunho("u1")?.linhas[0].quantity).toBe("500"), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: "Registrar requisição" }));
    await waitFor(() => expect(onCriada).toHaveBeenCalled());
    expect(createRequisition.mock.calls[0][0].items).toEqual([{ productId: "p1", quantity: 500, unit: "G" }]);
    expect(lerRascunho("u1")).toBeNull();
  });

  test("erro do servidor lista os produtos e mantém a lista para tentar de novo", async () => {
    montar();
    createRequisition.mockRejectedValue(new ApiError("Saldo insuficiente em 1 produto: FARINHA.", 400, { products: [{ productName: "FARINHA", requested: 2, available: 1, unit: "KG" }] }));
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar requisição" }));

    expect(await screen.findByText(/FARINHA: pediu 2 KG, saldo 1/)).toBeTruthy();
    expect(screen.getByLabelText("Quantidade de FARINHA")).toBeTruthy();
  });

  test("recupera o rascunho ao abrir a tela de novo", async () => {
    montar();
    await adicionarFarinha();
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "2" } });
    await waitFor(() => expect(lerRascunho("u1")).not.toBeNull(), { timeout: 2000 });
    cleanup();

    montar();
    expect(await screen.findByText(/Rascunho recuperado/)).toBeTruthy();
    expect((screen.getByLabelText("Quantidade de FARINHA") as HTMLInputElement).value).toBe("2");
  });
});
