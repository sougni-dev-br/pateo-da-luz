import { describe, expect, it } from "vitest";
import type { DishListItem } from "../../api/client";
import {
  contarPorSituacao,
  custoPrevisto,
  faixaDeCmv,
  fatorConversao,
  filtrarPratos,
  fracaoParaPercentual,
  lerNumero,
  motivoSemCusto,
  normalizarBusca,
  normalizarUnidade,
  ordenarPratos,
  percentualParaFracao,
  montarPayloadDaFicha,
  resumoDaFicha,
  situacaoDaFicha,
  temErros,
  unidadePadrao,
  unidadesPossiveis,
  validarFicha,
  type IngredientePrevisto,
  type ItemDaFicha
} from "../fichaTecnica";

const ingrediente = (parcial: Partial<IngredientePrevisto> = {}): IngredientePrevisto => ({
  quantity: "150",
  unit: "G",
  wasteFactor: "0",
  unitCost: 40,
  productUnit: "KG",
  conversions: [],
  ...parcial
});

function prato(parcial: Partial<DishListItem> = {}): DishListItem {
  return {
    id: "d", code: null, name: "Prato", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN",
    isActive: true, itemsCount: 2, listingsCount: 0, listingPriceMin: null, listingPriceMax: null,
    calculatedCost: 10, custoPorcao: 10, margemBruta: 40, cmvPercentual: 20, custoIncompleto: false,
    ...parcial
  };
}

describe("unidades", () => {
  it("reconhece as grafias que o backend reconhece", () => {
    expect(normalizarUnidade("gr")).toBe("G");
    expect(normalizarUnidade(" Und. ")).toBe("UN");
    expect(normalizarUnidade("lt")).toBe("L");
    expect(normalizarUnidade(null)).toBe("");
  });

  it("converte massa e volume sem cadastro", () => {
    expect(fatorConversao("G", "KG", [])).toBe(0.001);
    expect(fatorConversao("L", "ML", [])).toBe(1000);
  });

  it("GR converte como G — antes a previa mostrava traço", () => {
    expect(fatorConversao("GR", "KG", [])).toBe(0.001);
  });

  it("usa a conversão do produto, direta e inversa, antes da universal", () => {
    const conv = [{ fromUnit: "UN", toUnit: "KG", factor: 0.7 }];
    expect(fatorConversao("UN", "KG", conv)).toBe(0.7);
    expect(fatorConversao("KG", "UN", conv)).toBeCloseTo(1 / 0.7);
  });

  it("sem conversão devolve null em vez de chutar", () => {
    expect(fatorConversao("G", "UN", [])).toBeNull();
    expect(fatorConversao("", "KG", [])).toBeNull();
  });

  it("oferece a unidade do estoque primeiro e só as que convertem", () => {
    expect(unidadesPossiveis("KG", [])).toEqual(["KG", "G"]);
    expect(unidadesPossiveis("UN", [])).toEqual(["UN"]);
    expect(unidadesPossiveis("UN", [{ fromUnit: "G", toUnit: "UN", factor: 0.001 }])).toEqual(["UN", "G"]);
    expect(unidadesPossiveis(null, [])).toEqual([]);
  });
});

describe("unidade padrão ao adicionar o ingrediente", () => {
  const lidoDoNome = [
    { fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true },
    { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true },
  ];

  it("kg abre em g, litro abre em ml", () => {
    expect(unidadePadrao("KG", [])).toBe("G");
    expect(unidadePadrao("L", [])).toBe("ML");
  });

  it("UN com peso lido do nome abre em g", () => {
    expect(unidadePadrao("UN", lidoDoNome)).toBe("G");
  });

  it("UN sem conversão continua em UN", () => {
    expect(unidadePadrao("UN", [])).toBe("UN");
    expect(unidadePadrao(null, [])).toBe("UN");
  });

  it("a previsão de custo usa a conversão inferida: 500 g de farinha de 5 kg a R$ 25", () => {
    expect(custoPrevisto(ingrediente({ quantity: "500", unit: "G", productUnit: "UN", unitCost: 25, conversions: lidoDoNome }))).toBeCloseTo(2.5);
  });
});

describe("custo previsto", () => {
  it("150 g de um produto cotado em KG", () => {
    expect(custoPrevisto(ingrediente())).toBeCloseTo(6); // 0,15 kg × R$ 40
  });

  it("soma a perda por cima da quantidade", () => {
    expect(custoPrevisto(ingrediente({ wasteFactor: "10" }))).toBeCloseTo(6.6);
  });

  it("aceita vírgula decimal", () => {
    expect(custoPrevisto(ingrediente({ quantity: "0,5", unit: "KG" }))).toBeCloseTo(20);
  });

  it("campo vazio conta como zero em vez de NaN", () => {
    expect(custoPrevisto(ingrediente({ quantity: "" }))).toBe(0);
  });

  it("sem custo médio ou sem conversão não inventa número", () => {
    expect(custoPrevisto(ingrediente({ unitCost: 0 }))).toBeNull();
    expect(custoPrevisto(ingrediente({ productUnit: "UN" }))).toBeNull();
  });

  it("diz o motivo de cada caso", () => {
    expect(motivoSemCusto(ingrediente({ unitCost: 0 }))).toMatch(/custo médio/);
    expect(motivoSemCusto(ingrediente({ productUnit: "UN" }))).toMatch(/Sem conversão de G para UN/);
    expect(motivoSemCusto(ingrediente())).toBeNull();
  });

  it("lê números com vírgula, ponto e vazio", () => {
    expect(lerNumero("1,25")).toBe(1.25);
    expect(lerNumero("1.25")).toBe(1.25);
    expect(lerNumero("")).toBeNaN();
    expect(lerNumero(null)).toBeNaN();
  });
});

