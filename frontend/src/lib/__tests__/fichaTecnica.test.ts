import { describe, expect, it } from "vitest";
import type { DishListItem } from "../../api/client";
import {
  chaveDoIngrediente,
  contarPorSituacao,
  custoPorKg,
  rotuloDeDias,
  converterAoTrocarUnidade,
  ondeVende,
  trocarOndeVende,
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
  medidaInformavel,
  montarPayloadDaFicha,
  opcoesDeUnidade,
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
    id: "d", code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN",
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
    expect(fatorConversao("BARRIL", "L", [])).toBe(50);
    expect(fatorConversao("L", "BARRIL", [])).toBeCloseTo(0.02, 10);
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

describe("opções de unidade", () => {
  it("sempre oferece g, kg, ml e l; marca as que ainda não convertem", () => {
    const opcoes = opcoesDeUnidade("UN", [], "UN");
    expect(opcoes.map((o) => o.value)).toEqual(["UN", "G", "KG", "ML", "L"]);
    expect(opcoes.map((o) => o.converte)).toEqual([true, false, false, false, false]);
    expect(opcoes[1].label).toBe("G (informar)");
  });

  it("com conversão (cadastrada ou lida do nome) a unidade deixa de ser 'informar'", () => {
    const conv = [{ fromUnit: "G", toUnit: "UN", factor: 0.001 }, { fromUnit: "KG", toUnit: "UN", factor: 1 }];
    expect(opcoesDeUnidade("UN", conv, "G").filter((o) => o.converte).map((o) => o.value)).toEqual(["UN", "G", "KG"]);
  });

  it("produto em KG: g converte sozinho, ml pede informar", () => {
    const opcoes = opcoesDeUnidade("KG", [], "KG");
    expect(opcoes.find((o) => o.value === "G")?.converte).toBe(true);
    expect(opcoes.find((o) => o.value === "ML")?.converte).toBe(false);
  });

  it("unidade estranha já gravada na linha continua visível", () => {
    expect(opcoesDeUnidade("UN", [], "MÇ").map((o) => o.value)).toContain("MÇ");
  });

  it("unidade que não é medida (CX) não ganha o rótulo '(informar)', porque não há campo para ela", () => {
    expect(opcoesDeUnidade("UN", [], "CX").find((o) => o.value === "CX")?.label).toBe("CX");
  });

  it("só g, kg, ml e l aceitam informar conversão", () => {
    expect(medidaInformavel("gr")).toBe("G");
    expect(medidaInformavel("UN")).toBeNull();
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
    prato({ id: "2", name: "Risoto de camarão", cmvPercentual: 45, margemBruta: 20, category: { id: "c1", name: "A la carte", parentId: null, parentName: null, menu: "CARDAPIO" } }),
    prato({ id: "3", name: "Frango grelhado", cmvPercentual: 25, margemBruta: 30, category: { id: "c1", name: "A la carte", parentId: null, parentName: null, menu: "CARDAPIO" } }),
    prato({ id: "4", name: "Prato antigo", isActive: false }),
    prato({ id: "5", name: "Tiramisu", salePriceDefault: null, cmvPercentual: null, margemBruta: null })
  ];
  const todos = { busca: "", menu: "todos" as const, categoriaId: "", situacao: "todos" as const, mostrarInativos: false };

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
  const campos = { name: "Risoto", code: "", menu: "CARDAPIO" as const, categoryId: "", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "79,90", yieldQty: "1", yieldUnit: "un", portionWeightG: "", shelfLifeDays: "", notes: "" };
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
    expect(payload).toMatchObject({ id: "d1", name: "Risoto", menu: "CARDAPIO", salePriceDefault: 79.9, yieldQty: 1, yieldUnit: "UN", isActive: true });
    expect(payload.items).toEqual([
      { productId: "p1", componentDishId: null, quantity: 0.15, unit: "G", wasteFactor: 0.07, notes: "fresco", sortOrder: 0 }
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

describe("converter a quantidade ao trocar a unidade", () => {
  it("g → kg e kg → g pela conversão física", () => {
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "170" }), "KG")?.quantity).toBe("0.17");
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "0,5", unit: "KG" }), "G")?.quantity).toBe("500");
  });

  it("explica a conversão feita", () => {
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "170" }), "KG")?.aviso).toContain("170 G = 0,17 KG");
  });

  it("usa a conversão do produto (UN ⇄ G)", () => {
    const conversoes = [{ fromUnit: "UN", toUnit: "G", factor: 1200, inferida: false }] as IngredientePrevisto["conversions"];
    const base = { productUnit: "UN", conversions: conversoes };
    expect(converterAoTrocarUnidade(ingrediente({ ...base, quantity: "0,5", unit: "UN" }), "G")?.quantity).toBe("600");
    expect(converterAoTrocarUnidade(ingrediente({ ...base, quantity: "600", unit: "G" }), "UN")?.quantity).toBe("0.5");
  });

  it("sem conversão conhecida, vazio, zero, lixo ou mesma unidade: não mexe", () => {
    expect(converterAoTrocarUnidade(ingrediente({ productUnit: "UN", unit: "UN" }), "G")).toBeNull();
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "" }), "KG")).toBeNull();
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "0" }), "KG")).toBeNull();
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "abc" }), "KG")).toBeNull();
    expect(converterAoTrocarUnidade(ingrediente(), "gr")).toBeNull();
  });

  it("não deixa a quantidade virar zero por arredondamento", () => {
    expect(converterAoTrocarUnidade(ingrediente({ quantity: "0,01" }), "KG")).toBeNull();
  });
});

