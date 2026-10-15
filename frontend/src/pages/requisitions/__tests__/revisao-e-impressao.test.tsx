import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRequisitionPurchaseDraft = vi.fn();
const createPurchaseOrdersFromRequisition = vi.fn();
const getRequisitionCatalog = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getRequisitionPurchaseDraft: (...args: unknown[]) => getRequisitionPurchaseDraft(...args),
  createPurchaseOrdersFromRequisition: (...args: unknown[]) => createPurchaseOrdersFromRequisition(...args),
  getRequisitionCatalog: (...args: unknown[]) => getRequisitionCatalog(...args)
}));

// O valor monetário depende do contexto de ocultar valores do app; aqui basta o número.
vi.mock("../../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

import { RevisaoDoPedido } from "../RevisaoDoPedido";
import { agruparPorLocal, dadosDaRequisicaoRegistrada, useImpressaoDaRequisicao, type DadosDaFolha } from "../ImpressaoDaRequisicao";
import { useCatalogo } from "../useCatalogo";

const opcao = (supplierId: string, supplierName: string, bestUnitPrice: number, extra: Record<string, unknown> = {}) => ({
  supplierId, supplierName, bestUnitPrice, bestPriceDate: "2026-08-01", lastUnitPrice: bestUnitPrice, lastPurchaseDate: "2026-09-01", purchaseCount: 2, unit: "KG", conversionMissing: false, ...extra
});
const base = {
  code: null, estoqueIdeal: null, preferredSupplierId: null, preferredSupplierName: null, bestPriceSupplierId: null, bestPriceSupplierName: null, bestUnitPrice: null,
  lastUnitPrice: null, lastPurchaseSupplierName: null, lastPurchaseDate: null, hasCheaperAlternative: false, priceComparisonNote: null, conversionMissing: false
};
const rascunho = (extra: Record<string, unknown> = {}) => ({
  requisition: { id: "r1", code: "REQ-2026-0001", date: "2026-10-15", shift: "MORNING", reason: "DAILY_PRODUCTION", sectorName: null, requestedByName: "Eli" },
  items: [
    { ...base, productId: "p1", name: "FARINHA", code: "10", unit: "KG", withdrawn: 3, balance: 40, estoqueMinimo: 10, suggestedQuantity: 3, defaultSupplierId: "f1", unitPrice: 10, supplierOptions: [opcao("f1", "Moinho Bom", 10)], bestPriceSupplierId: "f1", bestPriceSupplierName: "Moinho Bom", bestUnitPrice: 10, lastUnitPrice: 10 },
    { ...base, productId: "p2", name: "TOMATE", code: "20", unit: "KG", withdrawn: 2, balance: 5, estoqueMinimo: null, suggestedQuantity: 2, defaultSupplierId: null, unitPrice: null, supplierOptions: [] }
  ],
  suppliers: [{ id: "f1", name: "Moinho Bom" }, { id: "f2", name: "Horta Viva" }],
  existingOrders: [],
  ...extra
});

const montar = () => render(<RevisaoDoPedido requisicaoId="r1" onVoltar={vi.fn()} onAbrirPedidos={vi.fn()} />);
const gerar = () => screen.getByRole("button", { name: /Gerar pedido/ }) as HTMLButtonElement;

describe("RevisaoDoPedido", () => {
  beforeEach(() => getRequisitionPurchaseDraft.mockResolvedValue(rascunho()));
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("começa pelo que saiu e bloqueia enquanto um item está sem fornecedor", async () => {
    montar();
    expect((await screen.findByLabelText("Quantidade a comprar de FARINHA") as HTMLInputElement).value).toBe("3");
    expect(gerar().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /1 sem fornecedor/ })).toBeTruthy();
  });

  test("traz os fornecedores recomendados pelo menor preço e marca o de menor preço", async () => {
    getRequisitionPurchaseDraft.mockResolvedValue(rascunho({
      items: [{
        ...base, productId: "p1", name: "FARINHA", unit: "KG", withdrawn: 3, balance: 40, suggestedQuantity: 3, defaultSupplierId: "f1", unitPrice: 12,
        supplierOptions: [opcao("f2", "Horta Viva", 8), opcao("f1", "Moinho Bom", 12)],
        bestPriceSupplierId: "f2", bestPriceSupplierName: "Horta Viva", bestUnitPrice: 8, lastUnitPrice: 12, hasCheaperAlternative: true, priceComparisonNote: "Menor preço histórico"
      }]
    }));
    montar();
    const grupo = await screen.findByRole("group", { name: /Fornecedores recomendados para FARINHA/ });
    expect(grupo.textContent).toContain("menor preço");
    // o padrão é o fornecedor do cadastro (como no planejamento), mas o mais barato é oferecido com um toque
    expect(screen.getByRole("button", { name: /Moinho Bom/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(await screen.findByRole("button", { name: /Menor preço: Horta Viva/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Horta Viva/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.queryByRole("button", { name: /Menor preço: Horta Viva/ })).toBeNull();
  });

  test("sem fornecedor principal, o padrão é o de menor preço histórico e a unidade em embalagem pede revisão", async () => {
    getRequisitionPurchaseDraft.mockResolvedValue(rascunho({
      items: [{
        ...base, productId: "p1", name: "FARINHA", unit: "KG", withdrawn: 3, balance: 40, suggestedQuantity: 3, defaultSupplierId: "f2", unitPrice: 40,
        supplierOptions: [opcao("f2", "Horta Viva", 40, { conversionMissing: true })], bestPriceSupplierId: "f2", bestPriceSupplierName: "Horta Viva", bestUnitPrice: 40, lastUnitPrice: 40, conversionMissing: true
      }]
    }));
    montar();
    expect((await screen.findByLabelText("Fornecedor de FARINHA") as HTMLSelectElement).value).toBe("f2");
    expect(screen.getByText(/pode ser da embalagem/)).toBeTruthy();
  });

  test("deixar o item sem fornecedor de fora libera, e a quantidade alterada é a que vai", async () => {
    createPurchaseOrdersFromRequisition.mockResolvedValue({ createdOrders: [{ id: "o1", code: "PC-2026-0001", supplierId: "f1", supplierName: "Moinho Bom", totalItems: 1, totalEstimated: 70, status: "RASCUNHO" }], skippedItems: [] });
    montar();
    fireEvent.change(await screen.findByLabelText("Quantidade a comprar de FARINHA"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Quantidade a comprar de TOMATE"), { target: { value: "" } });
    expect(await screen.findByText(/sugerido 3 · voltar/)).toBeTruthy();
    await waitFor(() => expect(gerar().disabled).toBe(false));

    fireEvent.click(gerar());
    expect(await screen.findByText("PC-2026-0001")).toBeTruthy();
    expect(createPurchaseOrdersFromRequisition).toHaveBeenCalledWith("r1", expect.objectContaining({
      items: [{ productId: "p1", supplierId: "f1", requestedQuantity: 7, unitPriceEstimated: 10 }],
      confirmarOutroPedido: false
    }));
  });

  test("escolher o fornecedor do item libera a geração", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Fornecedor de TOMATE"), { target: { value: "f2" } });
    await waitFor(() => expect(gerar().disabled).toBe(false));
  });

  test("requisição que já gerou pedido só gera outro com confirmação", async () => {
    getRequisitionPurchaseDraft.mockResolvedValue(rascunho({ existingOrders: [{ id: "o0", code: "PC-2026-0009", supplierName: "Moinho Bom", status: "RASCUNHO", totalItems: 1 }] }));
    montar();
    fireEvent.change(await screen.findByLabelText("Quantidade a comprar de TOMATE"), { target: { value: "" } });
    expect(await screen.findByText(/já gerou PC-2026-0009/)).toBeTruthy();
    expect(gerar().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Gerar outro pedido mesmo assim/));
    await waitFor(() => expect(gerar().disabled).toBe(false));
  });

  test("o filtro não tira a linha enquanto a pessoa edita (o foco não se perde)", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Quantidade a comprar de TOMATE"), { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: /Fora do pedido/ }));
    const campo = await screen.findByLabelText("Quantidade a comprar de TOMATE");
    fireEvent.change(campo, { target: { value: "1" } });
    expect(screen.getByLabelText("Quantidade a comprar de TOMATE")).toBe(campo);
    expect((screen.getByLabelText("Quantidade a comprar de TOMATE") as HTMLInputElement).value).toBe("1");
  });

  test("os itens que o servidor deixou de fora aparecem com o nome e o motivo", async () => {
    createPurchaseOrdersFromRequisition.mockResolvedValue({
      createdOrders: [{ id: "o1", code: "PC-1", supplierId: "f1", supplierName: "Moinho Bom", totalItems: 1, totalEstimated: 0, status: "RASCUNHO" }],
      skippedItems: [{ productId: "p2", productName: "TOMATE", reason: "Fornecedor não encontrado ou inativo." }]
    });
    montar();
    fireEvent.change(await screen.findByLabelText("Fornecedor de TOMATE"), { target: { value: "f2" } });
    await waitFor(() => expect(gerar().disabled).toBe(false));
    fireEvent.click(gerar());
    expect(await screen.findByText(/TOMATE: Fornecedor não encontrado ou inativo\./)).toBeTruthy();
  });

  test("outra pessoa gerou antes: a tela recarrega e oferece a confirmação sem perder o que foi decidido", async () => {
    const { ApiError } = await import("../../../api/client");
    montar();
    fireEvent.change(await screen.findByLabelText("Quantidade a comprar de TOMATE"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Quantidade a comprar de FARINHA"), { target: { value: "9" } });
    createPurchaseOrdersFromRequisition.mockRejectedValue(new ApiError("Esta requisição acabou de gerar um pedido.", 409));
    getRequisitionPurchaseDraft.mockResolvedValue(rascunho({ existingOrders: [{ id: "o0", code: "PC-2026-0099", supplierName: "Moinho Bom", status: "RASCUNHO", totalItems: 1 }] }));
    fireEvent.click(gerar());
    expect(await screen.findByText(/já gerou PC-2026-0099/)).toBeTruthy();
    expect((screen.getByLabelText("Quantidade a comprar de FARINHA") as HTMLInputElement).value).toBe("9");
  });

  test("erro do servidor aparece e os itens continuam na tela", async () => {
    createPurchaseOrdersFromRequisition.mockRejectedValue(new Error("Quantidade acima do máximo"));
    montar();
    fireEvent.change(await screen.findByLabelText("Quantidade a comprar de TOMATE"), { target: { value: "" } });
    fireEvent.click(gerar());
    expect(await screen.findByText(/acima do máximo/)).toBeTruthy();
    expect((screen.getByLabelText("Quantidade a comprar de FARINHA") as HTMLInputElement).value).toBe("3");
  });
});

describe("folha impressa", () => {
  const folha = (): DadosDaFolha => ({ codigo: null, data: "2026-10-15", turno: "Manhã", setor: null, motivo: "Produção do dia", observacoes: null, responsavel: "Eli", itens: [] });

  test("agrupa pelo local do estoque, em ordem, com 'sem local' por último", () => {
    const grupos = agruparPorLocal([
      { codigo: null, nome: "SAL", quantidade: 1, unidade: "KG", local: null },
      { codigo: null, nome: "BACON", quantidade: 1, unidade: "KG", local: "FREEZER" },
      { codigo: null, nome: "ALFACE", quantidade: 1, unidade: "UN", local: "CAMARA FRIA" },
      { codigo: null, nome: "AGRIAO", quantidade: 1, unidade: "MC", local: "CAMARA FRIA" }
    ]);
    expect(grupos.map((g) => g.local)).toEqual(["CAMARA FRIA", "FREEZER", "Sem local definido"]);
    expect(grupos[0].itens.map((i) => i.nome)).toEqual(["AGRIAO", "ALFACE"]);
  });

  test("converte a requisição registrada, com saldo antes e depois", () => {
    const dados = dadosDaRequisicaoRegistrada({
      id: "r1", code: "REQ-1", date: "2026-10-15", shift: "MORNING", reason: "OTHER", reasonNotes: "Evento X", sectorId: null, sectorName: "Cozinha", notes: "obs", requestedByName: "Eli",
      items: [{ id: "i1", requisitionId: "r1", productId: "p1", productName: "FARINHA", productCode: "10", unit: "KG", quantity: "2.5", movementId: null, stockBefore: "10", stockAfter: "7.5", storageSectorName: "ESTOQUE SECO", createdAt: "" }]
    } as never, { turno: "Manhã", motivo: "Outro" });
    expect(dados).toMatchObject({ codigo: "REQ-1", motivo: "Evento X", setor: "Cozinha", responsavel: "Eli" });
    expect(dados.itens[0]).toEqual({ codigo: "10", nome: "FARINHA", quantidade: 2.5, unidade: "KG", local: "ESTOQUE SECO", antes: 10, depois: 7.5 });
  });

  test("abre a impressão com a folha no documento e desfaz tudo ao terminar", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => {});
    const { result } = renderHook(() => useImpressaoDaRequisicao());
    act(() => result.current.imprimir(folha()));
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(document.body.classList.contains("imprimindo-requisicao")).toBe(true);
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    await waitFor(() => expect(document.body.classList.contains("imprimindo-requisicao")).toBe(false));
    imprimir.mockRestore();
  });
});

describe("lista guardada no aparelho", () => {
  const item = { id: "p1", name: "FARINHA", code: "10", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 3 };
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.clearAllMocks(); });

  test("sem internet na primeira abertura não há o que mostrar", async () => {
    getRequisitionCatalog.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCatalogo("u1"));
    await waitFor(() => expect(result.current.falhou).toBe(true));
  });

  test("com internet guarda a lista; sem internet depois, abre com a guardada e avisa", async () => {
    getRequisitionCatalog.mockResolvedValueOnce([item]);
    const primeira = renderHook(() => useCatalogo("u1"));
    await waitFor(() => expect(primeira.result.current.itens).toHaveLength(1));
    primeira.unmount();

    getRequisitionCatalog.mockRejectedValueOnce(new Error("offline"));
    const segunda = renderHook(() => useCatalogo("u1"));
    expect(segunda.result.current.itens).toHaveLength(1);
    await waitFor(() => expect(segunda.result.current.desatualizadaDesde).not.toBeNull());
    expect(segunda.result.current.falhou).toBe(false);
  });
});
