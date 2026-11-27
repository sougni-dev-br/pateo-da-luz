import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRequisitionCatalog = vi.fn();
const createRequisition = vi.fn();
const updateRequisition = vi.fn();
const getRequisition = vi.fn();
const criarRascunhoDaRequisicao = vi.fn();
const salvarRascunhoDaRequisicao = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args),
  createRequisition: (...args: unknown[]) => createRequisition(...args),
  updateRequisition: (...args: unknown[]) => updateRequisition(...args),
  getRequisition: (...args: unknown[]) => getRequisition(...args),
  criarRascunhoDaRequisicao: (...args: unknown[]) => criarRascunhoDaRequisicao(...args),
  salvarRascunhoDaRequisicao: (...args: unknown[]) => salvarRascunhoDaRequisicao(...args),
  apagarRascunhoDaRequisicao: vi.fn(),
  getRascunhoDaRequisicao: vi.fn(),
  getRequisitions: vi.fn()
}));

import { ApiError } from "../../../api/client";
import { FormularioDaRequisicao, type ModeloInicial } from "../FormularioDaRequisicao";
import { lerRascunho, salvarRascunho } from "../rascunho";

const user = { id: "u1" } as never;
const sectors = [{ id: "seco", name: "ESTOQUE SECO" }] as never;
// FARINHA tinha 5 KG e a REQ-0007 tirou 2: o catálogo mostra o saldo de agora, 3.
const catalogo = [
  { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 3 },
  { id: "p4", name: "OVO", code: "70", unit: "UN", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 30 }
];

