import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, type AppUser, type DishCategory, type DishDetail, type DishListItem } from "../../../../api/client";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getDishes: vi.fn(),
  getDishCategories: vi.fn(),
  getDishDetail: vi.fn(),
  saveDish: vi.fn(),
  deactivateDish: vi.fn(),
  reactivateDish: vi.fn(),
  saveDishCategory: vi.fn(),
  saveDishProductConversion: vi.fn(),
  searchDishProducts: vi.fn(),
}));

import {
  deactivateDish, getDishCategories, getDishDetail, getDishes, reactivateDish, saveDish, saveDishProductConversion, searchDishProducts,
} from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { FichasTecnicas } from "../FichasTecnicas";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

const CATEGORIA: DishCategory = { id: "c1", name: "A la carte", sortOrder: 0, isActive: true, notes: null, dishesCount: 2 };

// Dados fictícios: nada daqui vem da produção.
function resumo(parcial: Partial<DishListItem>): DishListItem {
  return {
    id: "d", code: null, name: "Prato", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN", isActive: true,
    itemsCount: 1, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 10, custoPorcao: 10,
    margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial,
  };
}

const RISOTO = resumo({ id: "d1", name: "Risoto de camarão", code: "PRAT-001", category: { id: "c1", name: "A la carte" }, salePriceDefault: 80, calculatedCost: 20, custoPorcao: 20, margemBruta: 60, cmvPercentual: 25, itemsCount: 2 });
const PURE = resumo({ id: "d2", name: "Purê de batata", itemsCount: 0, calculatedCost: 0, custoPorcao: 0, margemBruta: 50, cmvPercentual: 0 });
const FUNGHI = resumo({ id: "d3", name: "Risoto de funghi", salePriceDefault: 70, custoIncompleto: true, margemBruta: 60, cmvPercentual: 10, itemsCount: 2 });
const ANTIGO = resumo({ id: "d4", name: "Prato antigo", isActive: false });

const ingrediente = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id, productId: `p-${id}`, productCode: null, productName: nome, productUnit: "KG", quantity: 150, unit: "G", wasteFactor: 0.07,
  unitCost: 40, unitFactor: 0.001, itemCost: 6.42, issue: null, conversions: [], embalagemInferida: null, notes: null, sortOrder: 0, ...extra,
});

function detalhe(base: DishListItem, itens: ReturnType<typeof ingrediente>[], extra: Partial<DishDetail> = {}): DishDetail {
  const { listingsCount: _a, listingPriceMin: _b, listingPriceMax: _c, ...semCanais } = base;
  return { ...semCanais, notes: null, items: itens, listings: [], createdAt: "2026-09-18T12:00:00.000Z", updatedAt: "2026-10-07T15:30:00.000Z", ...extra };
}

const DETALHES: Record<string, DishDetail> = {
  d1: detalhe(RISOTO, [ingrediente("i1", "CAMARAO DESCASCADO"), ingrediente("i2", "CEBOLA ROXA", { quantity: 30, wasteFactor: 0 })], {
    listings: [{ id: "l1", channel: "NOVENTA_NOVE", storeName: "Pateo Frei Caneca", externalName: "Risoto", price: 79.9, isActive: true, lastSeenAt: "2026-10-07T04:00:00.000Z" }],
  }),
  d2: detalhe(PURE, []),
  d3: detalhe(FUNGHI, [ingrediente("i3", "ARROZ ARBORIO", { itemCost: null, unitCost: 27, productUnit: "UN", issue: "Sem conversao de G para UN." }), ingrediente("i4", "PARMESAO")]),
  d4: detalhe(ANTIGO, [ingrediente("i5", "CEBOLA")]),
};

async function abrir() {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  await screen.findByText("Risoto de camarão");
}

const lista = () => screen.getByRole("list");
const itemDaLista = (nome: string) => within(lista()).getByText(nome).closest("button") as HTMLElement;

