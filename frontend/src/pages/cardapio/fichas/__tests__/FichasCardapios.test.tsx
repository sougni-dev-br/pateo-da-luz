import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, DishCategory, DishDetail, DishListItem, DishRevision } from "../../../../api/client";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getDishes: vi.fn(),
  getDishCategories: vi.fn(),
  getDishDetail: vi.fn(),
  getDishRevisions: vi.fn(),
  bulkUpdateDishes: vi.fn(),
  saveDish: vi.fn(),
  saveDishCategory: vi.fn(),
  searchDishProducts: vi.fn(),
}));

import { bulkUpdateDishes, getDishCategories, getDishDetail, getDishRevisions, getDishes, saveDish, saveDishCategory } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { FichasTecnicas } from "../FichasTecnicas";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

const cat = (parcial: Partial<DishCategory> & { id: string; name: string }): DishCategory => ({
  sortOrder: 0, isActive: true, notes: null, parentId: null, menu: "CARDAPIO", dishesCount: 0, ...parcial,
});
const CATEGORIAS = [
  cat({ id: "massas", name: "Massas" }),
  cat({ id: "fresca", name: "Fresca", parentId: "massas" }),
  cat({ id: "pizzas", name: "Pizzas", menu: "DELIVERY" }),
];

const ref = (id: string, name: string, parentId: string | null = null, parentName: string | null = null, menu: "CARDAPIO" | "DELIVERY" = "CARDAPIO") =>
  ({ id, name, parentId, parentName, menu });

function resumo(parcial: Partial<DishListItem>): DishListItem {
  return {
    id: "d", code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN", isActive: true,
    itemsCount: 1, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 10, custoPorcao: 10,
    margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial,
  };
}

const PENNE = resumo({ id: "d1", name: "Penne ao sugo", category: ref("fresca", "Fresca", "massas", "Massas"), code: "PRAT-1" });
const FEIJOADA = resumo({ id: "d2", name: "Feijoada", itemsCount: 0, cmvPercentual: 0 });
const PIZZA = resumo({ id: "d3", name: "Pizza Margherita", menu: "DELIVERY", itemsCount: 0, cmvPercentual: 0, salePriceDefault: null, listingsCount: 2, listingPriceMin: 59.9, listingPriceMax: 69.9 });
const PIZZA2 = resumo({ id: "d4", name: "Pizza Calabresa", menu: "DELIVERY", itemsCount: 0, cmvPercentual: 0, salePriceDefault: null });

