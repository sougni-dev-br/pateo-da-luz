import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getProductFormOptions = vi.fn();
const getProductById = vi.fn();
const getSimilarProducts = vi.fn();
const saveProduct = vi.fn();
const addProductAlias = vi.fn();

vi.mock("../../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getProductFormOptions: (...args: unknown[]) => getProductFormOptions(...args),
  getProductById: (...args: unknown[]) => getProductById(...args),
  getSimilarProducts: (...args: unknown[]) => getSimilarProducts(...args),
  saveProduct: (...args: unknown[]) => saveProduct(...args),
  addProductAlias: (...args: unknown[]) => addProductAlias(...args),
  saveCategory: vi.fn(),
  saveSubcategory: vi.fn()
}));
vi.mock("../../../context/SessionContext", () => ({ useSession: () => ({ user: { id: "u1", role: "ADMIN" } }) }));
vi.mock("../../../lib/permissions", () => ({ hasPermission: () => true }));

import { ProductEditor } from "../editor/ProductEditor";

const NATURES = [
  { value: "INSUMO", label: "Insumo ou mercadoria", description: "Alimento.", dreGroups: ["CMV_COMPRAS"], controlsStock: true, fisico: true, entraNoCmv: true },
  { value: "DURAVEL", label: "Utensílio, equipamento ou uniforme", description: "Bem que dura.", dreGroups: ["DESPESAS_GERAIS"], controlsStock: false, fisico: true, entraNoCmv: false }
];

const opcoes = {
  categories: [{ id: "c1", name: "INSUMOS", isActive: true }],
  subcategories: [],
  sectors: [{ id: "s1", name: "ESTOQUE", isActive: true, countOrder: 1 }],
  units: [{ id: "u1", code: "KG", name: "Quilograma", isActive: true }],
  suppliers: [],
  dreCategories: [
    { id: "d1", name: "Custo de Alimentos", dreGroup: "CMV_COMPRAS", sortOrder: 1, isActive: true },
    { id: "d2", name: "Utensílios Operacionais", dreGroup: "DESPESAS_GERAIS", sortOrder: 2, isActive: true }
  ],
  natures: NATURES,
  nextCode: "1500"
};

const montar = (url = "/estoque/produtos/novo") => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/estoque/produtos/novo" element={<ProductEditor />} />
      <Route path="/estoque/produtos/:id/editar" element={<ProductEditor />} />
      <Route path="/estoque/produtos" element={<div>lista de produtos</div>} />
    </Routes>
  </MemoryRouter>
);

const continuar = () => screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement;
const salvar = () => screen.getAllByRole("button", { name: /Salvar produto|Salvar alterações/ })[0] as HTMLButtonElement;

