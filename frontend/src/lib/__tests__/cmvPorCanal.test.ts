import { describe, expect, it } from "vitest";
import type { DishListItem } from "../../api/client";
import {
  FILTRO_DA_MATRIZ,
  contarSemFicha,
  filtrarMatriz,
  montarColunas,
  montarMatriz,
  resumirColunas
} from "../cmvPorCanal";
import { situacaoDaFicha } from "../fichaTecnica";

function prato(parcial: Partial<DishListItem> = {}): DishListItem {
  return {
    id: "d", code: null, name: "Filé", menu: "CARDAPIO", category: null, salePriceDefault: 80, yieldQty: 1, yieldUnit: "UN", isActive: true,
    itemsCount: 1, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 24, custoPorcao: 24, margemBruta: 56,
    cmvPercentual: 30, custoIncompleto: false, canais: [], ...parcial
  };
}

const canal = (channel: string, loja: string, price: number) => ({ channel, deliveryStoreId: `s-${loja}`, storeName: loja, price });

// Filé: salão R$ 80 e delivery em 3 lojas (99 em duas, com preços diferentes, e iFood).
const FILE = prato({
  id: "f", alsoMenu: "DELIVERY",
  canais: [canal("NOVENTA_NOVE", "Frei Caneca", 100), canal("NOVENTA_NOVE", "Pizzaria", 60), canal("IFOOD", "Pateo da Luz", 120)]
});
const SO_DELIVERY = prato({ id: "p", name: "Pizza", menu: "DELIVERY", salePriceDefault: null, custoPorcao: 15, canais: [canal("NOVENTA_NOVE", "Frei Caneca", 50)] });
const SEM_FICHA = prato({ id: "s", name: "Pudim", itemsCount: 0, custoPorcao: 0, cmvPercentual: 0 });

describe("colunas do CMV por canal", () => {
  it("por canal: salão primeiro, depois 99, iFood e Keeta, só onde há prato", () => {
    expect(montarColunas([FILE, SO_DELIVERY], "canal").map((c) => c.rotulo)).toEqual(["Salão (a la carte)", "99 Food", "iFood"]);
  });

  it("por loja: uma coluna por loja de cada plataforma, na ordem da plataforma e do nome", () => {
    const colunas = montarColunas([FILE, SO_DELIVERY], "loja");
    expect(colunas.map((c) => c.rotulo)).toEqual(["Salão (a la carte)", "Frei Caneca", "Pizzaria", "Pateo da Luz"]);
    expect(colunas.map((c) => c.canal)).toEqual(["SALAO", "NOVENTA_NOVE", "NOVENTA_NOVE", "IFOOD"]);
  });

  it("prato só do delivery não cria a coluna do salão", () => {
    expect(montarColunas([SO_DELIVERY], "canal").map((c) => c.canal)).toEqual(["NOVENTA_NOVE"]);
  });
});

describe("matriz de CMV", () => {
  it("cada lugar usa o preço dele sobre o mesmo custo", () => {
    const colunas = montarColunas([FILE], "loja");
    const [linha] = montarMatriz([FILE], colunas, "loja");
    const cmv = (chave: string) => linha.celulas[chave].cmv;
    expect(cmv("SALAO")).toBeCloseTo(30); // 24 / 80
    expect(cmv("NOVENTA_NOVE|Frei Caneca")).toBeCloseTo(24); // 24 / 100
    expect(cmv("NOVENTA_NOVE|Pizzaria")).toBeCloseTo(40); // 24 / 60
    expect(cmv("IFOOD|Pateo da Luz")).toBeCloseTo(20); // 24 / 120
    expect(linha.piorCmv).toBeCloseTo(40);
  });

  it("por canal, a plataforma com lojas de preços diferentes mostra o pior CMV e a faixa de preço", () => {
    const [linha] = montarMatriz([FILE], montarColunas([FILE], "canal"), "canal");
    expect(linha.celulas.NOVENTA_NOVE).toMatchObject({ estado: "ok", lojas: 2, precoMin: 60, precoMax: 100 });
    expect(linha.celulas.NOVENTA_NOVE.cmv).toBeCloseTo(40);
  });

  it("onde o prato não é vendido, 'nao-vende'; sem preço no salão, 'sem-preco'; sem ficha, 'sem-ficha'; custo parcial, 'incompleta'", () => {
    const parcial = prato({ id: "i", name: "Parcial", custoIncompleto: true, canais: [] });
    const semPrecoNoSalao = prato({ id: "n", name: "Sem preço", salePriceDefault: null });
    const pratos = [SO_DELIVERY, SEM_FICHA, parcial, semPrecoNoSalao, FILE];
    const colunas = montarColunas(pratos, "canal");
    const porId = Object.fromEntries(montarMatriz(pratos, colunas, "canal").map((l) => [l.prato.id, l]));

    expect(porId.p.celulas.SALAO.estado).toBe("nao-vende");
    expect(porId.s.celulas.SALAO.estado).toBe("sem-ficha");
    expect(porId.i.celulas.SALAO.estado).toBe("incompleta");
    expect(porId.i.celulas.SALAO.cmv).toBeNull(); // nunca um número bonito e errado
    expect(porId.n.celulas.SALAO.estado).toBe("sem-preco");
    expect(porId.f.celulas.IFOOD.estado).toBe("ok");
    expect(porId.p.celulas.IFOOD.estado).toBe("nao-vende");
  });

  it("resume cada lugar: CMV médio, quantos pratos e quantos altos", () => {
    const outro = prato({ id: "o", name: "Outro", custoPorcao: 40, canais: [] }); // salão: 40/80 = 50% (alto)
    const colunas = montarColunas([FILE, outro], "canal");
    const resumos = resumirColunas(montarMatriz([FILE, outro], colunas, "canal"), colunas);
    const salao = resumos.find((r) => r.coluna.canal === "SALAO")!;
    expect(salao).toMatchObject({ analisados: 2, altos: 1, bons: 1 });
    expect(salao.cmvMedio).toBeCloseTo(40); // (30 + 50) / 2
    expect(resumos.find((r) => r.coluna.canal === "IFOOD")!.analisados).toBe(1);
  });
});

