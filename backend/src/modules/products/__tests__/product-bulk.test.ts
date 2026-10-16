import { describe, expect, test } from "vitest";
import { aplicarMudancasAoEstado, descreverAlteracao, desfazerEhSeguro, panoramaDoAlvo, planejarLote, type ContextoDoLote, type ProdutoDoLote } from "../product-bulk.js";

const contexto: ContextoDoLote = {
  categorias: new Map([
    ["c-sec", { id: "c-sec", name: "SECOS E GRAOS", nature: "INSUMO" }],
    ["c-doc", { id: "c-doc", name: "DOCES E CONFEITARIA", nature: "INSUMO" }],
    ["c-ute", { id: "c-ute", name: "UTENSILIOS", nature: "DURAVEL" }]
  ]),
  subcategorias: new Map([
    ["s-arroz", { id: "s-arroz", name: "ARROZ", categoryId: "c-sec" }],
    ["s-bolo", { id: "s-bolo", name: "BOLOS", categoryId: "c-doc" }]
  ]),
  setores: new Map([
    ["set-est", { id: "set-est", name: "ESTOQUE", isActive: true }],
    ["set-velho", { id: "set-velho", name: "ANTIGO", isActive: false }]
  ])
};

const produto = (extra: Partial<ProdutoDoLote> = {}): ProdutoDoLote => ({
  id: "p1", name: "ARROZ BRANCO", externalCode: "1", categoryId: "c-sec", subcategoryId: null,
  inventorySectorId: "set-est", nature: "INSUMO", controlsStock: true, isActive: true, ...extra
});

describe("planejarLote: categoria e subcategoria", () => {
  test("trocar a categoria limpa a subcategoria antiga", () => {
    const plano = planejarLote([produto({ subcategoryId: "s-arroz" })], { categoryId: "c-doc" }, contexto);
    expect(plano.alterar).toHaveLength(1);
    expect(plano.alterar[0].depois).toMatchObject({ categoryId: "c-doc", subcategoryId: null });
  });

  test("trocar a categoria e informar a subcategoria nova grava as duas", () => {
    const plano = planejarLote([produto()], { categoryId: "c-doc", subcategoryId: "s-bolo" }, contexto);
    expect(plano.alterar[0].depois).toMatchObject({ categoryId: "c-doc", subcategoryId: "s-bolo" });
  });

  test("subcategoria que não é da categoria final é recusada, produto a produto", () => {
    const plano = planejarLote([produto(), produto({ id: "p2", categoryId: "c-doc" })], { subcategoryId: "s-bolo" }, contexto);
    expect(plano.alterar.map((p) => p.id)).toEqual(["p2"]);
    expect(plano.recusados).toHaveLength(1);
    expect(plano.recusados[0]).toMatchObject({ id: "p1", motivo: expect.stringMatching(/subcategoria/i) });
  });

  test("mesma categoria que o produto já tem não limpa a subcategoria", () => {
    const plano = planejarLote([produto({ subcategoryId: "s-arroz" })], { categoryId: "c-sec" }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.semMudanca).toBe(1);
  });

  test("limpar só a subcategoria", () => {
    const plano = planejarLote([produto({ subcategoryId: "s-arroz" })], { subcategoryId: null }, contexto);
    expect(plano.alterar[0].depois).toMatchObject({ subcategoryId: null });
  });

  test("categoria inexistente é recusada para todos", () => {
    const plano = planejarLote([produto()], { categoryId: "nao-existe" }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.recusados[0].motivo).toMatch(/categoria/i);
  });
});

