import { describe, expect, test } from "vitest";
import type { DRECategory, NatureOption } from "../../../api/client";
import { avisosDaNatureza, dreDaCategoria, dreSugeridaParaCategoria, dreSugeridas, passosVisiveis, pendenciasDoCadastro } from "../natureza";
import { aplicarNatureza, emptyProductForm, formToPayload } from "../productForm";

const INSUMO: NatureOption = {
  value: "INSUMO", label: "Insumo ou mercadoria", description: "", dreGroups: ["CMV_COMPRAS"],
  controlsStock: true, fisico: true, entraNoCmv: true
};
const DURAVEL: NatureOption = {
  value: "DURAVEL", label: "Utensílio, equipamento ou uniforme", description: "", dreGroups: ["DESPESAS_GERAIS", "PLANEJAMENTO"],
  controlsStock: false, fisico: true, entraNoCmv: false
};
const SERVICO: NatureOption = {
  value: "SERVICO", label: "Serviço ou despesa", description: "", dreGroups: ["DESPESAS_GERAIS"],
  controlsStock: false, fisico: false, entraNoCmv: false
};

const DRE: DRECategory[] = [
  { id: "d1", name: "Custo de Alimentos", dreGroup: "CMV_COMPRAS", sortOrder: 1, isActive: true },
  { id: "d2", name: "Bebidas", dreGroup: "CMV_COMPRAS", sortOrder: 2, isActive: true },
  { id: "d3", name: "Utensílios Operacionais", dreGroup: "DESPESAS_GERAIS", sortOrder: 3, isActive: true },
  { id: "d4", name: "Investimentos", dreGroup: "PLANEJAMENTO", sortOrder: 4, isActive: true }
] as DRECategory[];

const completo = {
  name: "Farinha", unitMeasureId: "u1", categoryId: "c1", dreCategoryId: "d1", inventorySectorId: "s1", controlsStock: true
};

describe("passosVisiveis", () => {
  test("cadastro novo sem natureza só libera o primeiro passo", () => {
    expect(passosVisiveis(null, true)).toEqual(["natureza"]);
  });

  test("insumo passa por estoque e compra", () => {
    expect(passosVisiveis(INSUMO, true)).toEqual(["natureza", "identificacao", "classificacao", "estoque", "conferencia"]);
  });

  test("item físico sempre tem estoque e compra (conversão de embalagem vale mesmo sem contagem); serviço não", () => {
    expect(passosVisiveis(DURAVEL, true)).toContain("estoque");
    expect(passosVisiveis(SERVICO, true)).not.toContain("estoque");
  });

  test("produto antigo sem natureza mostra todos os passos", () => {
    expect(passosVisiveis(null, false)).toContain("estoque");
  });
});

describe("pendenciasDoCadastro", () => {
  test("insumo completo não tem pendência", () => {
    expect(pendenciasDoCadastro(completo, INSUMO, true)).toEqual([]);
  });

  test("lista cada campo que falta, com o passo onde preencher", () => {
    const vazio = { ...completo, name: "", unitMeasureId: "", categoryId: "", dreCategoryId: "", inventorySectorId: "" };
    const campos = pendenciasDoCadastro(vazio, INSUMO, true).map((p) => `${p.step}:${p.campo}`);
    expect(campos).toEqual([
      "identificacao:nome do item",
      "identificacao:unidade",
      "identificacao:categoria",
      "classificacao:categoria DRE",
      "classificacao:setor"
    ]);
  });

  test("não exige setor quando o item não controla estoque", () => {
    const campos = { ...completo, inventorySectorId: "", controlsStock: false };
    expect(pendenciasDoCadastro(campos, DURAVEL, true)).toEqual([]);
  });

  test("serviço pede só nome e DRE", () => {
    const campos = { name: "Dedetização", unitMeasureId: "", categoryId: "", dreCategoryId: "d3", inventorySectorId: "", controlsStock: false };
    expect(pendenciasDoCadastro(campos, SERVICO, true)).toEqual([]);
  });

  test("cadastro novo sem natureza tem só a pergunta inicial como pendência", () => {
    const vazio = { ...completo, name: "", unitMeasureId: "" };
    expect(pendenciasDoCadastro(vazio, null, true)).toEqual([{ step: "natureza", campo: "o que é este item" }]);
  });
});

