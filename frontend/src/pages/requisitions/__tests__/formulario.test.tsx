import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRequisitionCatalog = vi.fn();
const createRequisition = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args),
  createRequisition: (...args: unknown[]) => createRequisition(...args),
  getRequisitions: vi.fn()
}));

import { ApiError } from "../../../api/client";
import { FormularioDaRequisicao } from "../FormularioDaRequisicao";
import { lerRascunho } from "../rascunho";

const user = { id: "u1" } as never;
const sectors = [{ id: "camara", name: "CAMARA FRIA" }, { id: "seco", name: "ESTOQUE SECO" }] as never;
const catalogo = [
  { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 3 },
  { id: "p2", name: "ALFACE AMERICANA", code: "327", unit: "KG", conversions: [], embalagemInferida: null, sectorId: "camara", balance: 44 },
  { id: "p3", name: "AMENDOIM", code: "50", unit: "KG", conversions: [], embalagemInferida: null, sectorId: "seco", balance: 0 }
];

function montar(onCriada = vi.fn()) {
  render(<FormularioDaRequisicao user={user} sectors={sectors} modelo={null} onCriada={onCriada} onAviso={vi.fn()} />);
  return onCriada;
}

const qtd = (nome: string) => screen.findByLabelText(`Quantidade de ${nome}`) as Promise<HTMLInputElement>;
const digitar = async (nome: string, valor: string) => fireEvent.change(await qtd(nome), { target: { value: valor } });
const registrar = () => screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;