describe("prato vendido nos dois cardápios (formulário)", () => {
  const base = { name: "Filé", code: "", menu: "CARDAPIO" as const, categoryId: "c-salao", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "", yieldQty: "1", yieldUnit: "UN", portionWeightG: "", shelfLifeDays: "", notes: "" };

  it("passar para 'nos dois' guarda o outro cardápio, sem categoria ainda", () => {
    expect(ondeVende(base)).toBe("CARDAPIO");
    const dois = trocarOndeVende(base, "AMBOS");
    expect(dois).toMatchObject({ menu: "CARDAPIO", categoryId: "c-salao", alsoMenu: "DELIVERY", alsoCategoryId: "" });
    expect(ondeVende(dois)).toBe("AMBOS");
    // Prato só do delivery que passa a sair no salão: o salão vira o principal e o delivery, com a categoria que tinha, o segundo.
    expect(trocarOndeVende({ ...base, menu: "DELIVERY", categoryId: "c-delivery" }, "AMBOS")).toMatchObject({
      menu: "CARDAPIO", categoryId: "", alsoMenu: "DELIVERY", alsoCategoryId: "c-delivery"
    });
  });

  it("sair de 'nos dois' mantém o cardápio escolhido com a categoria dele", () => {
    const dois = { ...base, alsoMenu: "DELIVERY" as const, alsoCategoryId: "c-delivery" };
    expect(trocarOndeVende(dois, "CARDAPIO")).toMatchObject({ menu: "CARDAPIO", categoryId: "c-salao", alsoMenu: null, alsoCategoryId: "" });
    expect(trocarOndeVende(dois, "DELIVERY")).toMatchObject({ menu: "DELIVERY", categoryId: "c-delivery", alsoMenu: null, alsoCategoryId: "" });
  });

  it("trocar de cardápio solto limpa a categoria do outro lado; escolher o mesmo não muda nada", () => {
    expect(trocarOndeVende(base, "DELIVERY")).toMatchObject({ menu: "DELIVERY", categoryId: "", alsoMenu: null });
    expect(trocarOndeVende(base, "CARDAPIO")).toBe(base);
  });

  it("vendido nos dois, as quantidades do delivery são obrigatórias (as do a la carte não valem)", () => {
    const dois = { ...base, alsoMenu: "DELIVERY" as const };
    const item = (tempId: string, quantity: string) => ({ ...ingrediente({ quantity }), tempId, productId: tempId, productName: tempId, notes: "" });
    expect(validarFicha(dois, [item("a", "200")], []).semQuantidadesDoOutro).toMatch(/quantidades do delivery/);
    expect(temErros(validarFicha(dois, [item("a", "200")], []))).toBe(true);
    expect(temErros(validarFicha(dois, [item("a", "200")], [item("b", "150")]))).toBe(false);
    // As linhas do delivery também são validadas.
    expect(validarFicha(dois, [item("a", "200")], [item("b", "")]).itens.b).toMatchObject({ campo: "quantity" });
    // Prato de um cardápio só não exige nada do outro.
    expect(temErros(validarFicha(base, [item("a", "200")], []))).toBe(false);
  });

  it("o payload leva as quantidades do delivery só quando o prato é vendido nos dois", () => {
    const item = (productId: string, quantity: string) => ({ ...ingrediente({ quantity }), tempId: productId, productId, productName: productId, notes: "" });
    const dois = montarPayloadDaFicha({ ...base, alsoMenu: "DELIVERY" }, [item("a", "200")], {}, [item("b", "120")]);
    expect(dois).toMatchObject({ items: [{ productId: "a", quantity: 200 }], alsoItems: [{ productId: "b", quantity: 120 }] });
    expect(montarPayloadDaFicha(base, [item("a", "200")], {}, [item("b", "120")])).not.toHaveProperty("alsoItems");
  });

  it("o payload leva o segundo cardápio e a categoria dele; sem segundo cardápio não leva categoria", () => {
    const dois = montarPayloadDaFicha({ ...base, alsoMenu: "DELIVERY", alsoCategoryId: "c-delivery" }, []);
    expect(dois).toMatchObject({ menu: "CARDAPIO", alsoMenu: "DELIVERY", alsoCategoryId: "c-delivery" });
    expect(montarPayloadDaFicha({ ...base, alsoCategoryId: "sobrou" }, [])).toMatchObject({ alsoMenu: null, alsoCategoryId: "" });
  });
});

