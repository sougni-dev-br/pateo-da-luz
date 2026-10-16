import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const organizarProdutosEmLote = vi.fn();
const obterPanoramaDoLote = vi.fn();

vi.mock("../../../api/client", () => ({
  organizarProdutosEmLote: (...args: unknown[]) => organizarProdutosEmLote(...args),
  obterPanoramaDoLote: (...args: unknown[]) => obterPanoramaDoLote(...args)
}));

import { LoteDeProdutos, textoDeHoje } from "../LoteDeProdutos";

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
  { value: "INSUMO", label: "Insumo ou mercadoria", description: "Alimento, bebida ou ingrediente.", dreGroups: [], controlsStock: true, fisico: true, entraNoCmv: true }
];

const resumo = (extra = {}) => ({
  aplicado: false, total: 104, alterar: 100, semMudanca: 2, recusados: 2,
  recusadosPorMotivo: [{ motivo: "Produto que conta estoque precisa de setor: escolha o setor junto.", count: 2, exemplos: ["SAL", "AÇÚCAR"] }],
  contagens: { categoria: 0, subcategoria: 100, setor: 0, natureza: 0, estoque: 0, situacao: 0 },
  avisos: ["A categoria DRE dos produtos não muda por aqui."],
  amostra: [
    { nome: "ARROZ BRANCO", linhas: ["Subcategoria: sem subcategoria → ARROZ"] },
    { nome: "ARROZ INTEGRAL", linhas: ["Subcategoria: sem subcategoria → ARROZ"] }
  ],
  ...extra
});

const panorama = {
  total: 104,
  categoria: [{ rotulo: "SECOS E GRAOS", count: 104 }],
  subcategoria: [{ rotulo: "sem subcategoria", count: 104 }],
  setor: [{ rotulo: "ESTOQUE", count: 90 }, { rotulo: "BAR", count: 14 }],
  natureza: [{ rotulo: "Insumo ou mercadoria", count: 104 }],
  estoque: [{ rotulo: "entra na contagem", count: 104 }],
  situacao: [{ rotulo: "ativo", count: 104 }]
};

const alvoPadrao = { filtro: { category: "SECOS E GRAOS", pendencia: "sem-subcategoria" } };

type PropsDoLote = Parameters<typeof LoteDeProdutos>[0];

function props(extra: Record<string, unknown> = {}): PropsDoLote {
  return {
    alvo: alvoPadrao,
    quantidade: 104,
    categoriaDoFiltroId: "c-sec",
    categories: categories as never,
    subcategories: subcategories as never,
    sectors: sectors as never,
    natures: natures as never,
    onAplicado: vi.fn(),
    onFechar: vi.fn(),
    ...extra
  } as PropsDoLote;
}

function renderizar(extra: Record<string, unknown> = {}) {
  const p = props(extra);
  render(<LoteDeProdutos {...p} />);
  return p;
}

async function conferir(campo = "Situação", valor = "inativar") {
  fireEvent.change(screen.getByLabelText(campo), { target: { value: valor } });
  fireEvent.click(screen.getByRole("button", { name: "Conferir antes de aplicar" }));
  return screen.findByRole("region", { name: "Resumo do que vai mudar" });
}

beforeEach(() => {
  organizarProdutosEmLote.mockReset();
  organizarProdutosEmLote.mockResolvedValue(resumo());
  obterPanoramaDoLote.mockReset();
  obterPanoramaDoLote.mockResolvedValue(panorama);
});
afterEach(cleanup);

describe("textoDeHoje", () => {
  test("um valor só vira 'todos'; vários mostram a contagem de cada um", () => {
    expect(textoDeHoje([{ rotulo: "ESTOQUE", count: 5 }])).toBe("Hoje: ESTOQUE (todos)");
    expect(textoDeHoje([{ rotulo: "ESTOQUE", count: 90 }, { rotulo: "BAR", count: 14 }])).toBe("Hoje: ESTOQUE (90), BAR (14)");
    expect(textoDeHoje([])).toBeNull();
    expect(textoDeHoje(undefined)).toBeNull();
  });
});

