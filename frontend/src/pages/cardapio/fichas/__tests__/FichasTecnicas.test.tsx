import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, type AppUser, type DishCategory, type DishDetail, type DishListItem } from "../../../../api/client";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getBuffetDishes: vi.fn(),
  confirmDishFicha: vi.fn(),
  unconfirmDishFicha: vi.fn(),
  getDishFichaSuggestions: vi.fn(),
  searchDishFichas: vi.fn(),
  getDishes: vi.fn(),
  getDishCategories: vi.fn(),
  getDishDetail: vi.fn(),
  saveDish: vi.fn(),
  deactivateDish: vi.fn(),
  reactivateDish: vi.fn(),
  saveDishCategory: vi.fn(),
  saveDishProductConversion: vi.fn(),
  searchDishProducts: vi.fn(),
  getDishNetRatios: vi.fn().mockResolvedValue({ channel: "NOVENTA_NOVE", dias: 60, plataforma: { razao: null, pedidos: 0 }, lojas: [] }),
}));

import {
  confirmDishFicha, unconfirmDishFicha, deactivateDish, getBuffetDishes, getDishCategories, getDishDetail, getDishFichaSuggestions, searchDishFichas, getDishes, reactivateDish, saveDish, saveDishProductConversion, searchDishProducts,
} from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { FichasTecnicas } from "../FichasTecnicas";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

const CATEGORIA: DishCategory = { id: "c1", name: "A la carte", sortOrder: 0, isActive: true, notes: null, parentId: null, menu: "CARDAPIO", dishesCount: 2 };

// Dados fictícios: nada daqui vem da produção.
function resumo(parcial: Partial<DishListItem>): DishListItem {
  return {
    id: "d", code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN", isActive: true,
    itemsCount: 1, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 10, custoPorcao: 10,
    margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial,
  };
}

const RISOTO = resumo({ id: "d1", name: "Risoto de camarão", code: "PRAT-001", category: { id: "c1", name: "A la carte", parentId: null, parentName: null, menu: "CARDAPIO" }, salePriceDefault: 80, calculatedCost: 20, custoPorcao: 20, margemBruta: 60, cmvPercentual: 25, itemsCount: 2 });
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
    listings: [{ id: "l1", channel: "NOVENTA_NOVE", deliveryStoreId: "s1", manual: false, storeName: "Pateo Frei Caneca", externalName: "Risoto", price: 79.9, isActive: true, lastSeenAt: "2026-10-07T04:00:00.000Z" }],
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
  // A tela abre no Painel; o trabalho de montar fichas acontece na aba Pratos.
  fireEvent.click(await screen.findByRole("tab", { name: "Pratos" }));
  await screen.findByText("Risoto de camarão");
}

const abrirFiltrosExtras = () => fireEvent.click(screen.getByRole("button", { name: /Categoria, ordem e inativos/ }));
const ligarInativos = () => {
  abrirFiltrosExtras();
  fireEvent.click(screen.getByRole("switch", { name: "Mostrar pratos inativos" }));
};

const lista = () => screen.getByRole("list");
const itemDaLista = (nome: string) => within(lista()).getByText(nome).closest("button") as HTMLElement;