async function abrirPrato(nome: string, id: string) {
  fireEvent.click(itemDaLista(nome));
  await waitFor(() => expect(getDishDetail).toHaveBeenCalledWith(id));
  return screen.findByRole("heading", { level: 2, name: nome });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDishes).mockResolvedValue([RISOTO, PURE, FUNGHI, ANTIGO]);
  vi.mocked(getDishCategories).mockResolvedValue([CATEGORIA]);
  vi.mocked(getDishDetail).mockImplementation(async (id: string) => DETALHES[id]);
  vi.mocked(saveDish).mockResolvedValue({ id: "d-novo" });
  vi.mocked(searchDishProducts).mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("lista de pratos", () => {
  test("mostra o andamento: só os ativos entram na conta e quem não tem ingrediente fica de fora", async () => {
    await abrir();
    expect(screen.getByText(/de 3 pratos com ingredientes/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });

  test("prato sem ingredientes mostra 'Sem ficha' em vez de um CMV de 0%", async () => {
    await abrir();
    const pure = itemDaLista("Purê de batata");
    expect(within(pure).getByText("Sem ficha")).toBeInTheDocument();
    expect(within(pure).queryByText(/0,0%/)).toBeNull();
  });

  test("busca ignora acento e maiúscula", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar prato ou código"), { target: { value: "PURE" } });
    expect(within(lista()).getByText("Purê de batata")).toBeInTheDocument();
    expect(within(lista()).queryByText("Risoto de camarão")).toBeNull();
  });

  test("filtro 'Incompletas' deixa só o prato com custo parcial", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Incompletas/ }));
    expect(within(lista()).getByText("Risoto de funghi")).toBeInTheDocument();
    expect(within(lista()).queryByText("Risoto de camarão")).toBeNull();
  });

  test("inativos ficam escondidos até pedir", async () => {
    await abrir();
    expect(within(lista()).queryByText("Prato antigo")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar pratos inativos" }));
    expect(within(lista()).getByText("Prato antigo")).toBeInTheDocument();
  });

  test("os contadores dos chips acompanham a lista: com inativos ligados, eles entram na conta", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: /^Todos\s*3$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar pratos inativos" }));
    expect(screen.getByRole("button", { name: /^Todos\s*4$/ })).toBeInTheDocument();
    // O andamento do trabalho continua sendo só dos ativos.
    expect(screen.getByText(/de 3 pratos com ingredientes/)).toBeInTheDocument();
  });

  test("sem resultado oferece limpar os filtros", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar prato ou código"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(within(lista()).getByText("Risoto de camarão")).toBeInTheDocument();
  });
});

describe("ficha do prato", () => {
  test("mostra custo por porção, CMV, ingredientes e onde é vendido", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    expect(screen.getByText("CMV")).toBeInTheDocument();
    expect(screen.getByText("CAMARAO DESCASCADO")).toBeInTheDocument();
    expect(screen.getByText("+7% de perda")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Onde é vendido" })).toBeInTheDocument();
    expect(screen.getByText("Pateo Frei Caneca")).toBeInTheDocument();
  });

  test("custo parcial lista o ingrediente que ficou fora e o motivo", async () => {
    await abrir();
    await abrirPrato("Risoto de funghi", "d3");
    const aviso = screen.getByText(/Custo parcial/).closest("div") as HTMLElement;
    expect(within(aviso).getByText("ARROZ ARBORIO")).toBeInTheDocument();
    expect(within(aviso).getByText(/Sem conversao de G para UN/)).toBeInTheDocument();
  });

  test("prato sem ficha convida a montar a ficha", async () => {
    await abrir();
    await abrirPrato("Purê de batata", "d2");
    expect(screen.getByText("Esta ficha ainda não tem ingredientes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Montar a ficha" })).toBeInTheDocument();
  });

  test("inativar pede confirmação e usa o endpoint certo; reativar volta o prato", async () => {
    vi.mocked(deactivateDish).mockResolvedValue({ ok: true });
    vi.mocked(reactivateDish).mockResolvedValue({ ok: true });
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");

    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(deactivateDish).toHaveBeenCalledWith("d1"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Risoto de camarão"));

    fireEvent.click(screen.getByRole("switch", { name: "Mostrar pratos inativos" }));
    await abrirPrato("Prato antigo", "d4");
    fireEvent.click(screen.getByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(reactivateDish).toHaveBeenCalledWith("d4"));
  });

  test("recusar a confirmação não inativa", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));
    expect(deactivateDish).not.toHaveBeenCalled();
  });
});