describe("perda em percentual", () => {
  it("não vaza erro de ponto flutuante na tela", () => {
    expect(0.07 * 100).not.toBe(7); // o problema que a função resolve
    expect(fracaoParaPercentual(0.07)).toBe("7");
    expect(fracaoParaPercentual(0.29)).toBe("29");
    expect(fracaoParaPercentual(0.0525)).toBe("5.25");
    expect(fracaoParaPercentual(0)).toBe("0");
  });

  it("volta para fração com 4 casas, como o banco guarda", () => {
    expect(percentualParaFracao("7")).toBe(0.07);
    expect(percentualParaFracao("5,25")).toBe(0.0525);
    expect(percentualParaFracao("")).toBe(0);
  });
});

describe("situação da ficha", () => {
  it("sem ingrediente é sem ficha, mesmo com CMV 0% do backend", () => {
    expect(situacaoDaFicha(prato({ itemsCount: 0, cmvPercentual: 0 }))).toBe("sem-ficha");
  });

  it("custo parcial vem antes de preço e CMV", () => {
    expect(situacaoDaFicha(prato({ custoIncompleto: true, salePriceDefault: null }))).toBe("incompleta");
  });

  it("ficha ok sem preço padrão", () => {
    expect(situacaoDaFicha(prato({ salePriceDefault: null, cmvPercentual: null }))).toBe("sem-preco");
  });

  it("CMV acima de 40% é alto; 40% exato ainda é atenção", () => {
    expect(situacaoDaFicha(prato({ cmvPercentual: 40.1 }))).toBe("cmv-alto");
    expect(situacaoDaFicha(prato({ cmvPercentual: 40 }))).toBe("ok");
  });

  it("faixas do CMV", () => {
    expect(faixaDeCmv(null)).toBeNull();
    expect(faixaDeCmv(32)?.tom).toBe("success");
    expect(faixaDeCmv(32.1)?.tom).toBe("warning");
    expect(faixaDeCmv(40)?.tom).toBe("warning");
    expect(faixaDeCmv(40.1)?.tom).toBe("danger");
  });
});