describe("LoteDeProdutos: passo 1, escolher", () => {
  test("diz que nada muda agora e mostra em que etapa está", () => {
    renderizar();
    expect(screen.getByText(/Nada muda agora/)).toBeInTheDocument();
    expect(screen.getByText("1. Escolha o que mudar")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Fechar sem mudar nada" })).toBeInTheDocument();
  });

  test("mostra como os produtos estão HOJE em cada campo", async () => {
    renderizar();
    expect(await screen.findByText("Hoje: SECOS E GRAOS (todos)")).toBeInTheDocument();
    expect(screen.getByText("Hoje: ESTOQUE (90), BAR (14)")).toBeInTheDocument();
    expect(screen.getByText("Hoje: sem subcategoria (todos)")).toBeInTheDocument();
  });

  test("sem o 'hoje' (falha ao buscar) o painel continua funcionando", async () => {
    obterPanoramaDoLote.mockRejectedValue(new Error("falhou"));
    renderizar();
    await waitFor(() => expect(obterPanoramaDoLote).toHaveBeenCalled());
    expect(screen.getByLabelText("Categoria")).toBeInTheDocument();
    expect(screen.queryByText(/^Hoje:/)).not.toBeInTheDocument();
  });

  test("não deixa conferir enquanto nada foi escolhido e diz o motivo", () => {
    renderizar();
    expect(screen.getByRole("button", { name: "Conferir antes de aplicar" })).toBeDisabled();
    expect(screen.getByText("Escolha ao menos uma mudança para conferir.")).toBeInTheDocument();
  });

  test("cada campo explica o que é, e o 'não mudar' é o padrão", () => {
    renderizar();
    expect(screen.getByText("Em qual grupo de produtos o item entra.")).toBeInTheDocument();
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("");
    expect(Array.from((screen.getByLabelText("Categoria") as HTMLSelectElement).options)[0].textContent).toBe("Não mudar");
  });

  test("categoria inativa não aparece para escolher", () => {
    renderizar();
    const opcoes = Array.from(screen.getByLabelText("Categoria").querySelectorAll("option")).map((o) => o.textContent);
    expect(opcoes).toContain("SECOS E GRAOS");
    expect(opcoes).not.toContain("INSUMOS");
  });

  test("filtrando por uma categoria já dá para escolher a subcategoria dela", () => {
    renderizar();
    const subcategoria = screen.getByLabelText("Subcategoria") as HTMLSelectElement;
    expect(subcategoria).not.toBeDisabled();
    const textos = Array.from(subcategoria.options).map((o) => o.textContent);
    expect(textos).toContain("ARROZ");
    expect(textos).not.toContain("BOLOS");
  });

  test("sem categoria nem filtro, a subcategoria fica travada e o texto explica por quê", () => {
    renderizar({ categoriaDoFiltroId: undefined });
    expect(screen.getByLabelText("Subcategoria")).toBeDisabled();
    expect(screen.getByText(/Escolha uma categoria acima, ou filtre a lista/)).toBeInTheDocument();
  });

  test("trocar a categoria avisa que a subcategoria atual será apagada", () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c-doc" } });
    expect(screen.getByText(/a subcategoria atual é apagada/)).toBeInTheDocument();
    expect(screen.getByText("Subcategoria: apagar a atual (ela era de outra categoria)")).toBeInTheDocument();
  });

  test("natureza escolhida mostra a descrição dela", () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Natureza"), { target: { value: "INSUMO" } });
    expect(screen.getByText("Alimento, bebida ou ingrediente.")).toBeInTheDocument();
  });

  test("campo escolhido é marcado como 'vai mudar' e entra em 'Você escolheu'", () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    expect(screen.getByText("vai mudar")).toBeInTheDocument();
    expect(screen.getByLabelText("O que você escolheu")).toHaveTextContent("Situação: inativar");
  });

  test("trocar a categoria zera a subcategoria escolhida", () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c-doc" } });
    expect((screen.getByLabelText("Subcategoria") as HTMLSelectElement).value).toBe("");
  });
});