describe("peso da porção e validade de uso", () => {
  const campos = { name: "Nhoque - Massa", code: "", menu: "DELIVERY" as const, categoryId: "", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "", yieldQty: "12", yieldUnit: "UN", portionWeightG: "160", shelfLifeDays: "4", notes: "" };
  const item: ItemDaFicha = { ...ingrediente(), tempId: "t1", productId: "p1", productName: "FARINHA", notes: "" };

  it("campos preenchidos e válidos não geram erro", () => {
    expect(temErros(validarFicha(campos, [item]))).toBe(false);
  });

  it("campos vazios são opcionais", () => {
    expect(temErros(validarFicha({ ...campos, portionWeightG: "", shelfLifeDays: "" }, [item]))).toBe(false);
  });

  it("peso zero, negativo ou texto é erro", () => {
    for (const ruim of ["0", "-5", "abc"]) {
      expect(validarFicha({ ...campos, portionWeightG: ruim }, [item]).portionWeightG).toMatch(/peso da porção/);
    }
  });

  it("validade precisa ser inteira e maior que zero", () => {
    for (const ruim of ["0", "-1", "2,5", "x"]) {
      expect(validarFicha({ ...campos, shelfLifeDays: ruim }, [item]).shelfLifeDays).toMatch(/validade/);
    }
    expect(temErros(validarFicha({ ...campos, shelfLifeDays: "10" }, [item]))).toBe(false);
  });

  it("o payload leva os números, e vazio vira null (limpa o que estava gravado)", () => {
    expect(montarPayloadDaFicha(campos, [item])).toMatchObject({ portionWeightG: 160, shelfLifeDays: 4 });
    expect(montarPayloadDaFicha({ ...campos, portionWeightG: "", shelfLifeDays: "" }, [item])).toMatchObject({ portionWeightG: null, shelfLifeDays: null });
  });

  it("custo por kg: custo da porção ÷ peso da porção × 1000", () => {
    expect(custoPorKg(2.4, 160)).toBeCloseTo(15);
    expect(custoPorKg(2.4, null)).toBeNull();
    expect(custoPorKg(2.4, 0)).toBeNull();
    expect(custoPorKg(null, 160)).toBeNull();
  });

  it("rótulo de dias no singular e no plural", () => {
    expect(rotuloDeDias(1)).toBe("1 dia");
    expect(rotuloDeDias(4)).toBe("4 dias");
  });
});