describe("ProductEditor", () => {
  beforeEach(() => {
    getProductFormOptions.mockResolvedValue(opcoes);
    getSimilarProducts.mockResolvedValue({ items: [] });
    saveProduct.mockResolvedValue({ id: "novo1" });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("cadastro novo abre perguntando o que é o item e só libera o passo seguinte depois da escolha", async () => {
    montar();
    expect(await screen.findByText("O que é este item?")).toBeTruthy();
    expect(continuar().disabled).toBe(true);
    expect(salvar().disabled).toBe(true);
    expect(screen.getByText("1 pendência")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Insumo ou mercadoria/ }));
    expect(continuar().disabled).toBe(false);
  });

  test("não deixa salvar enquanto faltar campo e libera quando o cadastro está completo", async () => {
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Insumo ou mercadoria/ }));
    fireEvent.click(continuar());

    fireEvent.change(await screen.findByPlaceholderText("Como a equipe chama o item"), { target: { value: "Farinha de trigo" } });
    expect(salvar().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c1" } });
    // Categoria INSUMOS sugere a categoria DRE usual; falta só o setor.
    fireEvent.click(continuar());
    expect(await screen.findByRole("heading", { name: "Classificação" })).toBeTruthy();
    expect((screen.getByLabelText(/Categoria DRE/) as HTMLSelectElement).value).toBe("d1");
    expect(salvar().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Setor da contagem"), { target: { value: "s1" } });
    expect(salvar().disabled).toBe(false);
  });

  test("utensílio não pede setor, mas mantém o passo de estoque e compra", async () => {
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Utensílio/ }));
    expect(screen.getByRole("button", { name: /Estoque e compra/ })).toBeTruthy();
    fireEvent.click(continuar());

    fireEvent.change(await screen.findByPlaceholderText("Como a equipe chama o item"), { target: { value: "Panela de pressão" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c1" } });
    fireEvent.click(continuar());

    fireEvent.change(await screen.findByLabelText(/Categoria DRE/), { target: { value: "d2" } });
    expect(screen.queryByLabelText("Setor da contagem")).toBeNull();
    expect(salvar().disabled).toBe(false);
  });

  test("salvar envia a natureza e volta para a lista", async () => {
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Utensílio/ }));
    fireEvent.click(continuar());
    fireEvent.change(await screen.findByPlaceholderText("Como a equipe chama o item"), { target: { value: "Panela de pressão" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c1" } });
    fireEvent.click(continuar());
    fireEvent.change(await screen.findByLabelText(/Categoria DRE/), { target: { value: "d2" } });

    fireEvent.click(salvar());
    expect(await screen.findByText("lista de produtos")).toBeTruthy();
    const corpo = saveProduct.mock.calls[0][0];
    expect(corpo.nature).toBe("DURAVEL");
    expect(corpo.controlsStock).toBe(false);
    expect(corpo.categoryName).toBe("INSUMOS");
  });

  test("a categoria DRE usual cadastrada na categoria é a sugerida; categorias da natureza vêm primeiro", async () => {
    getProductFormOptions.mockResolvedValue({
      ...opcoes,
      categories: [
        { id: "c9", name: "UTENSILIOS FICTICIOS", nature: "DURAVEL", defaultDreCategoryId: "d2", isActive: true },
        { id: "c1", name: "INSUMOS", nature: "INSUMO", defaultDreCategoryId: null, isActive: true }
      ]
    });
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Utensílio/ }));
    fireEvent.click(continuar());
    await screen.findByPlaceholderText("Como a equipe chama o item");

    const grupo = screen.getByRole("group", { name: /Categorias de utensílio/i });
    expect(grupo.textContent).toContain("UTENSILIOS FICTICIOS");
    expect(grupo.textContent).not.toContain("INSUMOS");

    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c9" } });
    fireEvent.click(continuar());
    expect((await screen.findByLabelText(/Categoria DRE/) as HTMLSelectElement).value).toBe("d2");
  });

  test("avisa quando já existe item de nome parecido", async () => {
    getSimilarProducts.mockResolvedValue({ items: [{ id: "x", name: "FARINHA TRIGO 5KG", externalCode: "381", unit: "UN", score: 2 }] });
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Insumo ou mercadoria/ }));
    fireEvent.click(continuar());
    fireEvent.change(await screen.findByPlaceholderText("Como a equipe chama o item"), { target: { value: "Farinha de trigo" } });
    expect(await screen.findByText(/FARINHA TRIGO 5KG/, undefined, { timeout: 2000 })).toBeTruthy();
  });

  test("produto antigo sem natureza abre na identificação, sem bloquear o salvamento", async () => {
    getProductById.mockResolvedValue({
      id: "p1", externalCode: "522", name: "CACHACA 700ML", isActive: true, controlsStock: true, unit: "KG", unitMeasureId: "u1",
      category: { id: "c1", name: "INSUMOS" }, dreCategoryId: "d1", inventorySector: { id: "s1", name: "ESTOQUE" }, nature: null
    });
    montar("/estoque/produtos/p1/editar");
    expect(await screen.findByText("Natureza não definida")).toBeTruthy();
    expect(salvar().disabled).toBe(false);
    await waitFor(() => expect(getProductById).toHaveBeenCalledWith("p1"));
  });

  test("edição de produto antigo não manda natureza vazia (preserva a gravada)", async () => {
    getProductById.mockResolvedValue({
      id: "p1", externalCode: "522", name: "CACHACA 700ML", isActive: true, controlsStock: true, unit: "KG", unitMeasureId: "u1",
      category: { id: "c1", name: "INSUMOS" }, dreCategoryId: "d1", inventorySector: { id: "s1", name: "ESTOQUE" }, nature: null
    });
    montar("/estoque/produtos/p1/editar");
    await screen.findByText("Natureza não definida");
    fireEvent.click(salvar());
    await screen.findByText("lista de produtos");
    expect("nature" in saveProduct.mock.calls[0][0]).toBe(false);
  });

  test("se o produto não abre, mostra o erro e não oferece formulário para criar outro", async () => {
    getProductById.mockRejectedValue(new Error("Produto nao encontrado."));
    montar("/estoque/produtos/ruim/editar");
    expect(await screen.findByText("Produto nao encontrado.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Como a equipe chama o item")).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvar/ })).toBeNull();
    expect(saveProduct).not.toHaveBeenCalled();
  });

  test("clicar de novo na natureza já escolhida não desfaz o ajuste de estoque", async () => {
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Insumo ou mercadoria/ }));
    fireEvent.click(continuar());
    fireEvent.click(await screen.findByRole("button", { name: /Classificação/ }));
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(screen.queryByLabelText("Setor da contagem")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /O que é/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Insumo ou mercadoria/ }));
    fireEvent.click(screen.getByRole("button", { name: /Classificação/ }));
    expect((await screen.findByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