const detalhe = (base: DishListItem, extra: Partial<DishDetail> = {}): DishDetail => {
  const { listingsCount: _a, listingPriceMin: _b, listingPriceMax: _c, ...resto } = base;
  return { ...resto, notes: null, items: [], listings: [], createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-08T15:30:00.000Z", ...extra };
};

const ingrediente = (id: string, nome: string, qtd: number, extra: object = {}) => ({
  id, productId: `p-${id}`, productCode: "0101", productName: nome, productUnit: "KG", quantity: qtd, unit: "G", wasteFactor: 0.05,
  unitCost: 40, unitFactor: 0.001, itemCost: 6, issue: null, conversions: [], embalagemInferida: null, notes: null, sortOrder: 0, ...extra,
});

const DETALHES: Record<string, DishDetail> = {
  d1: detalhe(PENNE, { items: [ingrediente("i1", "MACARRAO", 100), ingrediente("i2", "TOMATE", 50)] }),
  d2: detalhe(FEIJOADA),
  d3: detalhe(PIZZA),
};

const revisao = (id: string, acao: DishRevision["action"], quem: string, quando: string, custo: number, itens: Array<[string, number]>): DishRevision => ({
  id, action: acao, userName: quem, createdAt: quando, costPerServing: custo, salePrice: 50, cmvPercent: 20,
  snapshot: {
    name: "Penne ao sugo", code: "PRAT-1", menu: "CARDAPIO", category: { id: "fresca", name: "Fresca", parentName: "Massas" }, salePriceDefault: 50,
    yieldQty: 1, yieldUnit: "UN", notes: null, isActive: true, custoPorcao: custo, cmvPercentual: 20, custoIncompleto: false,
    items: itens.map(([nome, qtd], i) => ({ productId: `p${i}`, productName: nome, quantity: qtd, unit: "G", wasteFactor: 0, itemCost: 1 })),
  },
});

const lista = () => screen.getByRole("list");
const itemDaLista = (nome: string) => within(lista()).getByText(nome).closest("button, label") as HTMLElement;

async function abrir(aba: "Painel" | "Pratos" | "Categorias" = "Pratos") {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><FichasTecnicas /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  await screen.findByText("Fichas montadas");
  if (aba !== "Painel") fireEvent.click(screen.getByRole("tab", { name: aba }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDishes).mockResolvedValue([PENNE, FEIJOADA, PIZZA, PIZZA2]);
  vi.mocked(getDishCategories).mockResolvedValue(CATEGORIAS);
  vi.mocked(getDishDetail).mockImplementation(async (id: string) => DETALHES[id]);
  vi.mocked(getDishRevisions).mockResolvedValue([]);
  vi.mocked(bulkUpdateDishes).mockResolvedValue({ atualizados: 2, categoriasLimpas: 0 });
  vi.mocked(saveDish).mockResolvedValue({ id: "novo" });
  vi.mocked(saveDishCategory).mockResolvedValue(cat({ id: "x", name: "X" }));
  vi.spyOn(window, "print").mockImplementation(() => undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cardápio (salão) x delivery", () => {
  test("o seletor mostra quantos pratos há em cada um e filtra a lista", async () => {
    await abrir();
    const seletor = screen.getByRole("radiogroup", { name: "Cardápio" });
    expect(within(seletor).getByRole("radio", { name: /Todos\s*4/ })).toBeInTheDocument();
    expect(within(seletor).getByRole("radio", { name: /Cardápio\s*2/ })).toBeInTheDocument();
    expect(within(seletor).getByRole("radio", { name: /Delivery\s*2/ })).toBeInTheDocument();

    fireEvent.click(within(seletor).getByRole("radio", { name: /Delivery/ }));
    expect(within(lista()).getByText("Pizza Margherita")).toBeInTheDocument();
    expect(within(lista()).queryByText("Penne ao sugo")).toBeNull();
  });

  test("com 'Todos' cada prato diz de qual cardápio é; com um só, não repete", async () => {
    await abrir();
    expect(within(itemDaLista("Pizza Margherita")).getByText(/Delivery ·/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    expect(within(itemDaLista("Pizza Margherita")).queryByText(/Delivery ·/)).toBeNull();
  });

  test("o painel acompanha o cardápio escolhido", async () => {
    await abrir("Painel");
    expect(screen.getByText("de 4")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    expect(screen.getByText("de 2")).toBeInTheDocument();
  });

  test("a lista mostra a categoria com o caminho Massas › Fresca", async () => {
    await abrir();
    expect(within(itemDaLista("Penne ao sugo")).getByText(/Massas › Fresca/)).toBeInTheDocument();
  });

  test("a ficha mostra o cardápio e o caminho da categoria", async () => {
    await abrir();
    fireEvent.click(itemDaLista("Penne ao sugo"));
    await screen.findByRole("heading", { level: 2, name: "Penne ao sugo" });
    const meta = document.querySelector(".ft-detalhe-meta") as HTMLElement;
    expect(within(meta).getByText("Cardápio")).toBeInTheDocument();
    expect(within(meta).getByText("Massas › Fresca")).toBeInTheDocument();
  });
});

describe("formulário: cardápio e categoria", () => {
  async function novoPrato() {
    await abrir();
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
  }

  test("o seletor de categoria agrupa principal e subcategorias, só do cardápio do prato", async () => {
    await novoPrato();
    const select = screen.getByLabelText("Categoria") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Sem categoria", "Massas (geral)", "Fresca"]);
    expect(select.querySelector("optgroup")?.getAttribute("label")).toBe("Massas");
  });

  test("trocar para delivery mostra as categorias de lá e tira a que ficou do outro lado", async () => {
    await novoPrato();
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "fresca" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio do prato" })).getByRole("radio", { name: "Delivery" }));
    const select = screen.getByLabelText("Categoria") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Sem categoria", "Pizzas"]);
  });

  test("novo prato nasce no cardápio escolhido no alto da tela e salva o cardápio", async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo prato" })[0]);
    await screen.findByRole("heading", { name: "Novo prato" });
    expect(within(screen.getByRole("radiogroup", { name: "Cardápio do prato" })).getByRole("radio", { name: "Delivery" })).toHaveAttribute("aria-checked", "true");

    fireEvent.change(screen.getByLabelText(/Nome do prato/), { target: { value: "Pizza nova" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "pizzas" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar prato" }));
    await waitFor(() => expect(saveDish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDish).mock.calls[0][0]).toMatchObject({ name: "Pizza nova", menu: "DELIVERY", categoryId: "pizzas" });
  });
});

describe("filtro de categoria da lista", () => {
  test("mostra quantos pratos há em cada categoria e deixa filtrar os sem categoria", async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    fireEvent.click(screen.getByRole("button", { name: /Categoria, ordem e inativos/ }));
    const select = screen.getByLabelText("Categoria") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Todas", "Sem categoria · 2", "Pizzas · 0"]);

    fireEvent.change(select, { target: { value: "sem-categoria" } });
    expect(screen.getByText("Pizza Margherita")).toBeInTheDocument();
    expect(screen.getByText("Pizza Calabresa")).toBeInTheDocument();
  });

  test("categoria vazia explica o motivo e leva aos pratos sem categoria; os chips acompanham o filtro", async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    fireEvent.click(screen.getByRole("button", { name: /Categoria, ordem e inativos/ }));
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "pizzas" } });

    expect(screen.getByText(/Nenhum prato foi classificado em “Pizzas” ainda\. 2 pratos estão sem categoria/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Todos\s*0/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver os pratos sem categoria" }));
    expect(screen.getByText("Pizza Margherita")).toBeInTheDocument();
  });
});

describe("organizar e imprimir em lote", () => {
  async function selecionar(...nomes: string[]) {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar vários" }));
    for (const nome of nomes) fireEvent.click(screen.getByRole("checkbox", { name: `Marcar ${nome}` }));
  }

  test("marca pratos, abre o diálogo e move todos para uma categoria do delivery", async () => {
    await selecionar("Pizza Margherita", "Pizza Calabresa");
    expect(screen.getByText("2 pratos marcados")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Organizar…" }));
    const dialogo = await screen.findByRole("dialog");
    // Os dois são do delivery: a categoria já se libera sem pedir o cardápio.
    fireEvent.change(within(dialogo).getByLabelText("Categoria"), { target: { value: "pizzas" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(bulkUpdateDishes).toHaveBeenCalledWith({ ids: ["d3", "d4"], categoryId: "pizzas" }));
    expect(await screen.findByText(/2 pratos organizados/)).toBeInTheDocument();
  });

  test("seleção mista só libera as categorias depois de escolher o cardápio", async () => {
    await selecionar("Penne ao sugo", "Pizza Margherita");
    fireEvent.click(screen.getByRole("button", { name: "Organizar…" }));
    const dialogo = await screen.findByRole("dialog");
    const [cardapio, categoria] = within(dialogo).getAllByRole("combobox");
    expect(categoria).toBeDisabled();
    fireEvent.change(cardapio, { target: { value: "DELIVERY" } });
    expect(categoria).not.toBeDisabled();
  });

  test("erro do servidor aparece no diálogo e a seleção continua", async () => {
    vi.mocked(bulkUpdateDishes).mockRejectedValue(new Error("2 pratos não são do cardápio da categoria."));
    await selecionar("Pizza Margherita", "Pizza Calabresa");
    fireEvent.click(screen.getByRole("button", { name: "Organizar…" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Cardápio"), { target: { value: "CARDAPIO" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aplicar" }));
    expect(await within(dialogo).findByText(/não são do cardápio da categoria/)).toBeInTheDocument();
    expect(screen.getByText("2 pratos marcados")).toBeInTheDocument();
  });

  test("'Marcar os N da lista' respeita o filtro", async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    fireEvent.click(screen.getByRole("button", { name: "Selecionar vários" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcar os 2 da lista" }));
    expect(screen.getByText("2 pratos marcados")).toBeInTheDocument();
  });

  test("imprimir fichas dos marcados abre a impressão com uma folha por prato, já com o nome", async () => {
    await selecionar("Penne ao sugo", "Feijoada");
    fireEvent.click(screen.getByRole("button", { name: "Imprimir fichas" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const folhas = document.querySelectorAll(".fp-folha");
    expect(folhas).toHaveLength(2);
    expect(folhas[0].textContent).toContain("Penne ao sugo");
    expect(folhas[0].textContent).toContain("Fresca"); // subcategoria
    expect(folhas[1].textContent).toContain("Feijoada");
  });
});

describe("ficha impressa", () => {
  test("imprimir a ficha aberta traz os ingredientes preenchidos e linhas em branco para anotar", async () => {
    await abrir();
    fireEvent.click(itemDaLista("Penne ao sugo"));
    await screen.findByRole("heading", { level: 2, name: "Penne ao sugo" });
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ficha" }));

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const folha = document.querySelector(".fp-folha") as HTMLElement;
    const linhas = folha.querySelectorAll(".fp-tabela tbody tr");
    expect(linhas).toHaveLength(16);
    expect(linhas[0].textContent).toContain("MACARRAO");
    expect(linhas[0].textContent).toContain("100");
    expect(linhas[1].textContent).toContain("TOMATE");
    expect(linhas[2].textContent).not.toContain("MACARRAO"); // o resto fica em branco
    expect(folha.textContent).toContain("(X) Salão");
  });

  test("ficha em branco: escolhe cardápio, categoria, folhas e linhas; sai com o cardápio marcado", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ficha em branco" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Cardápio já marcado na folha"), { target: { value: "DELIVERY" } });
    fireEvent.change(within(dialogo).getByLabelText("Categoria já escrita na folha"), { target: { value: "pizzas" } });
    fireEvent.change(within(dialogo).getByLabelText("Quantas folhas"), { target: { value: "3" } });
    fireEvent.change(within(dialogo).getByLabelText("Linhas de ingrediente"), { target: { value: "20" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Imprimir" }));

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const folhas = document.querySelectorAll(".fp-folha");
    expect(folhas).toHaveLength(3);
    expect(folhas[0].querySelectorAll(".fp-tabela tbody tr")).toHaveLength(20);
    expect(folhas[0].textContent).toContain("(X) Delivery");
    expect(folhas[0].textContent).toContain("Pizzas");
    expect(folhas[2].textContent).toContain("Folha 3 de 3");
  });

  test("número de folhas fora de 1–50 trava o botão", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ficha em branco" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Quantas folhas"), { target: { value: "99" } });
    expect(within(dialogo).getByRole("button", { name: "Imprimir" })).toBeDisabled();
  });

  test("depois da impressão o portal some e a tela volta ao normal", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ficha em branco" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Imprimir" }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(document.body.classList.contains("imprimindo-folhas-fichas")).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.querySelector(".fp-raiz")).toBeNull());
    expect(document.body.classList.contains("imprimindo-folhas-fichas")).toBe(false);
  });
});

describe("histórico da ficha", () => {
  test("só carrega quando a seção é aberta e mostra quem mudou o quê e o custo", async () => {
    vi.mocked(getDishRevisions).mockResolvedValue([
      revisao("r2", "ALTERADA", "Felipe", "2026-10-08T18:00:00.000Z", 8, [["MACARRAO", 120], ["TOMATE", 50]]),
      revisao("r1", "CRIADA", "Eli", "2026-10-07T11:00:00.000Z", 6, [["MACARRAO", 100], ["TOMATE", 50]]),
    ]);
    await abrir();
    fireEvent.click(itemDaLista("Penne ao sugo"));
    await screen.findByRole("heading", { level: 2, name: "Penne ao sugo" });
    expect(getDishRevisions).not.toHaveBeenCalled();

    const detalhes = screen.getByText("Histórico da ficha").closest("details") as HTMLDetailsElement;
    detalhes.open = true;
    fireEvent(detalhes, new Event("toggle"));

    await waitFor(() => expect(getDishRevisions).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText("MACARRAO: 100 G → 120 G")).toBeInTheDocument();
    expect(screen.getByText("Ficha criada com 2 ingredientes")).toBeInTheDocument();
    expect(screen.getByText("Felipe")).toBeInTheDocument();
    expect(screen.getByText("Criada")).toBeInTheDocument();
  });

  test("prato sem versões explica que o registro começa na próxima gravação", async () => {
    await abrir();
    fireEvent.click(itemDaLista("Penne ao sugo"));
    await screen.findByRole("heading", { level: 2, name: "Penne ao sugo" });
    const detalhes = screen.getByText("Histórico da ficha").closest("details") as HTMLDetailsElement;
    detalhes.open = true;
    fireEvent(detalhes, new Event("toggle"));
    expect(await screen.findByText(/ainda não tem versões salvas/)).toBeInTheDocument();
  });
});

describe("categorias e subcategorias", () => {
  test("a árvore mostra a subcategoria dentro da principal, só do cardápio escolhido", async () => {
    await abrir("Categorias");
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Massas")).toBeInTheDocument();
    expect(within(tabela).getByText("Fresca")).toBeInTheDocument();
    expect(within(tabela).getByText("Pizzas")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    expect(within(screen.getByRole("table")).queryByText("Massas")).toBeNull();
  });

  test("criar subcategoria a partir da principal envia o pai e herda o cardápio", async () => {
    await abrir("Categorias");
    fireEvent.click(screen.getByRole("button", { name: "Nova subcategoria de Pizzas" }));
    expect(await screen.findByText("Nova subcategoria")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Doces" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar subcategoria" }));

    await waitFor(() => expect(saveDishCategory).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveDishCategory).mock.calls[0][0]).toMatchObject({ name: "Doces", parentId: "pizzas", menu: "DELIVERY" });
  });

  test("subcategoria não tem botão de criar subcategoria (só dois níveis)", async () => {
    await abrir("Categorias");
    expect(screen.queryByRole("button", { name: "Nova subcategoria de Fresca" })).toBeNull();
  });

  test("categoria nova segue o cardápio escolhido no alto da tela", async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Cardápio" })).getByRole("radio", { name: /Delivery/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Categorias" }));
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Bebidas" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    await waitFor(() => expect(saveDishCategory).toHaveBeenCalled());
    expect(vi.mocked(saveDishCategory).mock.calls[0][0]).toMatchObject({ name: "Bebidas", menu: "DELIVERY", parentId: null });
  });
});
