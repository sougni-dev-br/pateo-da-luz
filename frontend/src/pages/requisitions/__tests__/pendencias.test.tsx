import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getConversoesPendentes = vi.fn();
const cadastrarConversao = vi.fn();
const getRequisitionCatalog = vi.fn();
const getUnits = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getConversoesPendentes: (...args: unknown[]) => getConversoesPendentes(...args),
  cadastrarConversao: (...args: unknown[]) => cadastrarConversao(...args),
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args),
  getUnits: (...args: unknown[]) => getUnits(...args)
}));
// O valor monetário depende do contexto de ocultar valores do app; aqui basta o número.
vi.mock("../../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

import { PendenciasDeConversao } from "../PendenciasDeConversao";
import { LinhaDoCatalogo } from "../LinhaDoCatalogo";

const pendentes = {
  produtos: [
    { productId: "p1", codigo: "366", nome: "BACON PEÇA", unidadeDeContagem: "KG", saldo: 0.1, pendencias: [{ unidade: "UN", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null }] },
    { productId: "p2", codigo: "10", nome: "FARINHA TRIGO 5KG", unidadeDeContagem: "KG", saldo: 20, pendencias: [{ unidade: "PCT", origem: "COMPRA", linhas: 4, valor: 200, proposta: { factor: 5, confianca: "alta", motivo: '"5KG" no nome: 1 PCT = 5 KG.' } }] }
  ]
};
const catalogo = [
  { id: "p9", name: "PRESUNTO CRU", code: "77", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 4 },
  { id: "p1", name: "BACON PEÇA", code: "366", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 0.1 }
];

describe("PendenciasDeConversao", () => {
  beforeEach(() => {
    getConversoesPendentes.mockResolvedValue(pendentes);
    getRequisitionCatalog.mockResolvedValue(catalogo);
    getUnits.mockResolvedValue([{ id: "1", code: "UN", name: "Unidade", isActive: true }, { id: "2", code: "CX", name: "Caixa", isActive: true }, { id: "3", code: "KG", name: "Quilograma", isActive: true }]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("lista os produtos com a unidade pendente, o motivo e a sugestão do sistema já preenchida", async () => {
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={vi.fn()} />);
    expect(await screen.findByText("BACON PEÇA")).toBeTruthy();
    expect(screen.getByText(/O nome diz peça/)).toBeTruthy();
    expect(screen.getByText(/2 produtos com conversão pendente/)).toBeTruthy();
    expect((screen.getByLabelText("Quanto vale 1 UN em KG") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Quanto vale 1 PCT em KG") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText(/Sugestão do sistema \(alta confiança\)/)).toBeTruthy();
  });

  test("o 1 peça do bacon: digita o peso, salva, avisa e recarrega a lista", async () => {
    const onCadastrada = vi.fn();
    cadastrarConversao.mockResolvedValue({ criada: true, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, conversao: { fromUnit: "UN", toUnit: "KG", factor: 3.5 } });
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={onCadastrada} />);
    fireEvent.change(await screen.findByLabelText("Quanto vale 1 UN em KG"), { target: { value: "3,5" } });
    getConversoesPendentes.mockResolvedValue({ produtos: [pendentes.produtos[1]] });
    fireEvent.click(within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(cadastrarConversao).toHaveBeenCalledWith({ productId: "p1", fromUnit: "UN", factor: "3,5" }));
    expect(await screen.findByText(/1 UN = 3,5 KG cadastrada/)).toBeTruthy();
    expect(onCadastrada).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("BACON PEÇA")).toBeNull());
  });

  test("erro do servidor aparece na linha e o valor digitado continua lá", async () => {
    cadastrarConversao.mockRejectedValue(new Error("Fator grande demais (máximo 1.000.000). Confira a vírgula."));
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={vi.fn()} />);
    const campo = (await screen.findByLabelText("Quanto vale 1 UN em KG")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "9999999" } });
    fireEvent.click(within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Fator grande demais/)).toBeTruthy();
    expect(campo.value).toBe("9999999");
  });

  test("Salvar fica desligado enquanto o fator está vazio", async () => {
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={vi.fn()} />);
    await screen.findByText("BACON PEÇA");
    const botao = within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  test("filtra por nome ou código", async () => {
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={vi.fn()} />);
    await screen.findByText("BACON PEÇA");
    fireEvent.change(screen.getByLabelText("Filtrar pendências"), { target: { value: "farinha" } });
    expect(screen.queryByText("BACON PEÇA")).toBeNull();
    expect(screen.getByText("FARINHA TRIGO 5KG")).toBeTruthy();
  });

  test("cadastrar para outro produto: busca no catálogo, escolhe a unidade (sem a do estoque) e salva", async () => {
    cadastrarConversao.mockResolvedValue({ criada: true, comprasConvertidas: 2, comprasEmPeriodoFechado: 0, conversao: { fromUnit: "CX", toUnit: "KG", factor: 6 } });
    render(<PendenciasDeConversao produtoInicial={null} onCadastrada={vi.fn()} />);
    await screen.findByText("BACON PEÇA");
    fireEvent.change(screen.getByLabelText("Buscar produto para converter"), { target: { value: "presunto" } });
    fireEvent.click(await screen.findByRole("option", { name: /PRESUNTO CRU/ }));
    const unidade = (await screen.findByLabelText("Unidade a converter")) as HTMLSelectElement;
    expect(Array.from(unidade.options).map((o) => o.value)).toEqual(["UN", "CX"]);
    fireEvent.change(unidade, { target: { value: "CX" } });
    fireEvent.change(screen.getByLabelText("Quanto vale 1 CX em KG"), { target: { value: "6" } });
    const salvar = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(salvar[salvar.length - 1]);
    await waitFor(() => expect(cadastrarConversao).toHaveBeenCalledWith({ productId: "p9", fromUnit: "CX", factor: "6" }));
    expect(await screen.findByText(/2 compras convertidas/)).toBeTruthy();
  });

  test("vindo do '+ unidade' da requisição, o produto já aparece escolhido", async () => {
    render(<PendenciasDeConversao produtoInicial={{ id: "p1", nome: "BACON PEÇA", unidade: "KG" }} onCadastrada={vi.fn()} />);
    expect(await screen.findByLabelText("Unidade a converter")).toBeTruthy();
    expect((screen.getByLabelText("Buscar produto para converter") as HTMLInputElement).value).toBe("BACON PEÇA");
  });
});

describe("'+ unidade' na linha da requisição", () => {
  afterEach(() => cleanup());
  const item = { id: "p1", name: "BACON PEÇA", code: "366", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 0.1 };

  test("abre as conversões deste produto, sem mudar a linha", () => {
    const onPedirUnidade = vi.fn();
    render(<ul><LinhaDoCatalogo item={item} escolha={undefined} onMudar={vi.fn()} onTirar={vi.fn()} onProxima={vi.fn()} onPedirUnidade={onPedirUnidade} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar outra unidade para BACON PEÇA" }));
    expect(onPedirUnidade).toHaveBeenCalledWith(item);
  });
});