describe("CMV sobre o líquido da 99", () => {
  // Frei Caneca: chega 50% da tabela; Pizzaria: 40%. O preço de tabela de cada uma é o do canal.
  const razoes = { "s-Frei Caneca": 0.5, "s-Pizzaria": 0.4 };

  it("na 99 o preço vira o líquido da loja; salão e iFood seguem pela tabela", () => {
    const colunas = montarColunas([FILE], "loja");
    const [linha] = montarMatriz([FILE], colunas, "loja", razoes);
    expect(linha.celulas["NOVENTA_NOVE|Frei Caneca"]).toMatchObject({ sobreLiquido: true, preco: 50 });
    expect(linha.celulas["NOVENTA_NOVE|Frei Caneca"].cmv).toBeCloseTo(48); // 24 / (100 × 0,5)
    expect(linha.celulas["NOVENTA_NOVE|Pizzaria"].cmv).toBeCloseTo(100); // 24 / (60 × 0,4)
    expect(linha.celulas.SALAO).toMatchObject({ sobreLiquido: false });
    expect(linha.celulas.SALAO.cmv).toBeCloseTo(30);
    expect(linha.celulas["IFOOD|Pateo da Luz"]).toMatchObject({ sobreLiquido: false });
    expect(linha.celulas["IFOOD|Pateo da Luz"].cmv).toBeCloseTo(20);
  });

  it("por canal, a 99 mostra o pior líquido entre as lojas", () => {
    const [linha] = montarMatriz([FILE], montarColunas([FILE], "canal"), "canal", razoes);
    expect(linha.celulas.NOVENTA_NOVE).toMatchObject({ sobreLiquido: true, precoMin: 24, precoMax: 50 });
    expect(linha.celulas.NOVENTA_NOVE.cmv).toBeCloseTo(100);
  });

  it("Keeta sem loja cadastrada usa a razão da plataforma (chave plataforma:KEETA)", () => {
    const keeta = prato({ id: "k", name: "Keeta", menu: "DELIVERY", salePriceDefault: null, custoPorcao: 30, canais: [{ channel: "KEETA", deliveryStoreId: null, storeName: null, price: 100 }] });
    const colunas = montarColunas([keeta], "loja");
    const [linha] = montarMatriz([keeta], colunas, "loja", { "plataforma:KEETA": 0.78 });
    const celula = linha.celulas[colunas[0].chave];
    expect(celula).toMatchObject({ sobreLiquido: true });
    expect(celula.preco).toBeCloseTo(78);
    expect(celula.cmv).toBeCloseTo(38.46, 1); // 30 / 78
  });

  it("loja sem razão medida fica pela tabela, e sem razões nada muda", () => {
    const [semRazao] = montarMatriz([FILE], montarColunas([FILE], "loja"), "loja", { "s-Frei Caneca": 0.5 });
    expect(semRazao.celulas["NOVENTA_NOVE|Pizzaria"]).toMatchObject({ sobreLiquido: false });
    expect(semRazao.celulas["NOVENTA_NOVE|Pizzaria"].cmv).toBeCloseTo(40);
    const [tabela] = montarMatriz([FILE], montarColunas([FILE], "loja"), "loja");
    expect(tabela.celulas["NOVENTA_NOVE|Frei Caneca"].cmv).toBeCloseTo(24);
  });
});

describe("filtro da matriz", () => {
  const pratos = [SEM_FICHA, SO_DELIVERY, FILE, prato({ id: "o", name: "Outro", custoPorcao: 40 })];
  const linhas = montarMatriz(pratos, montarColunas(pratos, "canal"), "canal");
  const ids = (filtro: Partial<typeof FILTRO_DA_MATRIZ>) => filtrarMatriz(linhas, { ...FILTRO_DA_MATRIZ, ...filtro }).map((l) => l.prato.id);

  it("por padrão deixa de fora quem não tem ficha e ordena do pior CMV para o melhor", () => {
    expect(contarSemFicha(pratos)).toBe(1);
    // Outro 50% (salão) > Filé 40% (pior loja) > Pizza 30% (15/50).
    expect(ids({})).toEqual(["o", "f", "p"]);
  });

  it("incluir sem ficha traz o prato, no fim", () => {
    expect(ids({ comSemFicha: true })).toEqual(["o", "f", "p", "s"]);
  });

  it("só CMV alto e busca (sem acento, em qualquer ordem)", () => {
    expect(ids({ soAltos: true })).toEqual(["o"]);
    expect(ids({ busca: "pizza" })).toEqual(["p"]);
    expect(ids({ ordem: "nome" })).toEqual(["f", "o", "p"]);
  });
});

describe("situação da ficha com preço só nas lojas", () => {
  it("prato do delivery sem preço no salão mas com preço nas lojas não é 'sem preço'", () => {
    const base = { itemsCount: 2, custoIncompleto: false, salePriceDefault: null, cmvPercentual: null };
    expect(situacaoDaFicha({ ...base, listingsCount: 0 })).toBe("sem-preco");
    expect(situacaoDaFicha({ ...base, listingsCount: 2 })).toBe("ok");
    expect(situacaoDaFicha(base)).toBe("sem-preco");
  });
});
