import { describe, expect, test } from "vitest";
import { REFINAMENTOS, proposeRefinement } from "../subcategory-refinement.js";

const refino = (name: string, categoryName: string, subcategoryName: string) => proposeRefinement({ name, categoryName, subcategoryName });

describe("proposeRefinement: vinho e destilados", () => {
  test.each([
    ["VINHO TINTO CABERNET RESERVA 750ML", "VINHO TINTO"],
    ["CHARDONNAY RESERVA BRANCO 750ML", "VINHO BRANCO"],
    ["VINHO VERDE 750ML", "VINHO BRANCO"],
    ["RESERVA ROSE 750ML", "VINHO ROSE"],
    ["VINHO DO PORTO RUBY 750ML", "VINHO DO PORTO"],
    ["RED BLEND SIGNATURE VINHO BRANCO", "VINHO BRANCO"],
    ["MALBEC 750ML", "VINHO TINTO"]
  ])("vinho: %s → %s", (nome, esperado) => {
    expect(refino(nome, "BEBIDAS", "VINHO")?.subcategory).toBe(esperado);
  });

  test.each([
    ["WHISKY RED LABEL 1 LITRO", "WHISKY"],
    ["GIN LONDON 750ML", "GIN"],
    ["VODKA 1 LITRO", "VODKA"],
    ["CACHACA ARTESANAL 700ML", "CACHACA"],
    ["LICOR DE CAFE 700ML", "LICORES E APERITIVOS"],
    ["APERITIVO BITTER 998ML", "LICORES E APERITIVOS"],
    ["RUM ESCURO 750ML", "RUM E TEQUILA"],
    ["SAQUE SECO 740ML", "SAQUE"],
    ["XAROPE DE MORANGO 700ML", "REFRESCOS E XAROPES"]
  ])("destilado: %s → %s", (nome, esperado) => {
    expect(refino(nome, "BEBIDAS", "DESTILADOS")?.subcategory).toBe(esperado);
  });

  test("palavra inteira: 'gin' não casa em 'origin'", () => {
    expect(refino("ORIGIN 750ML", "BEBIDAS", "DESTILADOS")?.subcategory).toBeNull();
  });
});

describe("proposeRefinement: limpeza, escritório, embalagem, uniformes, FLV", () => {
  test.each([
    ["LUVA LATEX DESCARTAVEL G", "LIMPEZA", "LIMPEZA", "LUVAS E SACOS DE LIXO"],
    ["SACO LIXO PT 100LTS", "LIMPEZA", "LIMPEZA", "LUVAS E SACOS DE LIXO"],
    ["ALCOOL GEL 70% 5 LITROS", "LIMPEZA", "LIMPEZA", "ALCOOL E ANTISSEPTICOS"],
    ["DETERGENTE LIQUIDO 5L", "LIMPEZA", "LIMPEZA", "QUIMICOS DE LIMPEZA"],
    ["VASSOURA MULTIUSO", "LIMPEZA", "LIMPEZA", "UTENSILIOS DE LIMPEZA"],
    ["GUARDANAPO FOLHA DUPLA 33X33", "LIMPEZA", "LIMPEZA", "PAPEIS DESCARTAVEIS"],
    ["CANETA ESFEROGRAFICA AZUL", "MATERIAL DE ESCRITORIO", "MATERIAL DE ESCRITORIO", "PAPELARIA"],
    ["FITA ADESIVA TRANSPARENTE", "MATERIAL DE ESCRITORIO", "MATERIAL DE ESCRITORIO", "FITAS E COLAS"],
    ["TINTA IMPRESSORA PRETA", "MATERIAL DE ESCRITORIO", "MATERIAL DE ESCRITORIO", "IMPRESSAO E ETIQUETAS"],
    ["POTE RETANGULAR 500ML", "EMBALAGEM", "DELIVERY", "POTES E GARRAFAS"],
    ["SACOLA KRAFT 30X32", "EMBALAGEM", "DELIVERY", "SACOLAS E SACOS"],
    ["ETIQUETA LACRE 90X30", "EMBALAGEM", "DELIVERY", "ETIQUETAS E LACRES"],
    ["CALCA BRIM PRETA TAM M", "UNIFORMES", "UNIFORME", "CALCAS"],
    ["BOTA PVC BRANCA", "UNIFORMES", "UNIFORME", "CALCADOS"],
    ["BATATA INGLESA", "FLV", "LEGUMES", "TUBERCULOS E RAIZES"],
    ["TOMATE CEREJA", "FLV", "LEGUMES", "TOMATES E PIMENTOES"],
    ["PIMENTA DEDO DE MOCA", "FLV", "LEGUMES", "PIMENTAS"],
    ["ALHO DESCASCADO", "FLV", "LEGUMES", "ALHO E CEBOLA"],
    ["HORTELA", "FLV", "VERDURAS", "ERVAS FRESCAS"],
    ["ALFACE CRESPA", "FLV", "VERDURAS", "FOLHAS"]
  ])("%s (%s > %s) → %s", (nome, categoria, sub, esperado) => {
    expect(refino(nome, categoria, sub)?.subcategory).toBe(esperado);
  });

  test("o 'limp' de limpa-vidros não vira utensílio: ordem das regras", () => {
    expect(refino("LIMPA ALUMINIO 5L", "LIMPEZA", "LIMPEZA")?.subcategory).toBe("QUIMICOS DE LIMPEZA");
  });
});