describe("avisosDaNatureza", () => {
  test("insumo fora do CMV", () => {
    expect(avisosDaNatureza(INSUMO, "DESPESAS_GERAIS", true)).toHaveLength(1);
  });

  test("durável dentro do CMV", () => {
    expect(avisosDaNatureza(DURAVEL, "CMV_COMPRAS", false)).toHaveLength(1);
  });

  test("insumo fora do estoque", () => {
    expect(avisosDaNatureza(INSUMO, "CMV_COMPRAS", false)[0]).toContain("estoque");
  });

  test("combinação esperada não avisa", () => {
    expect(avisosDaNatureza(INSUMO, "CMV_COMPRAS", true)).toEqual([]);
    expect(avisosDaNatureza(null, "CMV_COMPRAS", true)).toEqual([]);
  });
});

describe("DRE por natureza", () => {
  test("sugere só os grupos da natureza, em ordem alfabética", () => {
    expect(dreSugeridas(INSUMO, DRE).map((c) => c.name)).toEqual(["Bebidas", "Custo de Alimentos"]);
  });

  test("categoria de produto sugere o DRE usual quando combina com a natureza", () => {
    expect(dreDaCategoria("FLV", INSUMO, DRE)?.id).toBe("d1");
    expect(dreDaCategoria("UTENSILIOS", DURAVEL, DRE)?.id).toBe("d3");
  });

  test("não sugere DRE de outro grupo", () => {
    expect(dreDaCategoria("UTENSILIOS", INSUMO, DRE)).toBeNull();
    expect(dreDaCategoria("QUALQUER", INSUMO, DRE)).toBeNull();
  });
});

describe("dreSugeridaParaCategoria", () => {
  test("usa a categoria DRE usual cadastrada na categoria, antes do mapa por nome", () => {
    const categoria = { name: "FLV", defaultDreCategoryId: "d3" };
    // d3 é do grupo DESPESAS_GERAIS: não combina com insumo, então cai no mapa por nome (FLV -> Custo de Alimentos).
    expect(dreSugeridaParaCategoria(categoria, INSUMO, DRE)?.id).toBe("d1");
    expect(dreSugeridaParaCategoria({ name: "QUALQUER", defaultDreCategoryId: "d2" }, INSUMO, DRE)?.id).toBe("d2");
  });

  test("sem natureza escolhida aceita a usual cadastrada", () => {
    expect(dreSugeridaParaCategoria({ name: "QUALQUER", defaultDreCategoryId: "d3" }, null, DRE)?.id).toBe("d3");
  });

  test("categoria sem usual e sem mapa não sugere nada", () => {
    expect(dreSugeridaParaCategoria({ name: "QUALQUER" }, INSUMO, DRE)).toBeNull();
    expect(dreSugeridaParaCategoria(null, INSUMO, DRE)).toBeNull();
  });
});

describe("aplicarNatureza", () => {
  test("aplica o estoque padrão e limpa o setor quando não controla estoque", () => {
    const antes = { ...emptyProductForm, inventorySectorId: "s1", controlsStock: true };
    const depois = aplicarNatureza(antes, DURAVEL, DRE);
    expect(depois.nature).toBe("DURAVEL");
    expect(depois.controlsStock).toBe(false);
    expect(depois.inventorySectorId).toBe("");
  });

  test("mantém o DRE quando o grupo combina e descarta quando não", () => {
    const comDre = { ...emptyProductForm, dreCategoryId: "d3" };
    expect(aplicarNatureza(comDre, DURAVEL, DRE).dreCategoryId).toBe("d3");
    expect(aplicarNatureza(comDre, INSUMO, DRE).dreCategoryId).toBe("");
  });

  test("não altera o formulário original", () => {
    const antes = { ...emptyProductForm };
    aplicarNatureza(antes, INSUMO, DRE);
    expect(antes).toEqual(emptyProductForm);
  });
});

describe("formToPayload", () => {
  test("omite a natureza quando não escolhida, para não apagar a gravada", () => {
    const payload = formToPayload({ ...emptyProductForm, id: "p1", name: "X" }, {}, []);
    expect("nature" in payload).toBe(false);
  });

  test("envia a natureza escolhida", () => {
    expect(formToPayload({ ...emptyProductForm, nature: "INSUMO" }, {}, []).nature).toBe("INSUMO");
  });

  test("só devolve conversões carregadas em edição", () => {
    const carregadas = [{ fromUnit: "CX", toUnit: "UN" }];
    expect(formToPayload({ ...emptyProductForm }, {}, carregadas).unitConversionsCarregadas).toEqual([]);
    expect(formToPayload({ ...emptyProductForm, id: "p1" }, {}, carregadas).unitConversionsCarregadas).toEqual(carregadas);
  });
});