async function abrirPrato(nome: string, id: string) {
  fireEvent.click(itemDaLista(nome));
  await waitFor(() => expect(getDishDetail).toHaveBeenCalledWith(id));
  return screen.findByRole("heading", { level: 2, name: nome });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Ficha de produção vem de uma consulta própria (?tipo=producao): a lista de pratos nunca a traz.
  vi.mocked(getDishes).mockImplementation(async (parametros) => (parametros?.tipo === "producao" ? [] : [RISOTO, PURE, FUNGHI, ANTIGO]));
  vi.mocked(getBuffetDishes).mockResolvedValue([]);
  vi.mocked(getDishFichaSuggestions).mockResolvedValue([]);
  vi.mocked(searchDishFichas).mockResolvedValue([]);
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

async function abrirPainel() {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  await screen.findByText("Fichas montadas");
}

describe("painel", () => {
  test("abre no painel: fichas montadas só dos ativos, CMV médio só de quem tem ficha completa e preço", async () => {
    await abrirPainel();
    expect(screen.getByRole("progressbar", { name: "Pratos com ficha montada" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("de 3")).toBeInTheDocument();
    // Risoto de camarão (25%) é o único analisável: o de funghi tem custo parcial e o purê não tem ficha.
    expect(screen.getAllByText("25,0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Média simples de 1 prato/)).toBeInTheDocument();
  });

  test("diz o que fazer agora e leva à lista já filtrada", async () => {
    await abrirPainel();
    fireEvent.click(screen.getByRole("button", { name: /1 ficha com custo parcial/ }));
    expect(await screen.findByRole("tab", { name: "Pratos", selected: true })).toBeInTheDocument();
    expect(within(lista()).getByText("Risoto de funghi")).toBeInTheDocument();
    expect(within(lista()).queryByText("Risoto de camarão")).toBeNull();
  });

  test("clicar num prato do ranking abre a ficha dele", async () => {
    await abrirPainel();
    fireEvent.click(screen.getAllByRole("button", { name: /Risoto de camarão/ })[0]);
    await waitFor(() => expect(getDishDetail).toHaveBeenCalledWith("d1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Risoto de camarão" })).toBeInTheDocument();
  });

  test("categoria do gráfico leva aos pratos dela", async () => {
    await abrirPainel();
    fireEvent.click(screen.getByRole("button", { name: /A la carte/ }));
    expect(await screen.findByRole("tab", { name: "Pratos", selected: true })).toBeInTheDocument();
    expect(within(lista()).getByText("Risoto de camarão")).toBeInTheDocument();
    expect(within(lista()).queryByText("Purê de batata")).toBeNull();
  });

  test("sem nenhum prato cadastrado convida a cadastrar", async () => {
    vi.mocked(getDishes).mockResolvedValue([]);
    await abrirPainel().catch(() => undefined);
    expect(await screen.findByText("Nenhum prato cadastrado.")).toBeInTheDocument();
  });
});

describe("lista de pratos", () => {
  test("prato sem ingredientes mostra 'Sem ficha' em vez de um CMV de 0%", async () => {
    await abrir();
    const pure = itemDaLista("Purê de batata");
    expect(within(pure).getByText("Sem ficha")).toBeInTheDocument();
    expect(within(pure).queryByText(/0,0%/)).toBeNull();
  });

  test("busca ignora acento e maiúscula", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar prato, código ou categoria"), { target: { value: "PURE" } });
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
    ligarInativos();
    expect(within(lista()).getByText("Prato antigo")).toBeInTheDocument();
  });

  test("os contadores dos chips acompanham a lista: com inativos ligados, eles entram na conta", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: /^Todos\s*3$/ })).toBeInTheDocument();
    ligarInativos();
    expect(screen.getByRole("button", { name: /^Todos\s*4$/ })).toBeInTheDocument();
  });

  test("sem resultado oferece limpar os filtros", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar prato, código ou categoria"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(within(lista()).getByText("Risoto de camarão")).toBeInTheDocument();
  });
});