describe("formulário", () => {
  test("copiar abre uma ficha nova, sem o código do original, e salva sem id", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    expect(await screen.findByRole("heading", { name: "Copiar ficha" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do prato/)).toHaveValue("Cópia de Risoto de camarão");
    expect(screen.getByLabelText("Código")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Salvar cópia" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveDish).mock.calls[0][0];
    expect(payload).not.toHaveProperty("id");
    expect(payload).toMatchObject({ name: "Cópia de Risoto de camarão", code: "" });
  });

  test("cancelar uma cópia volta para a ficha original, sem prato fantasma", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    await screen.findByRole("heading", { name: "Copiar ficha" });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Risoto de camarão" })).toBeInTheDocument();
    expect(screen.queryByText(/Cópia de/)).toBeNull();
  });

  test("novo prato com outra ficha aberta começa vazio, não com os dados da anterior", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByLabelText(/Nome do prato/)).toHaveValue("Risoto de camarão");

    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    expect(screen.getByLabelText(/Nome do prato/)).toHaveValue("");
  });

  test("editar mostra a perda sem erro de ponto flutuante e salva a fração certa", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    const perda = await screen.findByLabelText("Perda de CAMARAO DESCASCADO em percentual");
    expect(perda).toHaveValue(7); // 0,07 × 100 daria 7.000000000000001

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveDish).mock.calls[0][0] as { id: string; isActive: boolean; items: Array<{ wasteFactor: number }> };
    expect(payload).toMatchObject({ id: "d1", isActive: true });
    expect(payload.items[0].wasteFactor).toBe(0.07);
  });

  test("sem nome não salva e aponta o campo", async () => {
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });

    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    expect(await screen.findByText("Informe o nome do prato.")).toBeInTheDocument();
    expect(saveDish).not.toHaveBeenCalled();
  });

  test("ingrediente sem quantidade barra o salvamento e fica marcado", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-novo", externalCode: "9", name: "FARINHA", unit: "KG", averageCost: 5, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Pão" } });

    const busca = screen.getByRole("combobox", { name: /Buscar produto/ });
    fireEvent.change(busca, { target: { value: "far" } });
    fireEvent.click(await screen.findByRole("option", { name: /FARINHA/ }));

    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    expect(await screen.findByText(/Informe a quantidade/)).toBeInTheDocument();
    expect(saveDish).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "KG" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ name: "Pão", items: [{ productId: "p-novo", quantity: 0.5, unit: "KG" }] });
  });

  test("a unidade oferece g, kg, ml e l sempre; as que ainda não convertem vêm marcadas", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p1", externalCode: null, name: "AZEITE", unit: "L", averageCost: 38, conversions: [], embalagemInferida: null },
      { id: "p2", externalCode: null, name: "ARROZ 1KG", unit: "UN", averageCost: 27, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });

    const busca = screen.getByRole("combobox", { name: /Buscar produto/ });
    fireEvent.change(busca, { target: { value: "a" } });
    fireEvent.click(await screen.findByRole("option", { name: /AZEITE/ }));
    const azeite = screen.getByLabelText("Unidade de AZEITE") as HTMLSelectElement;
    expect([...azeite.options].map((o) => o.value)).toEqual(["L", "G", "KG", "ML"]);
    expect([...azeite.options].map((o) => o.textContent)).toEqual(["L", "G (informar)", "KG (informar)", "ML"]);

    fireEvent.change(busca, { target: { value: "ar" } });
    fireEvent.click(await screen.findByRole("option", { name: /ARROZ/ }));
    const arroz = screen.getByLabelText("Unidade de ARROZ 1KG") as HTMLSelectElement;
    expect([...arroz.options].map((o) => o.value)).toEqual(["UN", "G", "KG", "ML", "L"]);
  });

  test("produto contado em UN com peso no nome: entra em gramas, mostra a conversão lida do nome e salva em G", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([{
      id: "p-farinha", externalCode: "381", name: "FARINHA TRIGO 5KG", unit: "UN", averageCost: 25,
      conversions: [
        { fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true },
        { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true },
      ],
      embalagemInferida: "1 UN = 5 KG (lido do nome do produto)",
    }]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Pão" } });

    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "far" } });
    const opcao = await screen.findByRole("option", { name: /FARINHA/ });
    expect(opcao).toHaveTextContent("1 UN = 5 KG (lido do nome do produto)");
    fireEvent.click(opcao);

    // A pessoa digita como pesa: 500 g. Nada de 0,1 UN.
    const unidade = screen.getByLabelText("Unidade de FARINHA TRIGO 5KG") as HTMLSelectElement;
    expect(unidade.value).toBe("G");
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA TRIGO 5KG"), { target: { value: "500" } });
    expect(screen.getByText(/1 UN = 5 KG \(lido do nome do produto\)\. Confira/)).toBeInTheDocument();
    expect(screen.queryByText("sem custo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ items: [{ productId: "p-farinha", quantity: 500, unit: "G" }] });
  });

  test("unidade que ainda não converte abre o campo '1 UN = ? g'; salvar grava no produto e calcula o custo", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-abacaxi", externalCode: "7", name: "ABACAXI", unit: "UN", averageCost: 6, conversions: [], embalagemInferida: null },
    ]);
    vi.mocked(saveDishProductConversion).mockResolvedValue({
      conversions: [{ fromUnit: "G", toUnit: "UN", factor: 1 / 1200 }, { fromUnit: "KG", toUnit: "UN", factor: 1 / 1.2 }],
      embalagemInferida: null,
    });
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Salada" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "aba" } });
    fireEvent.click(await screen.findByRole("option", { name: /ABACAXI/ }));

    // Sem conversão, a unidade fica em UN; escolher g abre o campo de informar.
    fireEvent.change(screen.getByLabelText("Unidade de ABACAXI"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantidade de ABACAXI"), { target: { value: "300" } });
    expect(screen.getByText("Quanto vale 1 UN em G?")).toBeInTheDocument();
    expect(screen.getByText("sem custo")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quantos G tem 1 UN de ABACAXI"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conversão" }));

    await waitFor(() => expect(saveDishProductConversion).toHaveBeenCalledWith("p-abacaxi", { unit: "G", amount: 1200 }));
    // 300 g de um abacaxi de 1,2 kg a R$ 6 = R$ 1,50
    await waitFor(() => expect(screen.queryByText("Quanto vale 1 UN em G?")).toBeNull());
    expect(screen.queryByText("sem custo")).toBeNull();
    expect(screen.getAllByText(/1,50/).length).toBeGreaterThan(0);
  });

  test("produto que já tem conversão diferente: avisa e só troca depois de confirmar", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-abacaxi", externalCode: "7", name: "ABACAXI", unit: "UN", averageCost: 6, conversions: [], embalagemInferida: null },
    ]);
    vi.mocked(saveDishProductConversion)
      .mockRejectedValueOnce(new ApiError("Este produto já tem conversão cadastrada (1 KG = 0,2 UN). Confirme para substituir.", 409))
      .mockResolvedValueOnce({ conversions: [{ fromUnit: "G", toUnit: "UN", factor: 1 / 1200 }, { fromUnit: "KG", toUnit: "UN", factor: 1 / 1.2 }], embalagemInferida: null });
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "aba" } });
    fireEvent.click(await screen.findByRole("option", { name: /ABACAXI/ }));
    fireEvent.change(screen.getByLabelText("Unidade de ABACAXI"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantos G tem 1 UN de ABACAXI"), { target: { value: "1200" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar conversão" }));
    expect(await screen.findByText(/já tem conversão cadastrada/)).toBeInTheDocument();
    expect(vi.mocked(saveDishProductConversion).mock.calls[0][1]).toEqual({ unit: "G", amount: 1200 });

    fireEvent.click(screen.getByRole("button", { name: "Substituir mesmo assim" }));
    await waitFor(() => expect(vi.mocked(saveDishProductConversion).mock.calls[1][1]).toEqual({ unit: "G", amount: 1200, replace: true }));
    await waitFor(() => expect(screen.queryByText("Quanto vale 1 UN em G?")).toBeNull());
  });

  test("conversão lida do nome que não bate: dá para informar o valor certo", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([{
      id: "p-arroz", externalCode: "5", name: "ARROZ 5KG C/6", unit: "UN", averageCost: 30,
      conversions: [{ fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true }, { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true }],
      embalagemInferida: "1 UN = 5 KG (lido do nome do produto)",
    }]);
    vi.mocked(saveDishProductConversion).mockResolvedValue({
      conversions: [{ fromUnit: "UN", toUnit: "G", factor: 30000 }, { fromUnit: "UN", toUnit: "KG", factor: 30 }],
      embalagemInferida: null,
    });
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "arr" } });
    fireEvent.click(await screen.findByRole("option", { name: /ARROZ/ }));
    expect((screen.getByLabelText("Unidade de ARROZ 5KG C/6") as HTMLSelectElement).value).toBe("G");

    fireEvent.click(screen.getByRole("button", { name: "Não bate? Informar o valor certo" }));
    fireEvent.change(screen.getByLabelText("Quantos G tem 1 UN de ARROZ 5KG C/6"), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conversão" }));
    await waitFor(() => expect(saveDishProductConversion).toHaveBeenCalledWith("p-arroz", { unit: "G", amount: 30000 }));
    await waitFor(() => expect(screen.queryByText(/lido do nome do produto/)).toBeNull());
  });

  test("falha ao salvar a conversão mostra a mensagem e mantém o campo", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-abacaxi", externalCode: "7", name: "ABACAXI", unit: "UN", averageCost: 6, conversions: [], embalagemInferida: null },
    ]);
    vi.mocked(saveDishProductConversion).mockRejectedValue(new Error("Perfil sem permissao para acessar este recurso."));
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "aba" } });
    fireEvent.click(await screen.findByRole("option", { name: /ABACAXI/ }));
    fireEvent.change(screen.getByLabelText("Unidade de ABACAXI"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantos G tem 1 UN de ABACAXI"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conversão" }));
    expect(await screen.findByText(/Perfil sem permissao/)).toBeInTheDocument();
    expect(screen.getByLabelText("Quantos G tem 1 UN de ABACAXI")).toHaveValue(1200);
  });

  test("produto cotado em KG já abre em gramas e em L já abre em ml", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p1", externalCode: null, name: "ALCATRA", unit: "KG", averageCost: 56, conversions: [], embalagemInferida: null },
      { id: "p2", externalCode: null, name: "AZEITE", unit: "L", averageCost: 38, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    const busca = screen.getByRole("combobox", { name: /Buscar produto/ });
    fireEvent.change(busca, { target: { value: "a" } });
    fireEvent.click(await screen.findByRole("option", { name: /ALCATRA/ }));
    fireEvent.change(busca, { target: { value: "az" } });
    fireEvent.click(await screen.findByRole("option", { name: /AZEITE/ }));
    expect((screen.getByLabelText("Unidade de ALCATRA") as HTMLSelectElement).value).toBe("G");
    expect((screen.getByLabelText("Unidade de AZEITE") as HTMLSelectElement).value).toBe("ML");
  });

  test("custo muito acima do preço avisa para conferir as unidades", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p2", externalCode: null, name: "ARROZ 1KG", unit: "UN", averageCost: 27, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Preço de venda/), { target: { value: "60" } });

    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "ar" } });
    fireEvent.click(await screen.findByRole("option", { name: /ARROZ/ }));
    fireEvent.change(screen.getByLabelText("Quantidade de ARROZ 1KG"), { target: { value: "240" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/Confira as quantidades e as unidades/);
  });

  test("código repetido mostra a mensagem do servidor", async () => {
    vi.mocked(saveDish).mockRejectedValue(new Error('Já existe um prato com o código "PRAT-001".'));
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    expect(await screen.findByText(/Já existe um prato com o código "PRAT-001"/)).toBeInTheDocument();
  });

  test("'Novo prato' de novo, com um rascunho aberto e descartado, abre zerado e continua protegido", async () => {
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Rascunho" } });

    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]); // confirm → true
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Nome do prato/)).toHaveValue("");

    // O formulário novo é um formulário de verdade: digitar nele volta a proteger o descarte.
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Outro rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  test("Enter num campo não salva a ficha; na quantidade ele leva à busca do próximo ingrediente", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-novo", externalCode: "9", name: "FARINHA", unit: "KG", averageCost: 5, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Pão" } });

    fireEvent.keyDown(screen.getByLabelText(/Nome do prato/), { key: "Enter" });
    expect(saveDish).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "far" } });
    fireEvent.click(await screen.findByRole("option", { name: /FARINHA/ }));
    const quantidade = screen.getByLabelText("Quantidade de FARINHA");
    fireEvent.change(quantidade, { target: { value: "1" } });
    fireEvent.keyDown(quantidade, { key: "Enter" });

    expect(saveDish).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: /Buscar produto/ })).toHaveFocus();
  });

  test("Enter na busca sem resultado não envia o formulário", async () => {
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Pão" } });

    const busca = screen.getByRole("combobox", { name: /Buscar produto/ });
    fireEvent.change(busca, { target: { value: "xyz" } });
    expect((await screen.findAllByText(/Nenhum produto encontrado/)).length).toBeGreaterThan(0);
    fireEvent.keyDown(busca, { key: "Enter" });
    expect(saveDish).not.toHaveBeenCalled();
  });

  test("perda fora de 0–100% marca o campo da perda, não o da quantidade", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const perda = await screen.findByLabelText("Perda de CAMARAO DESCASCADO em percentual");
    fireEvent.change(perda, { target: { value: "150" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText(/perda deve ficar entre 0% e 100%/)).toBeInTheDocument();
    expect(perda).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Quantidade de CAMARAO DESCASCADO")).not.toHaveAttribute("aria-invalid");
    expect(saveDish).not.toHaveBeenCalled();
  });

  test("o botão de fechar a ficha volta ao estado de 'escolha um prato'", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Fechar a ficha" }));
    expect(await screen.findByText("Escolha um prato")).toBeInTheDocument();
  });

  test("cancelar com alterações pede confirmação; recusar mantém o formulário", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Rascunho" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("alterações não salvas"));
    expect(screen.getByLabelText(/Nome do prato/)).toHaveValue("Rascunho");
  });

  test("cancelar sem alterações fecha direto, sem perguntar", async () => {
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("Escolha um prato")).toBeInTheDocument();
  });
});
