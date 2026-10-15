import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRequisitionCatalog = vi.fn();
const createRequisition = vi.fn();
const criarRascunhoDaRequisicao = vi.fn();
const salvarRascunhoDaRequisicao = vi.fn();
const apagarRascunhoDaRequisicao = vi.fn();
const getRascunhoDaRequisicao = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args),
  createRequisition: (...args: unknown[]) => createRequisition(...args),
  getRequisitions: vi.fn(),
  criarRascunhoDaRequisicao: (...args: unknown[]) => criarRascunhoDaRequisicao(...args),
  salvarRascunhoDaRequisicao: (...args: unknown[]) => salvarRascunhoDaRequisicao(...args),
  apagarRascunhoDaRequisicao: (...args: unknown[]) => apagarRascunhoDaRequisicao(...args),
  getRascunhoDaRequisicao: (...args: unknown[]) => getRascunhoDaRequisicao(...args)
}));

import { ApiError } from "../../../api/client";
import { FormularioDaRequisicao, cabecalhoVazio } from "../FormularioDaRequisicao";

const user = { id: "u1" } as never;
const sectors = [{ id: "seco", name: "ESTOQUE SECO" }] as never;
const catalogo = [
  { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 30 },
  { id: "p4", name: "OVO", code: "70", unit: "UN", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 30 }
];
const ESPERA = { timeout: 4000 };

const digitar = async (nome: string, valor: string) =>
  fireEvent.change((await screen.findByLabelText(`Quantidade de ${nome}`)) as HTMLInputElement, { target: { value: valor } });

function montar(modelo: Parameters<typeof FormularioDaRequisicao>[0]["modelo"] = null, onCriada = vi.fn()) {
  render(<FormularioDaRequisicao user={user} sectors={sectors} modelo={modelo} onCriada={onCriada} onAviso={vi.fn()} />);
  return onCriada;
}

describe("rascunho da requisição salvo no sistema", () => {
  beforeEach(() => {
    localStorage.clear();
    getRequisitionCatalog.mockResolvedValue(catalogo);
    criarRascunhoDaRequisicao.mockResolvedValue({ id: "r1", version: 1 });
    salvarRascunhoDaRequisicao.mockImplementation(async (id: string, corpo: { version: number }) => ({ id, version: corpo.version + 1 }));
    apagarRascunhoDaRequisicao.mockResolvedValue({ ok: true });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("o que se digita vai para o sistema: cria uma vez e depois atualiza com a versão", async () => {
    montar();
    await digitar("FARINHA", "2");
    await waitFor(() => expect(criarRascunhoDaRequisicao).toHaveBeenCalledTimes(1), ESPERA);
    expect(criarRascunhoDaRequisicao.mock.calls[0][0]).toMatchObject({
      conteudo: { escolhas: { p1: { unit: "KG", quantity: "2" } } },
      summary: "FARINHA"
    });

    await digitar("OVO", "5");
    await waitFor(() => expect(salvarRascunhoDaRequisicao).toHaveBeenCalledTimes(1), ESPERA);
    expect(salvarRascunhoDaRequisicao).toHaveBeenCalledWith("r1", expect.objectContaining({ version: 1, summary: "FARINHA, OVO" }));
    expect(criarRascunhoDaRequisicao).toHaveBeenCalledTimes(1);
  });

  test("rascunho aberto de 'Em andamento' continua o mesmo, sem criar outro", async () => {
    montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    await digitar("FARINHA", "3");
    await waitFor(() => expect(salvarRascunhoDaRequisicao).toHaveBeenCalled(), ESPERA);
    expect(salvarRascunhoDaRequisicao).toHaveBeenCalledWith("r9", expect.objectContaining({ version: 4 }));
    expect(criarRascunhoDaRequisicao).not.toHaveBeenCalled();
  });

  test("registrar conclui o rascunho junto (draftId) e não o recria depois", async () => {
    createRequisition.mockResolvedValue({ id: "q1", code: "REQ-1", items: [] });
    const onCriada = montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(onCriada).toHaveBeenCalled());
    expect(createRequisition.mock.calls[0][0]).toMatchObject({ draftId: "r9" });
    await new Promise((r) => setTimeout(r, 1800));
    expect(criarRascunhoDaRequisicao).not.toHaveBeenCalled();
    expect(salvarRascunhoDaRequisicao).not.toHaveBeenCalled();
  });

  test("outra pessoa salvou antes: avisa e deixa escolher entre a versão dela e a minha", async () => {
    salvarRascunhoDaRequisicao.mockRejectedValueOnce(new ApiError("Outra pessoa alterou esta requisição (Maria).", 409, { version: 7 }));
    montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    await digitar("FARINHA", "3");
    expect(await screen.findByText(/Outra pessoa alterou/, undefined, ESPERA)).toBeTruthy();

    salvarRascunhoDaRequisicao.mockResolvedValueOnce({ id: "r9", version: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Manter a minha" }));
    await waitFor(() => expect(salvarRascunhoDaRequisicao).toHaveBeenLastCalledWith("r9", expect.objectContaining({ version: 7 })));
    await waitFor(() => expect(screen.queryByText(/Outra pessoa alterou/)).toBeNull());
  });

  test("'Ver a mais recente' troca os itens pelos do sistema", async () => {
    salvarRascunhoDaRequisicao.mockRejectedValueOnce(new ApiError("Outra pessoa alterou esta requisição.", 409, { version: 7 }));
    getRascunhoDaRequisicao.mockResolvedValue({
      id: "r9", version: 7, updatedAt: "2026-10-15T10:00:00Z", updatedByName: "Maria",
      conteudo: { cabecalho: cabecalhoVazio(), escolhas: { p4: { unit: "UN", quantity: "9" } } }
    });
    montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    await digitar("FARINHA", "3");
    fireEvent.click(await screen.findByRole("button", { name: "Ver a mais recente" }, ESPERA));
    await waitFor(() => expect((screen.getByLabelText("Quantidade de OVO") as HTMLInputElement).value).toBe("9"));
    expect((screen.getByLabelText("Quantidade de FARINHA") as HTMLInputElement).value).toBe("");
  });

  test("rascunho concluído em outro aparelho (404): os itens continuam e viram um rascunho novo", async () => {
    salvarRascunhoDaRequisicao.mockRejectedValueOnce(new ApiError("Rascunho não encontrado.", 404));
    montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    await digitar("FARINHA", "3");
    await waitFor(() => expect(criarRascunhoDaRequisicao).toHaveBeenCalledTimes(1), ESPERA);
    expect(criarRascunhoDaRequisicao.mock.calls[0][0]).toMatchObject({ conteudo: { escolhas: { p1: { quantity: "3" } } } });
  });

  test("limpar a requisição apaga o rascunho no sistema", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    montar({ cabecalho: cabecalhoVazio(), escolhas: { p1: { unit: "KG", quantity: "2" } }, servidor: { id: "r9", version: 4 } });
    fireEvent.click(await screen.findByRole("button", { name: "Limpar requisição" }));
    await waitFor(() => expect(apagarRascunhoDaRequisicao).toHaveBeenCalledWith("r9"));
  });
});