describe("ficha do prato", () => {
  test("mostra custo por porção, CMV, ingredientes e o preço em cada canal", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    expect(screen.getAllByText("CMV").length).toBeGreaterThan(0);
    expect(screen.getByText("CAMARAO DESCASCADO")).toBeInTheDocument();
    expect(screen.getByText("+7% de perda")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preços por canal" })).toBeInTheDocument();
    expect(screen.getByText("Salão (a la carte)")).toBeInTheDocument();
    expect(screen.getByText("Pateo Frei Caneca")).toBeInTheDocument();
    expect(screen.getByText("da plataforma")).toBeInTheDocument(); // o preço da 99 vem do cardápio dela
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

    ligarInativos();
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

    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "KG" } });
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ name: "Pão", items: [{ productId: "p-novo", quantity: 0.5, unit: "KG" }] });
  });

  test("trocar a unidade converte a quantidade junto e avisa; editar a quantidade apaga o aviso", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([
      { id: "p-novo", externalCode: "9", name: "FARINHA", unit: "KG", averageCost: 5, conversions: [], embalagemInferida: null },
    ]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "far" } });
    fireEvent.click(await screen.findByRole("option", { name: /FARINHA/ }));

    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "170" } });
    fireEvent.change(screen.getByLabelText("Unidade de FARINHA"), { target: { value: "KG" } });

    expect((screen.getByLabelText("Quantidade de FARINHA") as HTMLInputElement).value).toBe("0.17");
    expect(screen.getByText(/Quantidade convertida: 170 G = 0,17 KG/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA"), { target: { value: "0.2" } });
    expect(screen.queryByText(/Quantidade convertida/)).toBeNull();
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
    fireEvent.change(screen.getByLabelText(/Preço no salão/), { target: { value: "60" } });

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

describe("A preencher: o que ainda falta de ficha, com impressão", () => {
  const PURE_BUFFET = { id: "b1", name: "Purê de abóbora", unit: "KG", pending: true, pendingSince: "2026-10-05T12:00:00.000Z", completedAt: null, requestedBy: "Beto", notes: "batata, manteiga e leite", wasteEntries: 4, wasteQuantity: 9.5, lastWasteOn: "2026-10-10" };
  const FAROFA = { id: "b2", name: "Farofa de bacon", unit: "KG", pending: true, pendingSince: "2026-10-01T12:00:00.000Z", completedAt: null, requestedBy: null, notes: null, wasteEntries: 1, wasteQuantity: 2, lastWasteOn: "2026-10-02" };
  const ARROZ = { id: "b3", name: "Arroz de forno", unit: "KG", pending: false, pendingSince: null, completedAt: "2026-10-09T12:00:00.000Z", requestedBy: null, notes: null, wasteEntries: 0, wasteQuantity: 0, lastWasteOn: null };

  beforeEach(() => { vi.spyOn(window, "print").mockImplementation(() => undefined); });

  async function abrirAPreencher(itens = [PURE_BUFFET, FAROFA, ARROZ]) {
    vi.mocked(getBuffetDishes).mockResolvedValue(itens);
    render(
      <SessionContext.Provider value={SESSAO}>
        <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
      </SessionContext.Provider>,
    );
    await screen.findByText("Fichas montadas");
    fireEvent.click(screen.getByRole("tab", { name: /A preencher/ }));
  }

  test("a aba soma o que falta (do desperdício, sem ficha, incompleta) e agrupa por origem", async () => {
    await abrirAPreencher();
    // 2 do desperdício + Purê de batata (sem ficha) + Risoto de funghi (custo parcial) + Risoto de camarão (montado, a conferir).
    expect(screen.getByRole("tab", { name: "A preencher (5)" })).toBeInTheDocument();
    const aguardando = await screen.findByRole("region", { name: /Aguardando ficha/ });
    expect(within(aguardando).getByText("Purê de abóbora")).toBeInTheDocument();
    expect(within(aguardando).getByText(/4 lançamentos · 9,5 KG perdidos · pedido por Beto/)).toBeInTheDocument();
    // O que mais saiu vem primeiro.
    expect(within(aguardando).getAllByRole("button").map((b) => b.textContent)[0]).toMatch(/Purê de abóbora/);
    expect(within(screen.getByRole("region", { name: "Cadastrados sem ficha" })).getByText("Purê de batata")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Ficha incompleta/ })).getByText("Risoto de funghi")).toBeInTheDocument();
    // Já pronto não conta como falta, mas fica à mão.
    expect(screen.getByText("Preparações do buffet já com ficha (1)")).toBeInTheDocument();
  });

  test("nada por preencher: explica e ainda oferece a folha em branco", async () => {
    vi.mocked(getDishes).mockResolvedValue([{ ...RISOTO, conferidaEm: "2026-10-15T12:00:00.000Z" }]);
    await abrirAPreencher([]);
    expect(await screen.findByText("Nenhuma ficha por preencher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir folha em branco" })).toBeInTheDocument();
  });

  test("a busca acha sem acento e esconde os grupos que não casam", async () => {
    await abrirAPreencher();
    fireEvent.change(screen.getByLabelText("Buscar prato"), { target: { value: "pure de" } });
    expect(screen.getByText("Purê de abóbora")).toBeInTheDocument();
    expect(screen.getByText("Purê de batata")).toBeInTheDocument();
    expect(screen.queryByText("Risoto de funghi")).toBeNull();
    expect(screen.queryByRole("region", { name: /Ficha incompleta/ })).toBeNull();
  });

  test("escolhidos saem impressos com o nome já escrito; o do desperdício leva o que a equipe disse que tem", async () => {
    await abrirAPreencher();
    expect(screen.getByRole("button", { name: "Imprimir escolhidos" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Escolher Purê de abóbora para imprimir"));
    fireEvent.click(screen.getByLabelText("Escolher Purê de batata para imprimir"));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir escolhidos (2)" }));

    await waitFor(() => expect(window.print).toHaveBeenCalled());
    const folhas = document.body.textContent ?? "";
    expect(folhas).toContain("Leva, segundo quem lançou o desperdício: batata, manteiga e leite");
    expect(folhas).toContain("Purê de batata");
  });

  test("escolher todos pega só o que a busca deixou visível, e limpar zera", async () => {
    await abrirAPreencher();
    fireEvent.change(screen.getByLabelText("Buscar prato"), { target: { value: "pure" } });
    fireEvent.click(screen.getByRole("button", { name: "Escolher todos (2)" }));
    expect(screen.getByRole("button", { name: "Imprimir escolhidos (2)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.getByRole("button", { name: "Imprimir escolhidos" })).toBeDisabled();
  });

  test("imprimir em branco abre o diálogo da folha sem prato (para o que não tem cadastro)", async () => {
    await abrirAPreencher();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir folha em branco" }));
    expect(await screen.findByRole("heading", { name: "Imprimir ficha em branco" })).toBeInTheDocument();
  });

  test("abrir uma que aguarda mostra o aviso com o que está esperando valor, e deixa montar a ficha", async () => {
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => id === "b1" ? detalhe(resumo({ id: "b1", name: "Purê de abóbora", yieldUnit: "KG", isActive: false, itemsCount: 0, cmvPercentual: 0 }), [], { fichaDeBuffet: true, fichaPendente: true }) : DETALHES[id]);
    await abrirAPreencher();
    fireEvent.click(await screen.findByText("Purê de abóbora"));
    expect(await screen.findByRole("heading", { level: 2, name: "Purê de abóbora" })).toBeInTheDocument();
    expect(screen.getByText(/4\s+lançamentos \(9,5 KG\) ficam sem valor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reativar|Inativar|Copiar/ })).toBeNull();
  });

  test("salvar a ficha completa avisa quantos lançamentos passaram a ter valor", async () => {
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => id === "b1" ? detalhe(resumo({ id: "b1", name: "Purê de abóbora", yieldUnit: "KG", isActive: false, itemsCount: 0, cmvPercentual: 0 }), [], { fichaDeBuffet: true, fichaPendente: true }) : DETALHES[id]);
    vi.mocked(saveDish).mockResolvedValue({ id: "b1", desperdicio: { completa: true, revalorizados: 4, emOutraUnidade: 0, concluiuPendencia: true } });
    await abrirAPreencher();
    fireEvent.click(await screen.findByText("Purê de abóbora"));
    await screen.findByRole("heading", { level: 2, name: "Purê de abóbora" });
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Salvar/ }));
    expect(await screen.findByText(/4 lançamentos de desperdício passaram a ter valor/)).toBeInTheDocument();
  });

  test("a lista de pratos continua sem as preparações do buffet (o servidor não as devolve)", async () => {
    await abrirAPreencher();
    fireEvent.click(screen.getByRole("tab", { name: "Pratos" }));
    await screen.findByText("Risoto de camarão");
    expect(within(lista()).queryByText("Purê de abóbora")).toBeNull();
  });
});

