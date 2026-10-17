import { describe, expect, test } from "vitest";
import { SUBCATEGORY_RULES, proposeSubcategoryForProduct, subcategoriasDaProposta } from "../subcategory-proposal.js";

const proposta = (name: string, categoryName: string) => proposeSubcategoryForProduct({ name, categoryName }).subcategory;

describe("proposeSubcategoryForProduct: secos e grãos", () => {
  test.each([
    ["ARROZ BRANCO TIPO 1 5KG", "ARROZ"],
    ["BISCOITO MAIZENA 170G", "BISCOITOS E SNACKS"],
    ["FARINHA DE TRIGO 1KG", "FARINHAS E AMIDOS"],
    ["AMIDO DE MILHO 200G", "FARINHAS E AMIDOS"],
    ["FEIJAO CARIOCA 1KG", "FEIJOES E GRAOS"],
    ["MACARRAO ESPAGUETE 500G", "MACARRAO E MASSAS SECAS"],
    ["MISTURA PARA BOLO", "FERMENTOS E MISTURAS"],
    ["FERMENTO EM PO 100G", "FERMENTOS E MISTURAS"],
    ["LEITE DE COCO 200ML", "LEITES EM PO E DE COCO"],
    ["COCO RALADO 100G", "OLEAGINOSAS E FRUTAS SECAS"],
    ["CHÁ MATE 15G", "CAFES, CHAS E ACHOCOLATADOS"],
    ["ACUCAR REFINADO", "ACUCARES E ADOCANTES"]
  ])("%s → %s", (nome, esperado) => {
    expect(proposta(nome, "SECOS E GRAOS")).toBe(esperado);
  });

  test("a ordem importa: biscoito maizena é biscoito, não amido", () => {
    expect(proposta("BISCOITO MAIZENA", "SECOS E GRAOS")).toBe("BISCOITOS E SNACKS");
  });
});

describe("proposeSubcategoryForProduct: outras categorias", () => {
  test.each([
    ["ATUM RALADO EM OLEO", "MOLHOS, TEMPEROS E CONSERVAS", "CONSERVAS"],
    ["AZEITE EXTRA VIRGEM", "MOLHOS, TEMPEROS E CONSERVAS", "OLEOS E AZEITES"],
    ["MOLHO PIMENTA", "MOLHOS, TEMPEROS E CONSERVAS", "MOLHOS PRONTOS"],
    ["SAL 1KG", "MOLHOS, TEMPEROS E CONSERVAS", "TEMPEROS E ESPECIARIAS"],
    ["CHOCOLATE EM PO 200G", "DOCES E CONFEITARIA", "CHOCOLATES E COBERTURAS"],
    ["LEITE CONDENSADO 395G", "DOCES E CONFEITARIA", "DOCE DE LEITE E LEITE CONDENSADO"],
    ["ESSENCIA DE BAUNILHA", "DOCES E CONFEITARIA", "ESSENCIAS E CORANTES"],
    ["COSTELA SUINA", "CARNES E AVES", "SUINAS"],
    ["COSTELA BOVINA", "CARNES E AVES", "BOVINAS"],
    ["LOMBO SALGADO", "CARNES E AVES", "SALGADOS E CURADOS"],
    ["LINGUICA TOSCANA", "CARNES E AVES", "LINGUICAS"],
    ["COXA DE FRANGO", "CARNES E AVES", "AVES"],
    ["CREME DE LEITE 200G", "LATICINIOS E FRIOS", "CREMES E REQUEIJOES"],
    ["MUSSARELA FATIADA", "LATICINIOS E FRIOS", "QUEIJOS"],
    ["PRESUNTO COZIDO", "LATICINIOS E FRIOS", "FRIOS E EMBUTIDOS"],
    ["BATATA PALITO CONGELADA", "CONGELADOS", "BATATAS E FRITURAS"],
    ["PAO DE QUEIJO", "CONGELADOS", "SALGADOS E PAES DE QUEIJO"],
    ["MASSA PARA PASTEL", "PAES E MASSAS", "MASSAS FRESCAS"],
    ["PAO BRIOCHE", "PAES E MASSAS", "PAES"],
    ["VINAGRE TINTO 750ML", "LIQUIDOS DE COZINHA", "VINAGRES"],
    ["VINHO TINTO SECO 4,6 LITROS", "LIQUIDOS DE COZINHA", "VINHOS DE COZINHA"],
    ["COPO LONG DRINK", "UTENSILIOS", "COPOS E TACAS"],
    ["FACA PEQUENA", "UTENSILIOS", "TALHERES"],
    ["CAIXA DE PIZZA 35CM", "EMBALAGEM", "CAIXAS E SACOS"]
  ])("%s (%s) → %s", (nome, categoria, esperado) => {
    expect(proposta(nome, categoria)).toBe(esperado);
  });

  test("palavra inteira: 'sal' não casa em 'salame' e 'cha' não casa em 'champignon'", () => {
    expect(proposta("SALAME ITALIANO", "MOLHOS, TEMPEROS E CONSERVAS")).toBeNull();
    expect(proposta("CHAMPIGNON FATIADO", "SECOS E GRAOS")).toBeNull();
    expect(proposta("CHAMPIGNON FATIADO", "MOLHOS, TEMPEROS E CONSERVAS")).toBe("CONSERVAS");
  });

  test("categoria sem regras e nome que não casa ficam sem proposta, com o motivo", () => {
    expect(proposeSubcategoryForProduct({ name: "ALUGUEL", categoryName: "ALUGUEL E TARIFAS" })).toMatchObject({ subcategory: null, reason: "categoria sem subcategorias propostas" });
    expect(proposeSubcategoryForProduct({ name: "PRODUTO MISTERIOSO", categoryName: "SECOS E GRAOS" })).toMatchObject({ subcategory: null, reason: "o nome não casa com nenhuma subcategoria" });
  });

  test("categoria com acento e caixa diferentes ainda é reconhecida", () => {
    expect(proposta("ARROZ", "Secos e Grãos")).toBe("ARROZ");
  });
});