const modelo: ModeloInicial = {
  cabecalho: { date: "2026-11-25", shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" },
  escolhas: { p1: { unit: "KG", quantity: "2" } },
  edicao: { id: "r7", code: "REQ-2026-0007", updatedAt: "2026-11-25T12:00:00.000Z", retirado: { p1: 2 } }
};

function montar(props: { onEditada?: () => void; onCancelarEdicao?: () => void } = {}) {
  render(<FormularioDaRequisicao user={user} sectors={sectors} modelo={modelo} onCriada={vi.fn()} onAviso={vi.fn()} {...props} />);
}

const qtd = (nome: string) => screen.findByLabelText(`Quantidade de ${nome}`) as Promise<HTMLInputElement>;
const salvar = () => screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement;

describe("FormularioDaRequisicao editando uma requisição registrada", () => {
  beforeEach(() => {
    localStorage.clear();
    getRequisitionCatalog.mockResolvedValue(catalogo);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("abre com o que foi retirado e conta a própria retirada como saldo", async () => {
    montar();
    expect((await qtd("FARINHA")).value).toBe("2");
    expect(screen.getByText(/Editando/).textContent).toContain("REQ-2026-0007");
    // 3 de agora + 2 que a requisição já tirou: confirmar os mesmos 2 deixa 3, não "fica negativo".
    expect(await screen.findByText(/fica com 3 KG/)).toBeTruthy();
    expect(salvar().disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull();
  });

  test("salvar manda a versão aberta e os itens como ficaram", async () => {
    const onEditada = vi.fn();
    updateRequisition.mockResolvedValue({ id: "r7", code: "REQ-2026-0007" });
    montar({ onEditada });
    fireEvent.change(await qtd("FARINHA"), { target: { value: "4" } });
    fireEvent.change(await qtd("OVO"), { target: { value: "6" } });
    fireEvent.click(salvar());
    await waitFor(() => expect(onEditada).toHaveBeenCalledWith({ id: "r7", code: "REQ-2026-0007" }));
    expect(updateRequisition).toHaveBeenCalledWith("r7", expect.objectContaining({
      expectedUpdatedAt: "2026-11-25T12:00:00.000Z",
      date: "2026-11-25",
      items: [{ productId: "p1", quantity: 4, unit: "KG" }, { productId: "p4", quantity: 6, unit: "UN" }]
    }));
    expect(createRequisition).not.toHaveBeenCalled();
  });

  test("a edição não vira rascunho nem apaga a requisição nova em andamento", async () => {
    salvarRascunho("u1", { cabecalho: modelo.cabecalho, escolhas: { p4: { unit: "UN", quantity: "9" } }, servidor: null });
    montar();
    fireEvent.change(await qtd("FARINHA"), { target: { value: "1" } });
    await new Promise((r) => setTimeout(r, 800));
    cleanup();
    expect(lerRascunho("u1")?.escolhas).toEqual({ p4: { unit: "UN", quantity: "9" } });
    expect(criarRascunhoDaRequisicao).not.toHaveBeenCalled();
    expect(salvarRascunhoDaRequisicao).not.toHaveBeenCalled();
  });

  test("conflito de versão aparece e os itens continuam na tela", async () => {
    updateRequisition.mockRejectedValue(new ApiError("Esta requisicao foi alterada depois que voce a abriu.", 409));
    montar();
    fireEvent.change(await qtd("FARINHA"), { target: { value: "4" } });
    fireEvent.click(salvar());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("alterada depois");
    expect((await qtd("FARINHA")).value).toBe("4");
  });

  test("conflito de versão: junta com a versão da outra pessoa, recarrega o saldo e salva com a versão nova", async () => {
    const onAviso = vi.fn();
    updateRequisition
      .mockRejectedValueOnce(new ApiError("Esta requisicao foi alterada por outra pessoa depois que voce a abriu.", 409, { conflito: "VERSAO" }))
      .mockResolvedValueOnce({ id: "r7", code: "REQ-2026-0007" });
    // A outra pessoa passou FARINHA de 2 para 3 e incluiu 1 OVO; o saldo de FARINHA caiu de 3 para 2.
    getRequisition.mockResolvedValue({
      id: "r7", code: "REQ-2026-0007", status: "CONFIRMED", updatedAt: "2026-11-25T13:00:00.000Z",
      date: "2026-11-25T00:00:00.000Z", shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: null, sectorId: null, notes: null,
      items: [{ productId: "p1", quantity: "3", unit: "KG", recordedUnit: "KG" }, { productId: "p4", quantity: "1", unit: "UN", recordedUnit: "UN" }]
    });
    getRequisitionCatalog
      .mockResolvedValueOnce(catalogo)
      .mockResolvedValue([{ ...catalogo[0], balance: 2 }, { ...catalogo[1], balance: 29 }]);
    render(<FormularioDaRequisicao user={user} sectors={sectors} modelo={modelo} onCriada={vi.fn()} onEditada={vi.fn()} onAviso={onAviso} />);
    // Esta pessoa mudou só a FARINHA, para 4.
    fireEvent.change(await qtd("FARINHA"), { target: { value: "4" } });
    fireEvent.click(salvar());

    fireEvent.click(await screen.findByRole("button", { name: "Pegar a versão atual e manter o que digitei" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(onAviso).toHaveBeenCalledWith("warning", expect.stringContaining("Vieram da outra pessoa: OVO"));
    // A mudança desta pessoa fica; o OVO que a outra incluiu vem junto.
    expect((await qtd("FARINHA")).value).toBe("4");
    expect((await qtd("OVO")).value).toBe("1");
    // Saldo recarregado: 2 de agora + 3 retirados pela versão atual - 4 = 1.
    expect(await screen.findByText(/fica com 1 KG/)).toBeTruthy();

    fireEvent.click(salvar());
    await waitFor(() => expect(updateRequisition).toHaveBeenCalledTimes(2));
    expect(updateRequisition.mock.calls[1][1]).toMatchObject({
      expectedUpdatedAt: "2026-11-25T13:00:00.000Z",
      items: [{ productId: "p1", quantity: 4, unit: "KG" }, { productId: "p4", quantity: 1, unit: "UN" }]
    });
  });

  test("conflito sem ser de versão não oferece atualizar", async () => {
    updateRequisition.mockRejectedValue(new ApiError("FARINHA teve contagem depois desta requisicao.", 409, { productIds: ["p1"] }));
    montar();
    fireEvent.change(await qtd("FARINHA"), { target: { value: "4" } });
    fireEvent.click(salvar());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pegar a versão atual/ })).toBeNull();
  });

  test("produto desativado depois do registro continua na requisição ao salvar", async () => {
    updateRequisition.mockResolvedValue({ id: "r7", code: "REQ-2026-0007" });
    const comDesativado: ModeloInicial = {
      ...modelo,
      escolhas: { ...modelo.escolhas, p9: { unit: "KG", quantity: "1,5" } },
      edicao: { ...modelo.edicao!, retirado: { p1: 2, p9: 1.5 } }
    };
    render(<FormularioDaRequisicao user={user} sectors={sectors} modelo={comDesativado} onCriada={vi.fn()} onEditada={vi.fn()} onAviso={vi.fn()} />);
    fireEvent.change(await qtd("FARINHA"), { target: { value: "4" } });
    fireEvent.click(salvar());
    await waitFor(() => expect(updateRequisition).toHaveBeenCalled());
    expect(updateRequisition.mock.calls[0][1].items).toEqual([
      { productId: "p1", quantity: 4, unit: "KG" },
      { productId: "p9", quantity: 1.5, unit: "KG" }
    ]);
  });

  test("cancelar edição avisa a tela de fora", async () => {
    const onCancelarEdicao = vi.fn();
    montar({ onCancelarEdicao });
    await qtd("FARINHA");
    fireEvent.click(within(document.querySelector(".rq-barra") as HTMLElement).getByRole("button", { name: "Cancelar edição" }));
    expect(onCancelarEdicao).toHaveBeenCalled();
  });
});
