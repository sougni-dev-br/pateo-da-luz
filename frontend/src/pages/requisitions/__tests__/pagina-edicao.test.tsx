import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRequisition = vi.fn();
const getRequisitions = vi.fn();
const getRequisitionCatalog = vi.fn();

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getSectors: vi.fn().mockResolvedValue([]),
  getRequisitions: (...args: unknown[]) => getRequisitions(...args),
  getRequisition: (...args: unknown[]) => getRequisition(...args),
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args),
  listarRascunhosDaRequisicao: vi.fn().mockResolvedValue([]),
  getRascunhoDaRequisicao: vi.fn(),
  criarRascunhoDaRequisicao: vi.fn().mockResolvedValue({ id: "d1", version: 1 }),
  salvarRascunhoDaRequisicao: vi.fn().mockResolvedValue({ id: "d1", version: 2 }),
  apagarRascunhoDaRequisicao: vi.fn().mockResolvedValue({ ok: true }),
  getUnits: vi.fn().mockResolvedValue([]),
  createRequisition: vi.fn(),
  updateRequisition: vi.fn()
}));

import { Requisitions } from "../../Requisitions";

const user = { id: "u1", role: "ADMIN" } as never;
const registrada = {
  id: "r7", code: "REQ-2026-0007", date: "2026-11-25T00:00:00.000Z", shift: "MORNING", reason: "DAILY_PRODUCTION",
  reasonNotes: null, sectorId: null, notes: null, status: "CONFIRMED", updatedAt: "2026-11-25T12:00:00.000Z",
  createdAt: "2026-11-25T12:00:00.000Z", requestedByName: "Fulano",
  items: [{ id: "i1", productId: "p1", productName: "FARINHA", quantity: "2", unit: "KG", recordedUnit: "KG" }]
};
const catalogo = [
  { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 3 }
];

function montar() {
  render(<MemoryRouter><Requisitions user={user} /></MemoryRouter>);
}

const abrirHistorico = () => fireEvent.click(screen.getByRole("button", { name: /^Histórico/ }));
const qtdFarinha = () => screen.findByLabelText("Quantidade de FARINHA") as Promise<HTMLInputElement>;

async function editarRegistrada() {
  abrirHistorico();
  fireEvent.click(await screen.findByRole("button", { name: "Editar REQ-2026-0007" }));
  await screen.findByRole("button", { name: /Editando REQ-2026-0007/ });
}

describe("Requisições: entrar e sair da edição pela página", () => {
  beforeEach(() => {
    localStorage.clear();
    getRequisitions.mockResolvedValue([registrada]);
    getRequisition.mockResolvedValue(registrada);
    getRequisitionCatalog.mockResolvedValue(catalogo);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  test("Editar de novo na requisição já em edição volta ao formulário sem perder o que foi mudado", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    montar();
    await editarRegistrada();
    fireEvent.change(await qtdFarinha(), { target: { value: "4" } });

    abrirHistorico();
    fireEvent.click(await screen.findByRole("button", { name: "Editar REQ-2026-0007" }));

    expect((await qtdFarinha()).value).toBe("4");
    expect(getRequisition).toHaveBeenCalledTimes(1);
    expect(confirmar).not.toHaveBeenCalled();
  });

  test("Nova requisição no meio de uma edição pergunta e sai da edição", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    montar();
    await editarRegistrada();

    abrirHistorico();
    fireEvent.click(screen.getByRole("button", { name: "Nova requisição" }));

    expect(confirmar).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Editando/ })).toBeNull());
    expect(screen.queryByRole("button", { name: "Salvar alterações" })).toBeNull();
  });

  test("Nova requisição recusada na pergunta continua na edição", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    await editarRegistrada();

    abrirHistorico();
    fireEvent.click(screen.getByRole("button", { name: "Nova requisição" }));

    expect(screen.getByRole("button", { name: /Editando REQ-2026-0007/ })).toBeTruthy();
  });
});