describe("ficha de produção como ingrediente (ficha dentro de ficha)", () => {
  // O prato copiou a massa (dividida por 12 à mão) e soma o creme: a ficha de produção cobre os dois primeiros.
  const NHOQUE = resumo({ id: "d-nh", name: "Nhoque ao molho", menu: "DELIVERY", itemsCount: 3 });
  const DETALHE_NHOQUE = detalhe(NHOQUE, [
    ingrediente("i1", "FARINHA TRIGO", { quantity: 83.3333, wasteFactor: 0, unitCost: 5, productUnit: "KG", unitFactor: 0.001, itemCost: 0.42 }),
    ingrediente("i2", "BATATA ASTERIX", { quantity: 83.3333, wasteFactor: 0, unitCost: 4, productUnit: "KG", unitFactor: 0.001, itemCost: 0.33 }),
    ingrediente("i3", "CREME DE LEITE", { quantity: 150, wasteFactor: 0, unitCost: 10, productUnit: "KG", unitFactor: 0.001, itemCost: 1.5 }),
  ]);
  const MASSA = { id: "massa", externalCode: null, name: "Nhoque - Massa", unit: "UN", averageCost: 0.75, conversions: [], embalagemInferida: null, kind: "FICHA" as const, incompleta: false, motivo: null };
  const SUGESTAO = { componentDishId: "massa", name: "Nhoque - Massa", quantity: 1, unit: "UN", itemIds: ["i1", "i2"], unitCost: 0.75, incompleta: false, motivo: null };
  const REGIAO = "Ingredientes que já são uma ficha de produção";

  beforeEach(() => {
    vi.mocked(getDishes).mockResolvedValue([RISOTO, NHOQUE]);
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => (id === "d-nh" ? DETALHE_NHOQUE : DETALHES[id]));
    vi.mocked(getDishFichaSuggestions).mockResolvedValue([SUGESTAO]);
  });

  async function editarNhoque() {
    await abrir();
    await abrirPrato("Nhoque ao molho", "d-nh");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha" });
  }

  test("oferece trocar os ingredientes copiados pela ficha e troca por uma linha só, no lugar do primeiro", async () => {
    await editarNhoque();
    const banner = await screen.findByRole("region", { name: REGIAO });
    expect(within(banner).getByText(/Estes 2 ingredientes são a ficha/)).toBeInTheDocument();
    expect(within(banner).getByText("FARINHA TRIGO")).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole("button", { name: /Trocar por “Nhoque - Massa” \(1 UN\)/ }));

    expect(screen.queryByLabelText("Quantidade de FARINHA TRIGO")).toBeNull();
    expect(screen.queryByLabelText("Quantidade de BATATA ASTERIX")).toBeNull();
    expect(screen.getByLabelText("Quantidade de Nhoque - Massa")).toHaveValue(1);
    expect(screen.getByText("Ficha de produção")).toBeInTheDocument();
    expect(screen.getByText(/Custo da ficha/)).toBeInTheDocument();
    // A ordem da receita não muda: a ficha fica onde estava a farinha, antes do creme.
    const quantidades = screen.getAllByLabelText(/^Quantidade de /).map((c) => c.getAttribute("aria-label"));
    expect(quantidades).toEqual(["Quantidade de Nhoque - Massa", "Quantidade de CREME DE LEITE"]);
    expect(screen.queryByRole("region", { name: REGIAO })).toBeNull();
  });

  test("salvar depois da troca manda a ficha como ingrediente (sem produto) e o resto como estava", async () => {
    await editarNhoque();
    fireEvent.click(await screen.findByRole("button", { name: /Trocar por “Nhoque - Massa”/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveDish).mock.calls[0][0] as { items: Array<Record<string, unknown>> };
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ productId: null, componentDishId: "massa", quantity: 1, unit: "UN" });
    expect(payload.items[1]).toMatchObject({ productId: "p-i3", componentDishId: null, quantity: 150 });
  });

  test("quem mudou a quantidade de um dos ingredientes não recebe uma troca que não vale mais", async () => {
    await editarNhoque();
    await screen.findByRole("region", { name: REGIAO });
    fireEvent.change(screen.getByLabelText("Quantidade de FARINHA TRIGO"), { target: { value: "100" } });
    expect(screen.queryByRole("region", { name: REGIAO })).toBeNull();
  });

  test("quem já tirou um dos ingredientes não recebe uma troca que não vale mais", async () => {
    await editarNhoque();
    await screen.findByRole("region", { name: REGIAO });
    fireEvent.click(screen.getByRole("button", { name: "Remover FARINHA TRIGO da ficha" }));
    expect(screen.queryByRole("region", { name: REGIAO })).toBeNull();
  });

  test("se a consulta da sugestão falha, o editor abre normal", async () => {
    vi.mocked(getDishFichaSuggestions).mockRejectedValue(new Error("fora do ar"));
    await editarNhoque();
    expect(screen.getByLabelText("Quantidade de FARINHA TRIGO")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: REGIAO })).toBeNull();
  });

  test("a busca de ingrediente traz as fichas de produção junto dos produtos, marcadas, e a escolhida entra com 1 unidade", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([]);
    vi.mocked(searchDishFichas).mockResolvedValue([MASSA]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Nhoque com pesto" } });

    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "nho" } });
    const opcao = await screen.findByRole("option", { name: /Nhoque - Massa/ });
    expect(within(opcao).getByText("Ficha de produção")).toBeInTheDocument();
    expect(within(opcao).getByText(/rende em UN/)).toBeInTheDocument();
    fireEvent.click(opcao);

    expect(screen.getByLabelText("Quantidade de Nhoque - Massa")).toHaveValue(1);
    expect(screen.getByLabelText("Unidade de Nhoque - Massa")).toHaveValue("UN");
    // Não há "(informar)" para ficha de produção: a unidade é a de rendimento dela.
    expect([...(screen.getByLabelText("Unidade de Nhoque - Massa") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["UN"]);

    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveDish).mock.calls[0][0] as { items: Array<Record<string, unknown>> };
    expect(payload.items[0]).toMatchObject({ productId: null, componentDishId: "massa", unit: "UN", quantity: 1 });
  });

  test("a busca da ficha em edição não a oferece como ingrediente dela mesma", async () => {
    await editarNhoque();
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "nho" } });
    await waitFor(() => expect(searchDishFichas).toHaveBeenCalledWith("nho", "d-nh"));
  });

  test("ficha de produção incompleta avisa na linha que o custo depende dela", async () => {
    vi.mocked(searchDishProducts).mockResolvedValue([]);
    vi.mocked(searchDishFichas).mockResolvedValue([{ ...MASSA, averageCost: 0, incompleta: true, motivo: "Ficha de produção incompleta: complete os ingredientes dela." }]);
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "nho" } });
    fireEvent.click(await screen.findByRole("option", { name: /Nhoque - Massa/ }));
    expect(screen.getByText("Ficha de produção incompleta")).toBeInTheDocument();
    expect(screen.getByText(/complete os ingredientes dela/)).toBeInTheDocument();
  });

  test("o detalhe do prato marca o ingrediente que é ficha de produção", async () => {
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => id === "d-nh"
      ? detalhe(NHOQUE, [ingrediente("i1", "Nhoque - Massa", { productId: null, componentDishId: "massa", unit: "UN", quantity: 1, productUnit: "UN", unitCost: 0.75, unitFactor: 1, itemCost: 0.75 })])
      : DETALHES[id]);
    await abrir();
    await abrirPrato("Nhoque ao molho", "d-nh");
    expect(await screen.findByText("Ficha de produção")).toBeInTheDocument();
    expect(screen.getByText(/Custo da ficha/)).toBeInTheDocument();
  });
});