describe("planejarLote: estoque, setor e situação", () => {
  test("ligar o estoque sem setor é recusado", () => {
    const plano = planejarLote([produto({ controlsStock: false, inventorySectorId: null })], { controlsStock: true }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.recusados[0].motivo).toMatch(/setor/i);
  });

  test("ligar o estoque junto com o setor passa", () => {
    const plano = planejarLote([produto({ controlsStock: false, inventorySectorId: null })], { controlsStock: true, inventorySectorId: "set-est" }, contexto);
    expect(plano.alterar[0].depois).toMatchObject({ controlsStock: true, inventorySectorId: "set-est" });
  });

  test("tirar o setor de quem conta estoque é recusado; de quem não conta passa", () => {
    const plano = planejarLote(
      [produto(), produto({ id: "p2", controlsStock: false })],
      { inventorySectorId: null },
      contexto
    );
    expect(plano.alterar.map((p) => p.id)).toEqual(["p2"]);
    expect(plano.recusados.map((p) => p.id)).toEqual(["p1"]);
  });

  test("setor inativo não recebe produto", () => {
    const plano = planejarLote([produto()], { inventorySectorId: "set-velho" }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.recusados[0].motivo).toMatch(/setor/i);
  });

  test("durável não entra na contagem enquanto o escopo do CMV não for isolado", () => {
    const plano = planejarLote([produto({ nature: "DURAVEL", controlsStock: false })], { controlsStock: true }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.recusados[0].motivo).toMatch(/durável/i);
  });

  test("mudar a natureza para durável com estoque ligado é recusado", () => {
    const plano = planejarLote([produto()], { nature: "DURAVEL" }, contexto);
    expect(plano.recusados[0].motivo).toMatch(/durável/i);
  });

  test("mudar a natureza para durável junto com desligar o estoque passa", () => {
    const plano = planejarLote([produto()], { nature: "DURAVEL", controlsStock: false }, contexto);
    expect(plano.alterar[0].depois).toMatchObject({ nature: "DURAVEL", controlsStock: false });
  });

  test("reativar produto que conta estoque e está sem setor é recusado", () => {
    const plano = planejarLote([produto({ isActive: false, inventorySectorId: null })], { isActive: true }, contexto);
    expect(plano.recusados[0].motivo).toMatch(/setor/i);
  });

  test("inativar produto sempre passa", () => {
    const plano = planejarLote([produto({ inventorySectorId: null })], { isActive: false }, contexto);
    expect(plano.alterar).toHaveLength(1);
  });
});

describe("planejarLote: resumo e avisos", () => {
  test("conta quantos produtos mudam em cada campo", () => {
    const plano = planejarLote(
      [produto({ id: "a", subcategoryId: "s-arroz" }), produto({ id: "b", categoryId: "c-doc" })],
      { categoryId: "c-doc" },
      contexto
    );
    expect(plano.contagens).toMatchObject({ categoria: 1, subcategoria: 1, setor: 0, natureza: 0, estoque: 0, situacao: 0 });
    expect(plano.semMudanca).toBe(1);
  });

  test("agrupa as recusas por motivo, com exemplos", () => {
    const plano = planejarLote(
      [produto({ id: "a", name: "A", inventorySectorId: null, controlsStock: false }), produto({ id: "b", name: "B", inventorySectorId: null, controlsStock: false })],
      { controlsStock: true },
      contexto
    );
    expect(plano.recusadosPorMotivo).toHaveLength(1);
    expect(plano.recusadosPorMotivo[0]).toMatchObject({ count: 2, exemplos: ["A", "B"] });
  });

  test("avisa quando a natureza escolhida difere da natureza da categoria final", () => {
    const plano = planejarLote([produto()], { categoryId: "c-ute", nature: "CONSUMO" }, contexto);
    expect(plano.avisos.join(" ")).toMatch(/natureza/i);
  });

  test("avisa que ligar estoque coloca produtos na contagem do mês", () => {
    const plano = planejarLote([produto({ controlsStock: false })], { controlsStock: true }, contexto);
    expect(plano.avisos.join(" ")).toMatch(/contagem/i);
  });

  test("sempre lembra que a categoria DRE não muda", () => {
    const plano = planejarLote([produto()], { nature: "CONSUMO" }, contexto);
    expect(plano.avisos.join(" ")).toMatch(/DRE/);
  });
});