describe("lista", () => {
  const lista = [
    prato({ id: "1", name: "Purê de batata", code: "P-1", itemsCount: 0, cmvPercentual: 0, margemBruta: 50 }),
    prato({ id: "2", name: "Risoto de camarão", cmvPercentual: 45, margemBruta: 20, category: { id: "c1", name: "A la carte" } }),
    prato({ id: "3", name: "Frango grelhado", cmvPercentual: 25, margemBruta: 30, category: { id: "c1", name: "A la carte" } }),
    prato({ id: "4", name: "Prato antigo", isActive: false }),
    prato({ id: "5", name: "Tiramisu", salePriceDefault: null, cmvPercentual: null, margemBruta: null })
  ];
  const todos = { busca: "", categoriaId: "", situacao: "todos" as const, mostrarInativos: false };

  it("busca sem acento nem caixa e também pelo código", () => {
    expect(normalizarBusca("  PURÊ   de  ")).toBe("pure de");
    expect(filtrarPratos(lista, { ...todos, busca: "pure" }).map((p) => p.id)).toEqual(["1"]);
    expect(filtrarPratos(lista, { ...todos, busca: "p-1" }).map((p) => p.id)).toEqual(["1"]);
  });

  it("todas as palavras precisam aparecer, em qualquer ordem", () => {
    expect(filtrarPratos(lista, { ...todos, busca: "risoto camarao" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrarPratos(lista, { ...todos, busca: "camarao risoto" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrarPratos(lista, { ...todos, busca: "risoto pizza" })).toEqual([]);
  });

  it("esconde inativos por padrão e mostra quando pedido", () => {
    expect(filtrarPratos(lista, todos).map((p) => p.id)).not.toContain("4");
    expect(filtrarPratos(lista, { ...todos, mostrarInativos: true }).map((p) => p.id)).toContain("4");
  });

  it("filtra por categoria e por situação", () => {
    expect(filtrarPratos(lista, { ...todos, categoriaId: "c1" }).map((p) => p.id)).toEqual(["2", "3"]);
    expect(filtrarPratos(lista, { ...todos, situacao: "cmv-alto" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrarPratos(lista, { ...todos, situacao: "sem-preco" }).map((p) => p.id)).toEqual(["5"]);
  });

  it("ordena por nome com acento em português", () => {
    expect(ordenarPratos(lista, "nome").map((p) => p.name)).toEqual(
      ["Frango grelhado", "Prato antigo", "Purê de batata", "Risoto de camarão", "Tiramisu"]
    );
  });

  it("maior CMV primeiro e quem não tem CMV por último", () => {
    expect(ordenarPratos(lista, "cmv").map((p) => p.id)).toEqual(["2", "3", "4", "1", "5"]);
  });

  it("menor margem primeiro e quem não tem margem por último", () => {
    expect(ordenarPratos(lista, "margem").map((p) => p.id)).toEqual(["2", "3", "4", "1", "5"]);
  });

  it("pendências: sem ficha, depois sem preço, depois CMV alto", () => {
    expect(ordenarPratos(lista, "pendencias").map((p) => p.id)).toEqual(["1", "5", "2", "3", "4"]);
  });

  it("não altera a lista de entrada", () => {
    const copia = [...lista];
    ordenarPratos(lista, "cmv");
    expect(lista).toEqual(copia);
  });

  it("com inativos incluídos, o número bate com a lista que mostra inativos", () => {
    expect(contarPorSituacao(lista, true)).toMatchObject({ total: 5, ok: 2 });
  });

  it("conta só os ativos", () => {
    expect(contarPorSituacao(lista)).toEqual({
      "sem-ficha": 1, incompleta: 0, "sem-preco": 1, "cmv-alto": 1, ok: 1, total: 4, comFicha: 3
    });
  });
});

describe("formulário da ficha", () => {
  const campos = { name: "Risoto", code: "", categoryId: "", salePriceDefault: "79,90", yieldQty: "1", yieldUnit: "un", notes: "" };
  const item = (parcial: Partial<ItemDaFicha> = {}): ItemDaFicha => ({
    ...ingrediente(), tempId: "t1", productId: "p1", productName: "CAMARAO", notes: "", ...parcial
  });

  it("ficha válida não tem erros", () => {
    expect(temErros(validarFicha(campos, [item()]))).toBe(false);
  });

  it("nome, rendimento e preço inválidos aparecem juntos", () => {
    const erros = validarFicha({ ...campos, name: "  ", yieldQty: "0", salePriceDefault: "-3" }, []);
    expect(erros.name).toBeDefined();
    expect(erros.yieldQty).toBeDefined();
    expect(erros.salePriceDefault).toBeDefined();
  });

  it("preço em branco é aceito (prato sem preço padrão)", () => {
    expect(validarFicha({ ...campos, salePriceDefault: "" }, []).salePriceDefault).toBeUndefined();
  });

  it("ingrediente sem quantidade ou com perda absurda é apontado pelo id", () => {
    const erros = validarFicha(campos, [item({ quantity: "" }), item({ tempId: "t2", wasteFactor: "150" })]);
    expect(erros.itens.t1).toMatchObject({ campo: "quantity", mensagem: expect.stringMatching(/quantidade/) });
    expect(erros.itens.t2).toMatchObject({ campo: "wasteFactor", mensagem: expect.stringMatching(/perda/) });
  });

  it("monta o payload com números, unidade normalizada e perda como fração", () => {
    const payload = montarPayloadDaFicha(campos, [item({ quantity: "0,15", unit: "gr", wasteFactor: "7", notes: " fresco " })], { id: "d1", isActive: true });
    expect(payload).toMatchObject({ id: "d1", name: "Risoto", salePriceDefault: 79.9, yieldQty: 1, yieldUnit: "UN", isActive: true });
    expect(payload.items).toEqual([
      { productId: "p1", quantity: 0.15, unit: "G", wasteFactor: 0.07, notes: "fresco", sortOrder: 0 }
    ]);
  });

  it("sem preço manda null, sem id não manda id", () => {
    const payload = montarPayloadDaFicha({ ...campos, salePriceDefault: "" }, []);
    expect(payload.salePriceDefault).toBeNull();
    expect(payload).not.toHaveProperty("id");
  });

  it("resumo divide o custo da receita pelo rendimento antes de comparar com o preço", () => {
    // 150 g × R$ 40/kg = R$ 6,00 por receita; rende 2 → R$ 3,00 por porção
    const resumo = resumoDaFicha({ salePriceDefault: "10", yieldQty: "2" }, [item()]);
    expect(resumo.custoDaReceita).toBeCloseTo(6);
    expect(resumo.custoPorPorcao).toBeCloseTo(3);
    expect(resumo.margemBruta).toBeCloseTo(7);
    expect(resumo.cmvPercentual).toBeCloseTo(30);
    expect(resumo.incompleto).toBe(false);
  });

  it("resumo marca incompleto e não inventa margem sem preço", () => {
    const resumo = resumoDaFicha({ salePriceDefault: "", yieldQty: "1" }, [item({ productUnit: "UN" })]);
    expect(resumo.incompleto).toBe(true);
    expect(resumo.margemBruta).toBeNull();
    expect(resumo.cmvPercentual).toBeNull();
  });
});