describe("ficha de produção como ingrediente", () => {
  const massa = { quantity: "1", unit: "UN", wasteFactor: "0", unitCost: 0.75, productUnit: "UN", conversions: [], ehFicha: true as const };

  it("o custo é a quantidade × o custo de uma unidade de rendimento da ficha", () => {
    expect(custoPrevisto({ ...massa, quantity: "2" })).toBeCloseTo(1.5, 6);
  });

  it("ficha sem custo explica o motivo da ficha, não o do estoque", () => {
    expect(motivoSemCusto({ ...massa, unitCost: 0, motivoDaFicha: "Ficha de produção sem ingredientes." })).toBe("Ficha de produção sem ingredientes.");
    expect(motivoSemCusto({ ...massa, unitCost: 0 })).toMatch(/complete os ingredientes dela/);
  });

  it("unidade que não é a de rendimento da ficha: pede a unidade dela", () => {
    expect(motivoSemCusto({ ...massa, unit: "G" })).toMatch(/rende em UN/);
    expect(motivoSemCusto(massa)).toBeNull();
  });

  it("só a unidade de rendimento (e g ↔ kg por física): nada de \"(informar)\"", () => {
    expect(opcoesDeUnidade("UN", [], "UN", true).map((o) => o.label)).toEqual(["UN"]);
    expect(opcoesDeUnidade("KG", [], "KG", true).map((o) => o.value).sort()).toEqual(["G", "KG"]);
    // O produto comum continua oferecendo as medidas para informar.
    expect(opcoesDeUnidade("UN", [], "UN").some((o) => o.label.includes("(informar)"))).toBe(true);
  });

  it("chave: ficha de produção e produto com o mesmo id não se confundem", () => {
    expect(chaveDoIngrediente({ productId: "x" })).toBe("x");
    expect(chaveDoIngrediente({ productId: "", componentDishId: "x" })).toBe("ficha:x");
  });

  it("o payload manda a ficha como componentDishId e sem productId", () => {
    const campos = { name: "P", code: "", menu: "DELIVERY", categoryId: "", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "", yieldQty: "1", yieldUnit: "UN", portionWeightG: "", shelfLifeDays: "", notes: "" } as never;
    const itens = [
      { tempId: "1", productId: "", componentDishId: "massa", productName: "Massa", notes: "", ...massa },
      { tempId: "2", productId: "p2", productName: "Queijo", notes: "", quantity: "30", unit: "G", wasteFactor: "0", unitCost: 40, productUnit: "KG", conversions: [] },
    ] as never;
    const items = (montarPayloadDaFicha(campos, itens) as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({ productId: null, componentDishId: "massa", quantity: 1, unit: "UN" });
    expect(items[1]).toMatchObject({ productId: "p2", componentDishId: null });
  });
});

describe("payload de ficha de produção", () => {
  const campos = { name: "Massa", code: "", menu: "DELIVERY", categoryId: "c1", alsoMenu: "CARDAPIO", alsoCategoryId: "c2", salePriceDefault: "40", yieldQty: "12", yieldUnit: "un", portionWeightG: "", shelfLifeDays: "", notes: "" } as never;

  it("ficha de produção vai sem preço, categoria nem segundo cardápio, mesmo que os campos tenham sobrado valores", () => {
    const payload = montarPayloadDaFicha(campos, [], { fichaDeProducao: true }, []) as Record<string, unknown>;
    expect(payload).toMatchObject({ fichaDeProducao: true, salePriceDefault: null, categoryId: "", alsoMenu: null, alsoCategoryId: "", yieldUnit: "UN" });
    expect(payload).not.toHaveProperty("alsoItems");
  });

  it("prato vendido não manda o tipo (o servidor mantém o que está gravado)", () => {
    const payload = montarPayloadDaFicha(campos, [], {}, []) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("fichaDeProducao");
    expect(payload).toMatchObject({ salePriceDefault: 40, categoryId: "c1", alsoMenu: "CARDAPIO" });
  });
});