describe("desfazer", () => {
  test("aplicarMudancasAoEstado reproduz o estado depois do lote", () => {
    const antes = produto({ subcategoryId: "s-arroz" });
    const plano = planejarLote([antes], { categoryId: "c-doc" }, contexto);
    expect(aplicarMudancasAoEstado(antes, plano.alterar[0].patch)).toEqual(plano.alterar[0].depois);
  });

  test("desfazer é seguro só se o produto ainda está como o lote deixou", () => {
    const antes = produto();
    const plano = planejarLote([antes], { nature: "CONSUMO" }, contexto);
    const depois = plano.alterar[0].depois;
    expect(desfazerEhSeguro(depois, depois)).toBe(true);
    expect(desfazerEhSeguro({ ...depois, nature: "INSUMO" }, depois)).toBe(false);
  });
});

describe("planejarLote: mudar só a natureza também confere a contagem", () => {
  test("serviço que conta estoque e está sem setor vira insumo: recusado, pede setor", () => {
    const plano = planejarLote([produto({ nature: "SERVICO", controlsStock: true, inventorySectorId: null })], { nature: "INSUMO" }, contexto);
    expect(plano.alterar).toHaveLength(0);
    expect(plano.recusados[0].motivo).toMatch(/setor/i);
  });
});

describe("descreverAlteracao", () => {
  test("escreve antes → depois com nomes, não ids", () => {
    const antes = produto({ subcategoryId: "s-arroz", controlsStock: false, inventorySectorId: null });
    const plano = planejarLote([antes], { categoryId: "c-doc", inventorySectorId: "set-est", controlsStock: true }, contexto);
    expect(descreverAlteracao(plano.alterar[0], contexto)).toEqual([
      "Categoria: SECOS E GRAOS → DOCES E CONFEITARIA",
      "Subcategoria: ARROZ → sem subcategoria",
      "Setor: sem setor → ESTOQUE",
      "Entra na contagem de estoque: não → sim"
    ]);
  });

  test("natureza e situação", () => {
    const plano = planejarLote([produto()], { nature: "CONSUMO", isActive: false }, contexto);
    expect(descreverAlteracao(plano.alterar[0], contexto)).toEqual([
      "Natureza: Insumo ou mercadoria → Material de consumo",
      "Situação: ativo → inativo"
    ]);
  });
});

describe("panoramaDoAlvo", () => {
  test("conta como os produtos estão hoje, do maior grupo para o menor", () => {
    const panorama = panoramaDoAlvo(
      [produto({ id: "a" }), produto({ id: "b" }), produto({ id: "c", categoryId: "c-doc", inventorySectorId: null, controlsStock: false })],
      contexto
    );
    expect(panorama.total).toBe(3);
    expect(panorama.categoria).toEqual([{ rotulo: "SECOS E GRAOS", count: 2 }, { rotulo: "DOCES E CONFEITARIA", count: 1 }]);
    expect(panorama.setor).toEqual([{ rotulo: "ESTOQUE", count: 2 }, { rotulo: "sem setor", count: 1 }]);
    expect(panorama.estoque).toEqual([{ rotulo: "entra na contagem", count: 2 }, { rotulo: "não entra na contagem", count: 1 }]);
    expect(panorama.subcategoria).toEqual([{ rotulo: "sem subcategoria", count: 3 }]);
  });

  test("agrupa o excedente em 'outros'", () => {
    const ids = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    const ctx: ContextoDoLote = { ...contexto, categorias: new Map(ids.map((id) => [id, { id, name: id.toUpperCase(), nature: "INSUMO" as const }])) };
    const panorama = panoramaDoAlvo(ids.map((categoryId, i) => produto({ id: String(i), categoryId })), ctx);
    expect(panorama.categoria).toHaveLength(5);
    expect(panorama.categoria[4]).toEqual({ rotulo: "outros", count: 3 });
  });
});
