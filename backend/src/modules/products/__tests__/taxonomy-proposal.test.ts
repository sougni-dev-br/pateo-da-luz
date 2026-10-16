import { describe, expect, it } from "vitest";
import {
  PROPOSED_CATEGORIES,
  proposeCategory,
  proposeNature,
  proposeSubcategoryAction,
  type ProductRow
} from "../taxonomy-proposal.js";

// Nomes inventados de propósito: o repositório é público e nome real de produto não entra em teste.
const linha = (extra: Partial<ProductRow>): ProductRow => ({
  name: "ITEM TESTE",
  categoryName: "INSUMOS",
  subcategoryName: null,
  sectorName: "ESTOQUE",
  dreName: "Custo de Alimentos",
  dreGroup: "CMV_COMPRAS",
  controlsStock: true,
  ...extra
});

describe("proposeNature", () => {
  it("DRE de CMV vira insumo, e embalagem quando a DRE é de embalagem", () => {
    expect(proposeNature(linha({})).nature).toBe("INSUMO");
    expect(proposeNature(linha({ dreName: "Bebidas" })).nature).toBe("INSUMO");
    expect(proposeNature(linha({ dreName: "Embalagens" })).nature).toBe("EMBALAGEM");
    expect(proposeNature(linha({ dreName: "Descartáveis / Delivery" })).nature).toBe("EMBALAGEM");
  });

  it("limpeza e escritório são consumo", () => {
    const base = { dreGroup: "DESPESAS_GERAIS", controlsStock: false };
    expect(proposeNature(linha({ ...base, dreName: "Material de Limpeza" })).nature).toBe("CONSUMO");
    expect(proposeNature(linha({ ...base, dreName: "Material de Escritório" })).nature).toBe("CONSUMO");
  });

  it("utensílio, equipamento e uniforme são duráveis", () => {
    const base = { dreGroup: "DESPESAS_GERAIS", controlsStock: false };
    for (const dreName of ["Utensílios Operacionais", "Equipamentos", "Uniformes"]) {
      expect(proposeNature(linha({ ...base, dreName })).nature).toBe("DURAVEL");
    }
  });

  it("manutenção, publicidade e software são serviço", () => {
    const base = { dreGroup: "DESPESAS_GERAIS", controlsStock: false };
    for (const dreName of ["Manutenção", "Publicidade", "Sistema / Software", "Transporte / Mobilidade", "Serviços de Terceiros"]) {
      expect(proposeNature(linha({ ...base, dreName })).nature).toBe("SERVICO");
    }
  });

  it("DRE de imposto, pessoal ou vale-transporte vira serviço, mas pede revisão", () => {
    const resultado = proposeNature(linha({ dreGroup: "IMPOSTOS", dreName: "GARE / ICMS", controlsStock: false }));
    expect(resultado.nature).toBe("SERVICO");
    expect(resultado.confidence).toBe("revisar");
  });

  it("sem DRE não propõe natureza", () => {
    const resultado = proposeNature(linha({ dreName: null, dreGroup: null }));
    expect(resultado.nature).toBeNull();
    expect(resultado.confidence).toBe("revisar");
  });

  it("nome de descartável numa categoria de utensílio pede revisão", () => {
    const resultado = proposeNature(
      linha({ name: "PRATO TESTE DESCARTAVEL", categoryName: "UTENSILIOS", dreGroup: "DESPESAS_GERAIS", dreName: "Utensílios Operacionais", controlsStock: false })
    );
    expect(resultado.nature).toBe("DURAVEL");
    expect(resultado.confidence).toBe("revisar");
  });

  it("item de CMV que não controla estoque pede revisão", () => {
    expect(proposeNature(linha({ controlsStock: false })).confidence).toBe("revisar");
  });
});