describe("proposeRefinement: mal colocados", () => {
  test("pão francês em 'café funcionário' vai para PAES", () => {
    expect(refino("PAO FRANCES", "PAES E MASSAS", "CAFÉ FUNCIONÁRIO")?.subcategory).toBe("PAES");
  });

  test("caldo em 'água' vai para temperos", () => {
    expect(refino("CALDO DE GALINHA 1KG", "MOLHOS, TEMPEROS E CONSERVAS", "AGUA")?.subcategory).toBe("TEMPEROS E ESPECIARIAS");
  });

  test("copo descartável em escritório: esvazia a subcategoria e sugere a categoria DESCARTAVEIS", () => {
    expect(refino("COPO DE PAPEL DESCARTAVEL 60ML", "MATERIAL DE ESCRITORIO", "MATERIAL DE ESCRITORIO")).toMatchObject({
      subcategory: null,
      esvaziar: true,
      categoriaSugerida: "DESCARTAVEIS"
    });
  });

  test("copo em DESCARTAVEIS > material de escritório: esvazia, sem mexer na categoria", () => {
    expect(refino("COPO DE PAPEL 110ML", "DESCARTAVEIS", "MATERIAL DE ESCRITORIO")).toMatchObject({ esvaziar: true, categoriaSugerida: null });
  });
});

describe("proposeRefinement: casos sem refino", () => {
  test("subcategoria sem refino devolve nulo", () => {
    expect(refino("ARROZ", "SECOS E GRAOS", "ARROZ")).toBeNull();
    expect(refino("X", "BEBIDAS", "CERVEJA")).toBeNull();
  });

  test("nome que não casa com nada fica onde está, com o motivo", () => {
    expect(refino("PRODUTO MISTERIOSO", "BEBIDAS", "VINHO")).toMatchObject({ subcategory: null, esvaziar: false });
  });

  test("categoria e subcategoria atuais são comparadas sem acento nem caixa", () => {
    expect(refino("PAO FRANCES", "Paes e Massas", "Café Funcionário")?.subcategory).toBe("PAES");
  });
});

describe("regras", () => {
  test("os nomes de subcategoria propostos são maiúsculos, sem acento, e não repetem refino para a mesma subcategoria", () => {
    const vistos = new Set<string>();
    for (const r of REFINAMENTOS) {
      const chave = `${r.categoria}|${r.subcategoriaAtual}`;
      expect(vistos.has(chave), chave).toBe(false);
      vistos.add(chave);
      for (const regra of r.regras) if (regra.subcategory) expect(regra.subcategory, chave).toMatch(/^[A-Z0-9, ]+$/);
    }
  });
});
