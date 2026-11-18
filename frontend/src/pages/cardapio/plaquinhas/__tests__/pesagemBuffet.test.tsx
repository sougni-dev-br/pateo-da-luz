import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BuffetPlateItem, BuffetPlateListSummary, BuffetPot, BuffetWeighingDay } from "../../../../api/client";

vi.mock("../../../../api/client", () => ({
  getBuffetPots: vi.fn(), getBuffetWeighings: vi.fn(), getBuffetPlateList: vi.fn(),
  createBuffetWeighing: vi.fn(), deleteBuffetWeighing: vi.fn(), saveBuffetPot: vi.fn(),
}));

import { createBuffetWeighing, deleteBuffetWeighing, getBuffetPlateList, getBuffetPots, getBuffetWeighings } from "../../../../api/client";
import { PesagemBuffet } from "../PesagemBuffet";

const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f);
const prato = (id: string, namePt: string): BuffetPlateItem => ({ id, namePt, nameEn: namePt, category: "Arroz e grãos", isActive: true });
const catalogo = [prato("i1", "Arroz branco"), prato("i2", "Feijão")];
const panela: BuffetPot = { id: "p1", code: "P01", name: null, tareG: 2400, isActive: true };
const lista: BuffetPlateListSummary = { id: "l1", name: "Buffet de hoje", kind: "BUFFET", eventDate: null, format: "std", theme: "wine", itemCount: 2, plateCount: 2, updatedAt: "" };
const diaVazio: BuffetWeighingDay = { date: "", kind: "BUFFET", rows: [], summary: { items: [], producedG: 0, leftoverG: 0, consumedG: 0 } };

function montar(extra: Partial<React.ComponentProps<typeof PesagemBuffet>> = {}) {
  return render(<PesagemBuffet ativa catalogo={catalogo} listas={[lista]} podeCriar podeEditar podeExcluir {...extra} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  m(getBuffetPots).mockResolvedValue([panela]);
  m(getBuffetWeighings).mockResolvedValue(diaVazio);
  m(getBuffetPlateList).mockResolvedValue({ ...lista, items: [{ itemId: "i1", qty: 1 }, { itemId: "i2", qty: 1 }] });
  m(createBuffetWeighing).mockResolvedValue({} as never);
  m(deleteBuffetWeighing).mockResolvedValue({ ok: true });
});