describe("ordem das regras", () => {
  test.each([
    ["FARINHA DE ARROZ", "SECOS E GRAOS", "FARINHAS E AMIDOS"],
    ["FARINHA DE COCO", "SECOS E GRAOS", "FARINHAS E AMIDOS"],
    ["ACHOCOLATADO COM LEITE", "SECOS E GRAOS", "CAFES, CHAS E ACHOCOLATADOS"],
    ["COPO DE PAPEL", "EMBALAGEM", "COPOS, TALHERES E POTES"],
    ["CAMAROES SETE BARBAS", "PEIXES", "CAMAROES"],
    ["BARRA DE CHOCOLATE", "SECOS E GRAOS", null]
  ])("%s (%s) → %s", (nome, categoria, esperado) => {
    expect(proposta(nome, categoria)).toBe(esperado);
  });

  test("pão de mel não vira aviso de categoria por causa da palavra mel", () => {
    expect(proposeSubcategoryForProduct({ name: "PAO DE MEL", categoryName: "DOCES E CONFEITARIA" }).categoriaSugerida).toBeNull();
    expect(proposeSubcategoryForProduct({ name: "MEL 500G", categoryName: "DOCES E CONFEITARIA" }).categoriaSugerida).toBe("SECOS E GRAOS");
  });
});

describe("categoria sugerida (só aviso)", () => {
  test.each([
    ["ALHO FRITO GRANULADO", "DOCES E CONFEITARIA", "MOLHOS, TEMPEROS E CONSERVAS"],
    ["REQUEIJAO BISNAGA", "DOCES E CONFEITARIA", "LATICINIOS E FRIOS"],
    ["KIT KAT AO LEITE", "LATICINIOS E FRIOS", "DOCES E CONFEITARIA"],
    ["AMACIANTE DE CARNE", "CARNES E AVES", "MOLHOS, TEMPEROS E CONSERVAS"]
  ])("%s está em %s mas parece de %s", (nome, categoria, sugerida) => {
    const resultado = proposeSubcategoryForProduct({ name: nome, categoryName: categoria });
    expect(resultado.categoriaSugerida).toBe(sugerida);
    expect(resultado.subcategory).toBeNull();
  });
});

describe("regras", () => {
  test("toda subcategoria proposta tem nome em maiúsculas, sem acento e sem repetição dentro da categoria", () => {
    for (const [categoria, regras] of Object.entries(SUBCATEGORY_RULES)) {
      const nomes = regras.map((regra) => regra.subcategory);
      expect(new Set(nomes).size, categoria).toBe(nomes.length);
      for (const nome of nomes) expect(nome, `${categoria}: ${nome}`).toMatch(/^[A-Z0-9, ]+$/);
    }
  });

  test("lista as subcategorias da categoria sem repetir", () => {
    const lista = subcategoriasDaProposta("SECOS E GRAOS");
    expect(lista).toContain("ARROZ");
    expect(new Set(lista).size).toBe(lista.length);
  });
});