describe("FormularioDaRequisicao", () => {
  beforeEach(() => {
    localStorage.clear();
    getRequisitionCatalog.mockResolvedValue(catalogo);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("lista os produtos com saldo e esconde os sem saldo", async () => {
    montar();
    expect(await screen.findByText("FARINHA")).toBeTruthy();
    expect(screen.getByText("ALFACE AMERICANA")).toBeTruthy();
    expect(screen.queryByText("AMENDOIM")).toBeNull();
  });

  test("digitar a quantidade na linha escolhe o produto e mostra quanto fica", async () => {
    montar();
    await digitar("FARINHA", "2");
    expect(await screen.findByText(/fica com 1 KG/)).toBeTruthy();
    expect(registrar().disabled).toBe(false);
    expect(screen.getByRole("button", { name: /Escolhidos/ }).textContent).toContain("1");
  });

  test("o botão + soma um passo (meio quilo) e o − tira, até sair da requisição", async () => {
    montar();
    await screen.findByText("FARINHA");
    fireEvent.click(screen.getByLabelText("Aumentar FARINHA"));
    expect((await qtd("FARINHA")).value).toBe("0,5");
    fireEvent.click(screen.getByLabelText("Diminuir FARINHA"));
    expect((await qtd("FARINHA")).value).toBe("");
    expect(registrar().disabled).toBe(true);
  });

  test("500 g de um item com 3 kg de saldo é aceito e mostra a conversão", async () => {
    montar();
    await digitar("FARINHA", "500");
    fireEvent.click(screen.getByRole("button", { name: "G" }));
    expect(await screen.findByText(/0,5 KG/)).toBeTruthy();
    expect(registrar().disabled).toBe(false);
  });

  test("quantidade acima do saldo bloqueia o registro e diz quanto falta", async () => {
    montar();
    await digitar("FARINHA", "5");
    expect((await screen.findAllByText(/Faltam 2 KG/)).length).toBeGreaterThan(0);
    expect(registrar().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /1 com problema/ })).toBeTruthy();
  });

  test("busca por parte do nome, sem acento, e mostra sem saldo para explicar", async () => {
    montar();
    await screen.findByText("FARINHA");
    fireEvent.change(screen.getByLabelText("Buscar produto ou código"), { target: { value: "amend" } });
    const linha = (await screen.findByText("AMENDOIM")).closest("li")!;
    expect(within(linha).getByText("sem saldo")).toBeTruthy();
    expect((within(linha).getByLabelText("Quantidade de AMENDOIM") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText("FARINHA")).toBeNull();
  });

  test("filtra por local do estoque", async () => {
    montar();
    await screen.findByText("FARINHA");
    fireEvent.click(screen.getByRole("button", { name: /CAMARA FRIA/ }));
    expect(screen.queryByText("FARINHA")).toBeNull();
    expect(screen.getByText("ALFACE AMERICANA")).toBeTruthy();
  });

  test("guarda o rascunho e registra enviando a unidade escolhida", async () => {
    const onCriada = montar();
    createRequisition.mockResolvedValue({ id: "r1", code: "REQ-1", items: [] });
    await digitar("FARINHA", "500");
    fireEvent.click(screen.getByRole("button", { name: "G" }));

    await waitFor(() => expect(lerRascunho("u1")?.escolhas.p1).toEqual({ unit: "G", quantity: "500" }), { timeout: 2000 });

    fireEvent.click(registrar());
    await waitFor(() => expect(onCriada).toHaveBeenCalled());
    expect(createRequisition.mock.calls[0][0].items).toEqual([{ productId: "p1", quantity: 500, unit: "G" }]);
    expect(lerRascunho("u1")).toBeNull();
  });

  test("erro do servidor lista os produtos e mantém a lista para tentar de novo", async () => {
    montar();
    createRequisition.mockRejectedValue(new ApiError("Saldo insuficiente em 1 produto: FARINHA.", 400, { products: [{ productName: "FARINHA", requested: 2, available: 1, unit: "KG" }] }));
    await digitar("FARINHA", "2");
    fireEvent.click(registrar());

    expect(await screen.findByText(/FARINHA: pediu 2 KG, saldo 1/)).toBeTruthy();
    expect((await qtd("FARINHA")).value).toBe("2");
  });

  test("recupera o rascunho ao abrir a tela de novo", async () => {
    montar();
    await digitar("FARINHA", "2");
    await waitFor(() => expect(lerRascunho("u1")).not.toBeNull(), { timeout: 2000 });
    cleanup();

    montar();
    expect(await screen.findByText(/Rascunho recuperado/)).toBeTruthy();
    expect((await qtd("FARINHA")).value).toBe("2");
  });

  test("apagar a quantidade para redigitar mantém a unidade escolhida", async () => {
    montar();
    await digitar("FARINHA", "500");
    fireEvent.click(screen.getByRole("button", { name: "G" }));
    await digitar("FARINHA", "");
    await digitar("FARINHA", "300");
    expect((screen.getByRole("button", { name: "G" })).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/0,3 KG/)).toBeTruthy();
  });

  test("campo deixado vazio tira o produto da requisição ao sair dele", async () => {
    montar();
    await digitar("FARINHA", "2");
    await digitar("FARINHA", "");
    fireEvent.blur(await qtd("FARINHA"));
    expect(screen.getByRole("button", { name: /Escolhidos/ }).textContent).toContain("0");
    expect(registrar().disabled).toBe(true);
  });

  test("quantidade inválida marca a linha e bloqueia o registro", async () => {
    montar();
    await digitar("FARINHA", "abc");
    expect(await screen.findByText(/maior que zero/)).toBeTruthy();
    expect(registrar().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /1 com problema/ })).toBeTruthy();
  });

  test("a visão 'Com problema' não perde a linha enquanto a pessoa corrige", async () => {
    montar();
    await digitar("FARINHA", "50");
    fireEvent.click(await screen.findByRole("button", { name: /1 com problema/ }));
    await digitar("FARINHA", "1");
    expect(await qtd("FARINHA")).toBeTruthy();
    expect(registrar().disabled).toBe(false);
  });

  test("a última digitação é guardada ao sair da tela, sem esperar o intervalo", async () => {
    montar();
    await digitar("FARINHA", "2");
    cleanup();
    expect(lerRascunho("u1")?.escolhas.p1).toEqual({ unit: "KG", quantity: "2" });
  });

  test("produto do rascunho que saiu do estoque some da requisição", async () => {
    localStorage.setItem("pateo:requisicao-rascunho:v2:u1", JSON.stringify({
      cabecalho: { date: "2026-10-15", shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" },
      escolhas: { p1: { unit: "KG", quantity: "1" }, sumido: { unit: "KG", quantity: "9" } },
      salvoEm: 1
    }));
    montar();
    await screen.findByText("FARINHA");
    expect(screen.getByRole("button", { name: /Escolhidos/ }).textContent).toContain("1");
  });
});