describe("LoteDeProdutos: passo 2, conferir", () => {
  test("conferir simula (sem aplicar) e mostra o que muda, antes → depois, o que não muda e o porquê", async () => {
    renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferir antes de aplicar" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    expect(organizarProdutosEmLote).toHaveBeenCalledWith(alvoPadrao, { subcategoryId: "s-arroz" }, false, undefined);
    expect(screen.getByRole("heading", { name: "100 produtos vão mudar" })).toBeInTheDocument();
    expect(screen.getByText(/2 já estão assim, não precisa mudar/)).toBeInTheDocument();
    expect(screen.getByText("ARROZ BRANCO")).toBeInTheDocument();
    expect(screen.getAllByText("Subcategoria: sem subcategoria → ARROZ")).toHaveLength(2);
    expect(screen.getByText(/Estes não vão mudar\. Continuam como estão, nada é gravado neles/)).toBeInTheDocument();
    expect(screen.getByText(/Produto que conta estoque precisa de setor/)).toBeInTheDocument();
    expect(screen.getByText(/A categoria DRE dos produtos não muda por aqui\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar em 100 produtos" })).toBeEnabled();
    expect(screen.getByText("2. Confira")).toHaveAttribute("aria-current", "step");
  });

  test("o foco vai para o título do resumo", async () => {
    renderizar();
    const regiao = await conferir();
    await waitFor(() => expect(regiao.contains(document.activeElement)).toBe(true));
  });

  test("'Voltar e ajustar' devolve ao passo 1 sem perder o que foi escolhido", async () => {
    renderizar();
    await conferir();
    fireEvent.click(screen.getByRole("button", { name: "Voltar e ajustar" }));
    expect((screen.getByLabelText("Situação") as HTMLSelectElement).value).toBe("inativar");
  });

  test("sem nada a alterar diz isso e não deixa aplicar", async () => {
    organizarProdutosEmLote.mockResolvedValue(resumo({ alterar: 0, semMudanca: 104, recusados: 0, recusadosPorMotivo: [], amostra: [] }));
    renderizar();
    await conferir("Situação", "ativar");
    expect(screen.getByRole("heading", { name: "Nenhum produto vai mudar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar em 0 produtos" })).toBeDisabled();
  });

  test("erro do servidor aparece e não aplica nada", async () => {
    organizarProdutosEmLote.mockRejectedValue(new Error("O filtro pega 2500 produtos."));
    renderizar();
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferir antes de aplicar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2500 produtos");
  });
});

describe("LoteDeProdutos: passo 3, aplicar", () => {
  test("aplicar repete a mesma mudança com a quantidade conferida e avisa quem chamou", async () => {
    const { onAplicado } = renderizar();
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "s-arroz" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferir antes de aplicar" }));
    await screen.findByRole("region", { name: "Resumo do que vai mudar" });
    organizarProdutosEmLote.mockResolvedValue(resumo({ aplicado: true, loteId: "lote-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar em 100 produtos" }));
    await waitFor(() => expect(onAplicado).toHaveBeenCalledWith(expect.objectContaining({ loteId: "lote-1" })));
    expect(organizarProdutosEmLote).toHaveBeenLastCalledWith(alvoPadrao, { subcategoryId: "s-arroz" }, true, 100);
  });

  test("mudar qualquer campo depois de conferir volta ao passo 1", async () => {
    renderizar();
    await conferir("Subcategoria", "s-arroz");
    fireEvent.click(screen.getByRole("button", { name: "Voltar e ajustar" }));
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "inativar" } });
    expect(screen.queryByRole("region", { name: "Resumo do que vai mudar" })).not.toBeInTheDocument();
  });

  test("se o alvo muda com o resumo na tela, o resumo some e não dá para aplicar o que foi conferido antes", async () => {
    const p = props({ alvo: { ids: ["a", "b"] }, quantidade: 2 });
    const { rerender } = render(<LoteDeProdutos {...p} />);
    await conferir();
    rerender(<LoteDeProdutos {...p} alvo={{ ids: ["a"] }} quantidade={1} />);
    expect(screen.queryByRole("region", { name: "Resumo do que vai mudar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar em/ })).not.toBeInTheDocument();
  });

  test("o 'hoje' é buscado de novo quando o alvo muda", async () => {
    const p = props({ alvo: { ids: ["a", "b"] }, quantidade: 2 });
    const { rerender } = render(<LoteDeProdutos {...p} />);
    await waitFor(() => expect(obterPanoramaDoLote).toHaveBeenCalledTimes(1));
    rerender(<LoteDeProdutos {...p} alvo={{ ids: ["a"] }} quantidade={1} />);
    await waitFor(() => expect(obterPanoramaDoLote).toHaveBeenCalledTimes(2));
    expect(obterPanoramaDoLote).toHaveBeenLastCalledWith({ ids: ["a"] });
  });
});