describe("proposeCategory: insumos por palavra-chave", () => {
  const nova = (name: string, extra: Partial<ProductRow> = {}) => proposeCategory(linha({ name, ...extra })).category;

  it("separa as categorias novas pelo nome do item", () => {
    expect(nova("QUEIJO FICTICIO FATIADO 1KG")).toBe("LATICINIOS E FRIOS");
    expect(nova("MOLHO FICTICIO 1L")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("FEIJAO FICTICIO 1KG")).toBe("SECOS E GRAOS");
    expect(nova("CHOCOLATE FICTICIO BARRA 1KG")).toBe("DOCES E CONFEITARIA");
    expect(nova("PAO FICTICIO CONGELADO 2KG")).toBe("CONGELADOS");
  });

  it("doce de leite é confeitaria, não laticínio", () => {
    expect(nova("DOCE DE LEITE FICTICIO 1KG")).toBe("DOCES E CONFEITARIA");
  });

  it("leite em pó é seco, não laticínio", () => {
    expect(nova("LEITE EM PO FICTICIO 380G")).toBe("SECOS E GRAOS");
  });

  it("carne salgada vai para carnes e aves", () => {
    expect(nova("COSTELA FICTICIA SALGADA")).toBe("CARNES E AVES");
  });

  it("vinho, saquê e vinagre de cozinha ficam em insumos, na categoria de líquidos de cozinha", () => {
    expect(nova("VINHO TINTO FICTICIO 4,6 LITROS")).toBe("LIQUIDOS DE COZINHA");
    expect(nova("SAQUE FICTICIO 5LT")).toBe("LIQUIDOS DE COZINHA");
    expect(nova("VINAGRE FICTICIO 750ML")).toBe("LIQUIDOS DE COZINHA");
  });

  it("tempero, conserva, fruta seca, frio, pão e doce de balcão caem nas categorias certas", () => {
    expect(nova("CANELA FICTICIA EM PO 500G")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("PICKLES FICTICIO 2KG")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("UVA PASSA FICTICIA 1KG")).toBe("SECOS E GRAOS");
    expect(nova("AMIDO DE MILHO FICTICIO 1KG")).toBe("SECOS E GRAOS");
    expect(nova("SALAME FICTICIO")).toBe("LATICINIOS E FRIOS");
    expect(nova("CREAM CHEESE FICTICIO 400G")).toBe("LATICINIOS E FRIOS");
    expect(nova("PAO FICTICIO DE FORMA")).toBe("PAES E MASSAS");
    expect(nova("BALA FICTICIA 500G")).toBe("DOCES E CONFEITARIA");
    expect(nova("PAO DE QUEIJO FICTICIO 1KG")).toBe("CONGELADOS");
  });

  it("água e refresco ficam em bebidas, com confiança média", () => {
    const resultado = proposeCategory(linha({ name: "AGUA FICTICIA 500ML" }));
    expect(resultado.category).toBe("BEBIDAS");
    expect(resultado.confidence).toBe("media");
  });

  it("palavra que muda de sentido pelo contexto não reclassifica o item", () => {
    expect(nova("PIMENTA FICTICIA CALABRESA 1KG")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("MANTEIGA FICTICIA SALGADA 200G")).toBe("LATICINIOS E FRIOS");
    expect(nova("MANTEIGA FICTICIA SEM SAL 200G")).toBe("LATICINIOS E FRIOS");
    expect(nova("AMENDOIM FICTICIO COM SAL")).not.toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("CALDO FICTICIO DE CARNE 1KG")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("TEMPERO FICTICIO PARA FRANGO")).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(nova("PAO FICTICIO DE HAMBURGUER")).toBe("PAES E MASSAS");
    expect(nova("LEITE DE COCO FICTICIO 200ML")).toBe("SECOS E GRAOS");
  });

  it("água sanitária é de limpeza e hortifrúti ambíguo pede conferência", () => {
    const limpeza = proposeCategory(linha({ name: "AGUA SANITARIA FICTICIA 2L" }));
    expect(limpeza.category).toBe("LIMPEZA");
    expect(limpeza.confidence).toBe("media");
    const pepino = proposeCategory(linha({ name: "PEPINO FICTICIO 2KG" }));
    expect(pepino.category).toBe("MOLHOS, TEMPEROS E CONSERVAS");
    expect(pepino.confidence).toBe("media");
  });

  it("marca de refresco não leva gelatina para bebidas, e gelo é de bar", () => {
    expect(nova("GELATINA FICTICIA SEM SABOR 5KG")).toBe("DOCES E CONFEITARIA");
    expect(nova("GELO FICTICIO PACOTE 5KG")).toBe("BEBIDAS");
  });

  it("item com prefixo ZZ é sinalizado como possível teste", () => {
    const resultado = proposeCategory(linha({ name: "ZZ ITEM FICTICIO 1", categoryName: null }));
    expect(resultado.category).toBeNull();
    expect(resultado.reason).toContain("teste");
  });

  it("nome que não casa com regra nenhuma fica para revisão", () => {
    const resultado = proposeCategory(linha({ name: "XYZ FICTICIO" }));
    expect(resultado.category).toBeNull();
    expect(resultado.confidence).toBe("revisar");
  });

  it("palavra-chave só vale dentro da palavra inteira", () => {
    // "CHAMP" não pode casar com "CHAMPIGNON" nem "CHAMPAGNE" por pedaço de palavra.
    expect(nova("BISCOITO CHAMP FICTICIO 150G")).toBe("SECOS E GRAOS");
  });
});

