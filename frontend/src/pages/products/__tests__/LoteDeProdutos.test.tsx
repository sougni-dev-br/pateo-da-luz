import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const organizarProdutosEmLote = vi.fn();

vi.mock("../../../api/client", () => ({
  organizarProdutosEmLote: (...args: unknown[]) => organizarProdutosEmLote(...args)
}));

import { LoteDeProdutos } from "../LoteDeProdutos";

const categories = [
  { id: "c-sec", name: "SECOS E GRAOS", mainGroup: null, isActive: true, notes: null },
  { id: "c-doc", name: "DOCES", mainGroup: null, isActive: true, notes: null },
  { id: "c-velha", name: "INSUMOS", mainGroup: null, isActive: false, notes: null }
];
const subcategories = [
  { id: "s-arroz", name: "ARROZ", categoryId: "c-sec", isActive: true, notes: null },
  { id: "s-bolo", name: "BOLOS", categoryId: "c-doc", isActive: true, notes: null }
];
const sectors = [{ id: "set-est", name: "ESTOQUE", normalizedName: "estoque", description: null, countOrder: 1, isActive: true, notes: null }];
const natures = [
  { value: "INSUMO", label: "Insumo ou mercadoria", description: "", dreGroups: [], controlsStock: true, fisico: true, entraNoCmv: true }
];

const resumo = (extra = {}) => ({
  aplicado: false, total: 104, alterar: 100, semMudanca: 2, recusados: 2,
  recusadosPorMotivo: [{ motivo: "Produto que conta estoque precisa de setor: escolha o setor junto.", count: 2, exemplos: ["SAL", "AÇÚCAR"] }],
  contagens: { categoria: 0, subcategoria: 100, setor: 0, natureza: 0, estoque: 0, situacao: 0 },
  avisos: ["A categoria DRE dos produtos não muda por aqui."],
  amostra: ["ARROZ BRANCO", "ARROZ INTEGRAL"], ...extra
});

function renderizar(onAplicado = vi.fn(), onFechar = vi.fn()) {
  render(
    <LoteDeProdutos
      alvo={{ filtro: { category: "SECOS E GRAOS", pendencia: "sem-subcategoria" } }}
      quantidade={104}
      categoriaDoFiltroId="c-sec"
      categories={categories as never}
      subcategories={subcategories as never}
      sectors={sectors as never}
      natures={natures as never}
      onAplicado={onAplicado}
      onFechar={onFechar}
    />
  );
  return { onAplicado, onFechar };
}

beforeEach(() => {
  organizarProdutosEmLote.mockReset();
  organizarProdutosEmLote.mockResolvedValue(resumo());
});
afterEach(cleanup);

describe("LoteDeProdutos", () => {
  test("não deixa revisar enquanto nada foi escolhido", () => {
    renderizar();
    expect(screen.getByRole("button", { name: "Revisar mudanças" })).toBeDisabled();
  });

  test("categoria inativa não aparece para escolher", () => {
    renderizar();
    const opcoes = Array.from(screen.getByLabelText("Categoria").querySelectorAll("option")).map((o) => o.textContent);
    expect(opcoes).toContain("SECOS E GRAOS");
    expect(opcoes).not.toContain("INSUMOS");
  });

  test("filtrando por uma categoria já dá para escolher a subcategoria dela, sem trocar a categoria", () => {
    renderizar();
    const subcategoria = screen.getByLabelText("Subcategoria") as HTMLSelectElement;
    expect(subcategoria).not.toBeDisabled();
    expect(Array.from(subcategoria.options).map((o) => o.textContent)).toContain("ARROZ");
    expect(Array.from(subcategoria.options).map((o) => o.textContent)).not.toContain("BOLOS");
  });

  test("revisar simula (sem aplicar) e mostra o resumo, as recusas e os avisos", async () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    expect(organizarProdutosEmLote).toHaveBeenCalledWith(
      { filtro: { category: "SECOS E GRAOS", pendencia: "sem-subcategoria" } },
      { subcategoryId: "s-arroz" },
      false,
      undefined
    );
    expect(screen.getByText("Subcategoria: ARROZ")).toBeInTheDocument();
    expect(screen.getByText(/não mudam: Produto que conta estoque precisa de setor/)).toBeInTheDocument();
    expect(screen.getByText(/A categoria DRE dos produtos não muda por aqui\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar em 100 produtos" })).toBeEnabled();
  });

  test("aplicar repete a mesma mudança com aplicar=true e avisa quem chamou", async () => {
    const { onAplicado } = renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    organizarProdutosEmLote.mockResolvedValue(resumo({ aplicado: true, loteId: "lote-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar em 100 produtos" }));
    await waitFor(() => expect(onAplicado).toHaveBeenCalledWith(expect.objectContaining({ loteId: "lote-1" })));
    expect(organizarProdutosEmLote).toHaveBeenLastCalledWith(expect.anything(), { subcategoryId: "s-arroz" }, true, 100);
  });

  test("mudar qualquer campo depois de revisar volta ao passo de escolha", async () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    expect(screen.queryByRole("region", { name: "Resumo do que vai mudar" })).not.toBeInTheDocument();
  });

  test("trocar a categoria zera a subcategoria escolhida", () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c-doc" } });
    expect((screen.getByLabelText("Subcategoria") as HTMLSelectElement).value).toBe("");
  });

  test("erro do servidor aparece e não aplica nada", async () => {
    organizarProdutosEmLote.mockRejectedValue(new Error("O filtro pega 2500 produtos."));
    renderizar();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2500 produtos");
  });

  test("sem nada a alterar não deixa aplicar", async () => {
    organizarProdutosEmLote.mockResolvedValue(resumo({ alterar: 0, semMudanca: 104, recusados: 0, recusadosPorMotivo: [] }));
    renderizar();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "ativar" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    const aplicar = await screen.findByRole("button", { name: "Aplicar em 0 produtos" });
    expect(aplicar).toBeDisabled();
  });
});

describe("LoteDeProdutos: seleção que muda", () => {
  test("se o alvo muda com o resumo na tela, o resumo some e não dá para aplicar o que foi conferido antes", async () => {
    const props = {
      quantidade: 8,
      categories: categories as never,
      subcategories: subcategories as never,
      sectors: sectors as never,
      natures: natures as never,
      onAplicado: vi.fn(),
      onFechar: vi.fn()
    };
    const { rerender } = render(<LoteDeProdutos {...props} alvo={{ ids: ["a", "b"] }} />);
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    rerender(<LoteDeProdutos {...props} alvo={{ ids: ["a"] }} />);
    expect(screen.queryByRole("region", { name: "Resumo do que vai mudar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar em/ })).not.toBeInTheDocument();
  });

  test("o foco vai para o resumo quando ele aparece", async () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar mudanças" }));
    const regiao = await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    await waitFor(() => expect(regiao.contains(document.activeElement)).toBe(true));
  });
});