describe("ficha de produção x prato vendido", () => {
  const MASSA = resumo({ id: "m1", name: "Nhoque - Massa", menu: "CARDAPIO", yieldQty: 12, yieldUnit: "UN", salePriceDefault: null, itemsCount: 3, calculatedCost: 9, custoPorcao: 0.75, margemBruta: null, cmvPercentual: null, fichaDeProducao: true });
  const DETALHE_MASSA = detalhe(MASSA, [ingrediente("i1", "FARINHA TRIGO", { quantity: 1000, unit: "G" })], { fichaDeProducao: true });

  beforeEach(() => {
    vi.mocked(getDishes).mockImplementation(async (parametros) => (parametros?.tipo === "producao" ? [MASSA] : [RISOTO, PURE, FUNGHI, ANTIGO]));
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => (id === "m1" ? DETALHE_MASSA : DETALHES[id]));
  });

  async function abrirProducao() {
    render(
      <SessionContext.Provider value={SESSAO}>
        <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
      </SessionContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Produção (1)" }));
    await screen.findByText("Nhoque - Massa");
  }

  test("a aba Produção lista só as fichas de produção, com o custo de cada unidade; a lista de pratos não as traz", async () => {
    await abrirProducao();
    expect(screen.getByText(/Rende 12 UN/)).toBeInTheDocument();
    expect(screen.queryByText("Risoto de camarão")).toBeNull();
    expect(vi.mocked(getDishes)).toHaveBeenCalledWith({ showInactive: true, tipo: "producao" });
    fireEvent.click(screen.getByRole("tab", { name: "Pratos" }));
    await screen.findByText("Risoto de camarão");
    expect(screen.queryByText("Nhoque - Massa")).toBeNull();
  });

  test("o detalhe de uma ficha de produção mostra o custo por unidade e não tem preço, CMV, margem nem preços por canal", async () => {
    await abrirProducao();
    fireEvent.click(screen.getByText("Nhoque - Massa").closest("button") as HTMLElement);
    await screen.findByRole("heading", { level: 2, name: "Nhoque - Massa" });
    expect(screen.getByText("Custo por UN")).toBeInTheDocument();
    expect(screen.getByText("Custo da receita inteira")).toBeInTheDocument();
    expect(screen.queryByText("CMV")).toBeNull();
    expect(screen.queryByText("Margem bruta")).toBeNull();
    expect(screen.queryByText("Preço de venda")).toBeNull();
    expect(screen.queryByText("Falta o preço de venda")).toBeNull();
    expect(screen.queryByText(/Preços por canal/)).toBeNull();
  });

  test("nova ficha de produção: formulário sem preço, categoria nem cardápio, e grava como ficha de produção", async () => {
    await abrirProducao();
    fireEvent.click(screen.getAllByRole("button", { name: "Nova ficha de produção" })[0]);
    await screen.findByRole("heading", { name: "Nova ficha de produção" });
    expect(screen.queryByLabelText(/Preço/)).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Cardápio do prato" })).toBeNull();
    expect(screen.queryByText("Categoria")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Nome da ficha/), { target: { value: "Molho base" } });
    fireEvent.change(screen.getByLabelText("Rendimento"), { target: { value: "5" } });
    vi.mocked(searchDishProducts).mockResolvedValue([{ id: "p1", externalCode: null, name: "TOMATE", unit: "KG", averageCost: 8, conversions: [], embalagemInferida: null }]);
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "tom" } });
    fireEvent.click(await screen.findByRole("option", { name: /TOMATE/ }));
    fireEvent.change(screen.getByLabelText("Quantidade de TOMATE"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar ficha de produção" }));

    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ name: "Molho base", fichaDeProducao: true, salePriceDefault: null, categoryId: "", alsoMenu: null, yieldQty: 5 });
  });

  test("editar uma ficha de produção mantém o tipo e não manda preço", async () => {
    await abrirProducao();
    fireEvent.click(screen.getByText("Nhoque - Massa").closest("button") as HTMLElement);
    await screen.findByRole("heading", { level: 2, name: "Nhoque - Massa" });
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha de produção" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ id: "m1", fichaDeProducao: true, salePriceDefault: null });
  });

  test("tornar ficha de produção: um prato vendido é convertido ao salvar, sem preço nem categoria", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha" });
    fireEvent.click(screen.getByRole("button", { name: "Tornar ficha de produção" }));
    expect(await screen.findByRole("heading", { name: "Editar ficha de produção" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Preço/)).toBeNull();
    expect(screen.getByText(/deixa de ser um prato vendido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ id: "d1", fichaDeProducao: true, salePriceDefault: null, categoryId: "", alsoMenu: null });
  });

  test("desfazer a conversão devolve o preço e o cardápio ao formulário", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha" });
    fireEvent.click(screen.getByRole("button", { name: "Tornar ficha de produção" }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(screen.getByLabelText(/Preço no salão/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Cardápio do prato" })).toBeInTheDocument();
  });

  test("ficha que já é de produção não oferece o botão", async () => {
    await abrirProducao();
    fireEvent.click(screen.getByText("Nhoque - Massa").closest("button") as HTMLElement);
    await screen.findByRole("heading", { level: 2, name: "Nhoque - Massa" });
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha de produção" });
    expect(screen.queryByRole("button", { name: "Tornar ficha de produção" })).toBeNull();
  });

  test("a lista de produção esconde as inativas até ligar 'Mostrar inativas', e marca como Inativa", async () => {
    const VELHA = resumo({ id: "m2", name: "Molho antigo", isActive: false, fichaDeProducao: true, salePriceDefault: null, itemsCount: 1 });
    vi.mocked(getDishes).mockImplementation(async (parametros) => (parametros?.tipo === "producao" ? [MASSA, VELHA] : [RISOTO, PURE, FUNGHI, ANTIGO]));
    await abrirProducao();
    expect(screen.queryByText("Molho antigo")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Mostrar inativas \(1\)/));
    expect(screen.getByText("Molho antigo")).toBeInTheDocument();
    expect(screen.getByText("Inativa")).toBeInTheDocument();
  });

  test("ficha de produção em uso mostra onde é usada e trava a unidade de rendimento", async () => {
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => (id === "m1" ? { ...DETALHE_MASSA, usadaEm: [{ id: "d9", name: "Nhoque ao molho" }] } : DETALHES[id]));
    await abrirProducao();
    fireEvent.click(screen.getByText("Nhoque - Massa").closest("button") as HTMLElement);
    await screen.findByRole("heading", { level: 2, name: "Nhoque - Massa" });
    expect(screen.getByRole("heading", { name: /Usada em/ })).toBeInTheDocument();
    expect(screen.getAllByText("Nhoque ao molho").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha de produção" });
    expect(screen.getByText(/Esta ficha é ingrediente de 1 ficha/)).toBeInTheDocument();
    expect(screen.getByLabelText("Unidade do rendimento")).toBeDisabled();
  });

  test("converter um prato em ficha de produção leva para a aba Produção", async () => {
    vi.mocked(saveDish).mockResolvedValue({ id: "d1" });
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByRole("heading", { name: "Editar ficha" });
    fireEvent.click(screen.getByRole("button", { name: "Tornar ficha de produção" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("tab", { name: /Produção/, selected: true })).toBeInTheDocument();
    expect(await screen.findByText(/agora é uma ficha de produção/)).toBeInTheDocument();
  });

  test("nova ficha de produção com o seletor em Delivery grava no cardápio padrão, não no delivery", async () => {
    await abrirProducao();
    fireEvent.click(screen.getAllByRole("button", { name: "Nova ficha de produção" })[0]);
    await screen.findByRole("heading", { name: "Nova ficha de produção" });
    fireEvent.change(screen.getByLabelText(/Nome da ficha/), { target: { value: "Molho base" } });
    vi.mocked(searchDishProducts).mockResolvedValue([{ id: "p1", externalCode: null, name: "TOMATE", unit: "KG", averageCost: 8, conversions: [], embalagemInferida: null }]);
    fireEvent.change(screen.getByRole("combobox", { name: /Buscar produto/ }), { target: { value: "tom" } });
    fireEvent.click(await screen.findByRole("option", { name: /TOMATE/ }));
    fireEvent.change(screen.getByLabelText("Quantidade de TOMATE"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar ficha de produção" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ fichaDeProducao: true, menu: "CARDAPIO" });
  });

  test("a aba Produção não mostra o seletor de salão/delivery", async () => {
    await abrirProducao();
    expect(screen.queryByRole("radiogroup", { name: /Cardápio|cardápio/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delivery/ })).toBeNull();
  });

  test("backend ainda sem ?tipo (devolve tudo junto): cada lista fica só com o que é dela", async () => {
    vi.mocked(getDishes).mockResolvedValue([RISOTO, PURE, MASSA]);
    render(
      <SessionContext.Provider value={SESSAO}>
        <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
      </SessionContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: /Produção/ }));
    expect(await screen.findByText("Nhoque - Massa")).toBeInTheDocument();
    expect(screen.queryByText("Risoto de camarão")).toBeNull();
  });
});

describe("conferência da ficha pela cozinha", () => {
  beforeEach(() => {
    vi.mocked(confirmDishFicha).mockResolvedValue({ ok: true, conferidaEm: "2026-10-15T12:00:00.000Z" });
    vi.mocked(unconfirmDishFicha).mockResolvedValue({ ok: true });
  });

  test("ficha montada e não conferida avisa e deixa marcar como conferida; a tela recarrega o prato", async () => {
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    expect(screen.getByText("Ficha ainda não conferida")).toBeInTheDocument();
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => (id === "d1" ? { ...DETALHES.d1, conferidaEm: "2026-10-15T12:00:00.000Z", conferidaPor: "Ana" } : DETALHES[id]));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como conferida" }));
    await waitFor(() => expect(confirmDishFicha).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/Ficha conferida por Ana/)).toBeInTheDocument();
    expect(screen.queryByText("Ficha ainda não conferida")).toBeNull();
  });

  test("ficha conferida mostra quem e quando, e dá para desmarcar", async () => {
    vi.mocked(getDishDetail).mockImplementation(async (id: string) => (id === "d1" ? { ...DETALHES.d1, conferidaEm: "2026-10-15T12:00:00.000Z", conferidaPor: "Ana" } : DETALHES[id]));
    await abrir();
    await abrirPrato("Risoto de camarão", "d1");
    expect(screen.getByText(/Ficha conferida por Ana/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desmarcar" }));
    await waitFor(() => expect(unconfirmDishFicha).toHaveBeenCalledWith("d1"));
  });

  test("ficha sem ingredientes não oferece conferir", async () => {
    await abrir();
    await abrirPrato("Purê de batata", "d2");
    expect(screen.queryByText("Ficha ainda não conferida")).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar como conferida" })).toBeNull();
  });

  test("a aba A preencher lista as fichas montadas a conferir", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("tab", { name: /A preencher/ }));
    expect(await screen.findByRole("region", { name: "Ficha montada, a conferir com a cozinha" })).toBeInTheDocument();
  });
});