describe("proposeCategory: demais categorias", () => {
  it("mantém a categoria atual quando ela já é uma das propostas", () => {
    expect(proposeCategory(linha({ categoryName: "FLV", name: "ALFACE FICTICIA" })).category).toBe("FLV");
    expect(proposeCategory(linha({ categoryName: "BEBIDAS", dreName: "Bebidas", name: "SUCO FICTICIO" })).category).toBe("BEBIDAS");
  });

  it("divide a categoria DESPESAS pela DRE do item", () => {
    const base = { categoryName: "DESPESAS", dreGroup: "DESPESAS_GERAIS", controlsStock: false };
    expect(proposeCategory(linha({ ...base, dreName: "Material de Escritório" })).category).toBe("MATERIAL DE ESCRITORIO");
    expect(proposeCategory(linha({ ...base, dreName: "Uniformes" })).category).toBe("UNIFORMES");
    expect(proposeCategory(linha({ ...base, dreName: "Manutenção" })).category).toBe("MANUTENCAO");
    expect(proposeCategory(linha({ ...base, dreName: "Publicidade" })).category).toBe("PUBLICIDADE");
    expect(proposeCategory(linha({ ...base, dreName: "Equipamentos" })).category).toBe("EQUIPAMENTOS");
  });

  it("item de CMV que está em DESPESAS segue a regra de insumo, mas pede revisão", () => {
    const resultado = proposeCategory(linha({ categoryName: "DESPESAS", name: "QUEIJO FICTICIO" }));
    expect(resultado.category).toBe("LATICINIOS E FRIOS");
    expect(resultado.confidence).toBe("revisar");
  });

  it("toda categoria proposta tem natureza e DRE padrão", () => {
    for (const [nome, definicao] of Object.entries(PROPOSED_CATEGORIES)) {
      expect(definicao.nature, nome).toBeTruthy();
      expect(definicao.dreName, nome).toBeTruthy();
    }
  });
});

describe("proposeSubcategoryAction", () => {
  it("subcategoria chamada 0 é resíduo de importação", () => {
    expect(proposeSubcategoryAction({ name: "0", products: 3, nameRepeatedIn: 8 }).action).toBe("DESFAZER_E_LIMPAR");
  });

  it("subcategoria vazia pode ser removida", () => {
    expect(proposeSubcategoryAction({ name: "ALGUMA", products: 0, nameRepeatedIn: 1 }).action).toBe("REMOVER_VAZIA");
  });

  it("mesmo nome em mais de uma categoria pede revisão", () => {
    expect(proposeSubcategoryAction({ name: "AGUA", products: 2, nameRepeatedIn: 2 }).action).toBe("REVISAR_DUPLICADA");
  });

  it("subcategoria normal fica como está", () => {
    expect(proposeSubcategoryAction({ name: "DESTILADOS", products: 12, nameRepeatedIn: 1 }).action).toBe("MANTER");
  });
});