describe("pesagem do buffet (tela)", () => {
  test("mostra o líquido ao digitar o bruto e lança em gramas", async () => {
    montar();
    // A lista só vira os botões dos pratos depois de escolhida.
    fireEvent.change(await screen.findByLabelText("Lista de plaquinhas do dia"), { target: { value: "l1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Arroz branco" }));
    await waitFor(() => expect(screen.getByLabelText("Panela")).toHaveValue("p1"));
    fireEvent.change(screen.getByLabelText(/Peso bruto da balança/), { target: { value: "10,4" } });
    expect(screen.getByText("Líquido: 8 kg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(createBuffetWeighing).toHaveBeenCalledWith(expect.objectContaining({ itemId: "i1", potId: "p1", phase: "PRODUCAO", grossG: 10400, kind: "BUFFET" })));
  });

  test("bruto menor que a panela vazia bloqueia o lançamento", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Lista de plaquinhas do dia"), { target: { value: "l1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Feijão" }));
    await waitFor(() => expect(screen.getByLabelText("Panela")).toHaveValue("p1"));
    fireEvent.change(screen.getByLabelText(/Peso bruto da balança/), { target: { value: "1,5" } });
    expect(screen.getByText(/Menor que a panela vazia/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lançar" })).toBeDisabled();
    expect(createBuffetWeighing).not.toHaveBeenCalled();
  });

  test("sem prato escolhido não lança e avisa", async () => {
    montar();
    await screen.findByLabelText("Panela");
    fireEvent.change(screen.getByLabelText(/Peso bruto da balança/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect(await screen.findByText("Escolha o prato.")).toBeInTheDocument();
    expect(createBuffetWeighing).not.toHaveBeenCalled();
  });

  test("sem panela cadastrada orienta a cadastrar e não mostra o formulário de lançar", async () => {
    m(getBuffetPots).mockResolvedValue([]);
    montar();
    expect(await screen.findByText(/Cadastre ao menos uma panela/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lançar" })).not.toBeInTheDocument();
  });

  test("resumo do dia mostra produzido, sobra e consumido e marca sobra maior que produção", async () => {
    m(getBuffetWeighings).mockResolvedValue({
      date: "", kind: "BUFFET",
      rows: [
        { id: "w1", servedOn: "", kind: "BUFFET", itemId: "i1", itemName: "Arroz branco", potId: "p1", potCode: "P01", phase: "PRODUCAO", grossG: 10400, tareG: 2400, netG: 8000, notes: null, createdAt: "" },
        { id: "w2", servedOn: "", kind: "BUFFET", itemId: "i2", itemName: "Feijão", potId: "p1", potCode: "P01", phase: "SOBRA", grossG: 5000, tareG: 2400, netG: 2600, notes: null, createdAt: "" },
      ],
      summary: {
        items: [
          { itemId: "i1", producedG: 8000, leftoverG: 0, consumedG: 8000, inconsistent: false },
          { itemId: "i2", producedG: 0, leftoverG: 2600, consumedG: null, inconsistent: true },
        ],
        producedG: 8000, leftoverG: 2600, consumedG: 8000,
      },
    });
    montar();
    expect(await screen.findByText(/sobra maior que o produzido/)).toBeInTheDocument();
    expect(screen.getByText("2 lançamentos")).toBeInTheDocument();
  });

  test("quem não pode excluir não vê o botão Apagar", async () => {
    m(getBuffetWeighings).mockResolvedValue({
      date: "", kind: "BUFFET",
      rows: [{ id: "w1", servedOn: "", kind: "BUFFET", itemId: "i1", itemName: "Arroz branco", potId: "p1", potCode: "P01", phase: "PRODUCAO", grossG: 10400, tareG: 2400, netG: 8000, notes: null, createdAt: "" }],
      summary: { items: [{ itemId: "i1", producedG: 8000, leftoverG: 0, consumedG: 8000, inconsistent: false }], producedG: 8000, leftoverG: 0, consumedG: 8000 },
    });
    montar({ podeExcluir: false });
    await screen.findByText("1 lançamento");
    expect(screen.queryByRole("button", { name: /Apagar lançamento/ })).not.toBeInTheDocument();
  });

  test("dois cliques seguidos em Lançar enviam uma pesagem só", async () => {
    let liberar: () => void = () => {};
    m(createBuffetWeighing).mockReturnValue(new Promise((ok) => { liberar = () => ok({} as never); }));
    montar();
    fireEvent.change(await screen.findByLabelText("Lista de plaquinhas do dia"), { target: { value: "l1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Arroz branco" }));
    await waitFor(() => expect(screen.getByLabelText("Panela")).toHaveValue("p1"));
    fireEvent.change(screen.getByLabelText(/Peso bruto da balança/), { target: { value: "10,4" } });
    const lancar = screen.getByRole("button", { name: "Lançar" });
    fireEvent.click(lancar);
    fireEvent.click(lancar);
    expect(createBuffetWeighing).toHaveBeenCalledTimes(1);
    liberar();
  });

  test("apagar um lançamento chama a API", async () => {
    m(getBuffetWeighings).mockResolvedValue({
      date: "", kind: "BUFFET",
      rows: [{ id: "w1", servedOn: "", kind: "BUFFET", itemId: "i1", itemName: "Arroz branco", potId: "p1", potCode: "P01", phase: "PRODUCAO", grossG: 10400, tareG: 2400, netG: 8000, notes: null, createdAt: "" }],
      summary: { items: [{ itemId: "i1", producedG: 8000, leftoverG: 0, consumedG: 8000, inconsistent: false }], producedG: 8000, leftoverG: 0, consumedG: 8000 },
    });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Apagar lançamento de Arroz branco" }));
    await waitFor(() => expect(deleteBuffetWeighing).toHaveBeenCalledWith("w1"));
  });
});
