import { describe, expect, test, vi } from "vitest";
import { MAX_NIVEIS, anexarFichas, arredondarProporcao, primeiroProblemaDeFicha, resolverFichas, sugerirFichasDeProducao } from "../dish-fichas-de-producao.js";
import { carregarDetalhe } from "../dish-detail.js";
import type { ClienteDoBanco } from "../dish-itens.js";

// Dados fictícios. Massa: 2 ingredientes que custam R$ 9 no total para 12 porções (R$ 0,75 a porção).
const produto = (name: string, unit: string, custo: number | null) => ({
  id: `p-${name}`, externalCode: null, name, unit, stockUnit: unit,
  inventoryStock: custo == null ? null : { averageCost: custo, currentQuantity: 10 },
  conversions: [] as Array<{ fromUnit: string; toUnit: string; factor: number }>
});

const FARINHA = produto("FARINHA", "KG", 5);
const BATATA = produto("BATATA", "KG", 4);
const QUEIJO = produto("QUEIJO", "KG", 40);

type Linha = {
  id: string; name: string; code: string | null; menu: string; alsoMenu: string | null; yieldQty: number; yieldUnit: string;
  items: Array<{ menu: string; quantity: number; unit: string; wasteFactor: number; componentDishId: string | null; product: ReturnType<typeof produto> | null }>;
};

const item = (p: ReturnType<typeof produto> | null, quantity: number, unit: string, componentDishId: string | null = null) =>
  ({ menu: "DELIVERY", quantity, unit, wasteFactor: 0, componentDishId, product: p });

const MASSA: Linha = { id: "massa", name: "Nhoque - Massa", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 12, yieldUnit: "UN", items: [item(FARINHA, 1000, "G"), item(BATATA, 1000, "G")] };

/** Cliente de mentira: findMany devolve as fichas pedidas por id, e conta quantas consultas foram feitas. */
function banco(fichas: Linha[]) {
  const findMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => fichas.filter((f) => where.id.in.includes(f.id)));
  return { client: { dish: { findMany } } as unknown as ClienteDoBanco, findMany };
}

describe("resolverFichas", () => {
  test("custo de uma unidade de rendimento: R$ 9 de ingredientes para 12 porções = R$ 0,75", async () => {
    const { client } = banco([MASSA]);
    const r = await resolverFichas(client, ["massa"]);
    expect(r.get("massa")).toMatchObject({ yieldUnit: "UN", custoPorUnidade: 0.75, incompleta: false, motivo: null });
  });

  test("ficha dentro de ficha dentro de ficha: o custo sobe pelos níveis", async () => {
    const sobre: Linha = { id: "sobre", name: "Massa com molho", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN", items: [item(null, 2, "UN", "massa"), item(QUEIJO, 100, "G")] };
    const { client, findMany } = banco([MASSA, sobre]);
    const r = await resolverFichas(client, ["sobre"]);
    // 2 porções de massa (1,50) + 100 g de queijo (4,00).
    expect(r.get("sobre")?.custoPorUnidade).toBeCloseTo(5.5, 6);
    // Uma consulta por nível, não uma por ficha.
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  test("ingrediente sem custo deixa a ficha incompleta e sem custo (nunca um número parcial)", async () => {
    const sem: Linha = { ...MASSA, id: "sem", items: [item(FARINHA, 1000, "G"), item(produto("SAL", "KG", null), 20, "G")] };
    const { client } = banco([sem]);
    expect(await resolverFichas(client, ["sem"])).toEqual(new Map([["sem", expect.objectContaining({ custoPorUnidade: null, incompleta: true })]]));
  });

  test("a incompletude sobe: quem usa uma ficha incompleta também fica incompleto, com o motivo da de baixo", async () => {
    const sem: Linha = { ...MASSA, id: "sem", name: "Base", items: [item(FARINHA, 1000, "G"), item(produto("SAL", "KG", null), 20, "G")] };
    const prato: Linha = { id: "prato", name: "Prato", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN", items: [item(null, 1, "UN", "sem")] };
    const { client } = banco([sem, prato]);
    const r = await resolverFichas(client, ["prato"]);
    expect(r.get("prato")).toMatchObject({ custoPorUnidade: null, incompleta: true });
  });

  test("ciclo não trava: as duas ficham sem custo", async () => {
    const a: Linha = { id: "a", name: "A", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN", items: [item(FARINHA, 100, "G"), item(null, 1, "UN", "b")] };
    const b: Linha = { id: "b", name: "B", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN", items: [item(null, 1, "UN", "a")] };
    const { client } = banco([a, b]);
    const r = await resolverFichas(client, ["a"]);
    expect(r.get("a")?.custoPorUnidade).toBeNull();
    expect(r.get("a")?.incompleta).toBe(true);
  });

  test(`passa de ${MAX_NIVEIS} níveis: a ficha de baixo fica sem custo em vez de a conta ir longe demais`, async () => {
    const cadeia: Linha[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `f${n}`, name: `F${n}`, code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN",
      items: n === 5 ? [item(FARINHA, 100, "G")] : [item(null, 1, "UN", `f${n + 1}`)]
    }));
    const { client } = banco(cadeia);
    const r = await resolverFichas(client, ["f1"]);
    expect(r.get("f1")?.incompleta).toBe(true);
  });

  test("quantidade em g de uma ficha que rende em kg converte por física", async () => {
    const molho: Linha = { id: "molho", name: "Molho", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 2, yieldUnit: "KG", items: [item(QUEIJO, 1000, "G")] };
    const prato: Linha = { id: "prato", name: "Prato", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN", items: [item(null, 250, "G", "molho")] };
    const { client } = banco([molho, prato]);
    // O molho custa 40 por 2 kg = 20/kg; 250 g = 5.
    expect((await resolverFichas(client, ["prato"])).get("prato")?.custoPorUnidade).toBeCloseTo(5, 6);
  });

  test("só conta os itens do cardápio principal da ficha de baixo", async () => {
    const dois: Linha = { ...MASSA, id: "dois", items: [...MASSA.items, { ...item(QUEIJO, 5000, "G"), menu: "CARDAPIO" }] };
    const { client } = banco([dois]);
    expect((await resolverFichas(client, ["dois"])).get("dois")?.custoPorUnidade).toBe(0.75);
  });
});

describe("anexarFichas", () => {
  test("produto segue como veio; ficha de produção vira um 'produto' com a unidade e o custo dela", async () => {
    const { client } = banco([MASSA]);
    const [a, b] = await anexarFichas(client, [
      { id: "i1", componentDishId: null, product: FARINHA },
      { id: "i2", componentDishId: "massa", product: null }
    ]);
    expect(a.product).toBe(FARINHA);
    expect(b.product).toMatchObject({ name: "Nhoque - Massa", unit: "UN", ehFicha: true, conversions: [], inventoryStock: { averageCost: 0.75 } });
  });

  test("sem ficha de produção nos itens não consulta o banco", async () => {
    const { client, findMany } = banco([]);
    await anexarFichas(client, [{ componentDishId: null, product: FARINHA }]);
    expect(findMany).not.toHaveBeenCalled();
  });

  test("item sem produto e sem ficha é dado quebrado: avisa em vez de calcular errado", async () => {
    const { client } = banco([]);
    await expect(anexarFichas(client, [{ componentDishId: null, product: null }])).rejects.toThrow(/sem produto/);
  });
});

describe("carregarDetalhe com ficha de produção", () => {
  test("o ingrediente-ficha aparece com o nome, a unidade e o custo, e entra no custo do prato", async () => {
    const prato = {
      id: "prato", code: null, name: "Nhoque ao molho", menu: "DELIVERY", alsoMenu: null, categoryId: null, category: null, alsoCategory: null, listings: [],
      salePriceDefault: 20, yieldQty: 1, yieldUnit: "UN", portionWeightG: null, shelfLifeDays: null, notes: null, isActive: true, fichaDeBuffet: false, fichaPendente: false,
      createdAt: new Date(), updatedAt: new Date(),
      items: [
        { id: "i1", menu: "DELIVERY", productId: null, componentDishId: "massa", product: null, quantity: 1, unit: "UN", wasteFactor: 0, notes: null, sortOrder: 0 },
        { id: "i2", menu: "DELIVERY", productId: QUEIJO.id, componentDishId: null, product: QUEIJO, quantity: 30, unit: "G", wasteFactor: 0, notes: null, sortOrder: 1 }
      ]
    };
    const findMany = vi.fn(async () => [MASSA]);
    const client = { dish: { findUnique: vi.fn(async () => prato), findMany } } as unknown as ClienteDoBanco;

    const d = (await carregarDetalhe(client, "prato"))!;
    expect(d.items[0]).toMatchObject({ id: "i1", productId: null, componentDishId: "massa", productName: "Nhoque - Massa", productUnit: "UN", unit: "UN", unitCost: 0.75, itemCost: 0.75, issue: null, conversions: [] });
    expect(d.items[1]).toMatchObject({ componentDishId: null, itemCost: 1.2 });
    expect(d.custoPorcao).toBeCloseTo(1.95, 6);
    expect(d.custoIncompleto).toBe(false);
  });

  test("ficha de baixo incompleta: o prato fica incompleto e o item diz por quê", async () => {
    const incompleta: Linha = { ...MASSA, items: [item(FARINHA, 1000, "G"), item(produto("SAL", "KG", null), 20, "G")] };
    const prato = {
      id: "prato", code: null, name: "P", menu: "DELIVERY", alsoMenu: null, categoryId: null, category: null, alsoCategory: null, listings: [],
      salePriceDefault: null, yieldQty: 1, yieldUnit: "UN", portionWeightG: null, shelfLifeDays: null, notes: null, isActive: true, fichaDeBuffet: false, fichaPendente: false,
      createdAt: new Date(), updatedAt: new Date(),
      items: [{ id: "i1", menu: "DELIVERY", productId: null, componentDishId: "massa", product: null, quantity: 1, unit: "UN", wasteFactor: 0, notes: null, sortOrder: 0 }]
    };
    const client = { dish: { findUnique: vi.fn(async () => prato), findMany: vi.fn(async () => [incompleta]) } } as unknown as ClienteDoBanco;
    const d = (await carregarDetalhe(client, "prato"))!;
    expect(d.custoIncompleto).toBe(true);
    expect(d.items[0].issue).toMatch(/ficha de produção|Produto sem custo|sem custo/i);
    expect(d.items[0].itemCost).toBeNull();
  });
});

describe("primeiroProblemaDeFicha", () => {
  const cliente = (linhas: Array<{ id: string; name: string; yieldUnit: string; filhos?: string[]; vendido?: boolean }>) => ({
    dish: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => linhas.filter((l) => where.id.in.includes(l.id)).map((l) => ({ id: l.id, name: l.name, yieldUnit: l.yieldUnit, fichaDeProducao: !l.vendido, items: (l.filhos ?? []).map((f) => ({ componentDishId: f })) }))) }
  }) as unknown as ClienteDoBanco;

  test("sem ficha de produção nos itens não há o que conferir (nem consulta)", async () => {
    const c = cliente([]);
    expect(await primeiroProblemaDeFicha(c, "x", [{ productId: "p", unit: "G" }])).toBeNull();
  });

  test("a própria ficha como ingrediente", async () => {
    expect(await primeiroProblemaDeFicha(cliente([]), "a", [{ componentDishId: "a", unit: "UN" }])).toMatch(/a si mesma/);
  });

  test("ficha que não existe", async () => {
    expect(await primeiroProblemaDeFicha(cliente([]), "a", [{ componentDishId: "x", unit: "UN" }])).toMatch(/não encontrada/);
  });

  test("ciclo: a ficha escolhida já usa esta", async () => {
    const c = cliente([{ id: "massa", name: "Massa", yieldUnit: "UN", filhos: ["prato"] }, { id: "prato", name: "Prato", yieldUnit: "UN" }]);
    expect(await primeiroProblemaDeFicha(c, "prato", [{ componentDishId: "massa", unit: "UN" }])).toMatch(/já usa esta ficha/);
  });

  test("níveis demais", async () => {
    const c = cliente([
      { id: "n1", name: "N1", yieldUnit: "UN", filhos: ["n2"] }, { id: "n2", name: "N2", yieldUnit: "UN", filhos: ["n3"] },
      { id: "n3", name: "N3", yieldUnit: "UN", filhos: ["n4"] }, { id: "n4", name: "N4", yieldUnit: "UN" },
    ]);
    expect(await primeiroProblemaDeFicha(c, "novo", [{ componentDishId: "n1", unit: "UN" }])).toMatch(/até 3 níveis/);
  });

  test("a unidade tem que ser a de rendimento da ficha (ou converter por física)", async () => {
    const c = cliente([{ id: "massa", name: "Massa", yieldUnit: "UN" }, { id: "molho", name: "Molho", yieldUnit: "KG" }]);
    expect(await primeiroProblemaDeFicha(c, "p", [{ componentDishId: "massa", unit: "G" }])).toMatch(/rende em UN/);
    expect(await primeiroProblemaDeFicha(c, "p", [{ componentDishId: "molho", unit: "g" }])).toBeNull();
    expect(await primeiroProblemaDeFicha(c, "p", [{ componentDishId: "massa", unit: "und" }])).toBeNull();
  });

  test("ficha nova (sem id ainda) pode usar uma ficha com 2 níveis", async () => {
    const c = cliente([{ id: "n1", name: "N1", yieldUnit: "UN", filhos: ["n2"] }, { id: "n2", name: "N2", yieldUnit: "UN" }]);
    expect(await primeiroProblemaDeFicha(c, null, [{ componentDishId: "n1", unit: "UN" }])).toBeNull();
  });
});

describe("arredondarProporcao", () => {
  test("0,9999 e 2,0004 são 1 e 2 porções; 0,5 e 1,5 ficam como são", () => {
    expect([0.9999, 2.0004, 0.5, 1.5, 12.0001].map(arredondarProporcao)).toEqual([1, 2, 0.5, 1.5, 12]);
  });

  test("proporção quebrada vai a 3 casas", () => {
    expect(arredondarProporcao(0.333333)).toBe(0.333);
  });
});

describe("sugerirFichasDeProducao: ingredientes copiados da ficha de produção", () => {
  // O caso real: a massa rende 12 e o prato copiou tudo dividido por 12, com 4 casas.
  const massa = { id: "massa", name: "Nhoque - Massa", yieldQty: 12, yieldUnit: "UN", items: [
    { productId: "farinha", quantity: 1000, unit: "G" }, { productId: "ovos", quantity: 1.6, unit: "BDJ" }, { productId: "batata", quantity: 1000, unit: "G" }, { productId: "sal", quantity: 20, unit: "G" },
  ] };
  const prato = { id: "prato", items: [
    { id: "a", productId: "farinha", componentDishId: null, quantity: 83.3333, unit: "G" },
    { id: "b", productId: "ovos", componentDishId: null, quantity: 0.1333, unit: "BDJ" },
    { id: "c", productId: "batata", componentDishId: null, quantity: 83.3333, unit: "G" },
    { id: "d", productId: "sal", componentDishId: null, quantity: 1.6667, unit: "G" },
    { id: "e", productId: "creme", componentDishId: null, quantity: 150, unit: "G" },
    { id: "f", productId: "pote", componentDishId: null, quantity: 1, unit: "UN" },
  ] };

  test("acha a massa e diz quantas porções o prato usa (1)", () => {
    const [s] = sugerirFichasDeProducao(prato, [massa]);
    expect(s).toMatchObject({ componentDishId: "massa", name: "Nhoque - Massa", quantity: 1, unit: "UN" });
    expect(s.itemIds.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("proporção diferente de 1: o prato usa 2 porções da massa", () => {
    const dobro = { id: "p2", items: prato.items.map((i) => (["a", "b", "c", "d"].includes(i.id) ? { ...i, quantity: i.quantity * 2 } : i)) };
    expect(sugerirFichasDeProducao(dobro, [massa])[0].quantity).toBeCloseTo(2, 3);
  });

  test("proporções inconsistentes entre os ingredientes não são a mesma ficha", () => {
    const torta = { id: "p3", items: prato.items.map((i) => (i.id === "c" ? { ...i, quantity: 200 } : i)) };
    expect(sugerirFichasDeProducao(torta, [massa])).toEqual([]);
  });

  test("falta um ingrediente da ficha no prato: não sugere", () => {
    const semSal = { id: "p4", items: prato.items.filter((i) => i.id !== "d") };
    expect(sugerirFichasDeProducao(semSal, [massa])).toEqual([]);
  });

  test("unidade diferente do mesmo produto não conta como o mesmo ingrediente", () => {
    const emKg = { id: "p5", items: prato.items.map((i) => (i.id === "a" ? { ...i, quantity: 0.0833, unit: "KG" } : i)) };
    expect(sugerirFichasDeProducao(emKg, [massa])).toEqual([]);
  });

  test("ficha que cobriria o prato inteiro é cópia dele, não componente", () => {
    const copia = { id: "p6", items: prato.items.filter((i) => ["a", "b", "c", "d"].includes(i.id)) };
    expect(sugerirFichasDeProducao(copia, [massa])).toEqual([]);
  });

  test("não sugere a própria ficha nem ficha de um ingrediente só", () => {
    const um = { id: "um", name: "Um", yieldQty: 1, yieldUnit: "UN", items: [{ productId: "farinha", quantity: 83.3333, unit: "G" }] };
    expect(sugerirFichasDeProducao(prato, [um, { ...massa, id: "prato" }])).toEqual([]);
  });

  test("duas fichas que disputam os mesmos itens: fica a que cobre mais", () => {
    const parcial = { id: "parcial", name: "Parcial", yieldQty: 12, yieldUnit: "UN", items: massa.items.slice(0, 2) };
    const r = sugerirFichasDeProducao(prato, [parcial, massa]);
    expect(r.map((s) => s.componentDishId)).toEqual(["massa"]);
  });

  test("duas fichas diferentes que cobrem itens diferentes aparecem as duas", () => {
    const molho = { id: "molho", name: "Molho", yieldQty: 1, yieldUnit: "UN", items: [{ productId: "creme", quantity: 150, unit: "G" }, { productId: "pote", quantity: 1, unit: "UN" }] };
    const r = sugerirFichasDeProducao(prato, [massa, molho]);
    expect(r.map((s) => s.componentDishId)).toEqual(["massa", "molho"].sort((a, b) => (a === "massa" ? -1 : 1)));
  });
});

describe("limite de níveis de cima para baixo", () => {
  // B (ficha de produção) é usada pela ficha de produção A, que é usada pelo prato vendido P.
  const usos: Record<string, string[]> = { b: ["a"], a: ["p"], p: [] };
  const producao = new Set(["a", "b", "n1", "n2"]);
  const fichas = [
    { id: "n1", name: "N1", yieldUnit: "UN", filhos: ["n2"] }, { id: "n2", name: "N2", yieldUnit: "UN" },
  ];
  const clienteComUsos = () => ({
    dish: {
      findMany: vi.fn(async ({ where, select }: { where: { id: { in: string[] }; fichaDeProducao?: boolean }; select: Record<string, unknown> }) => {
        if (select.usadaComoIngrediente) return where.id.in.map((id) => ({ usadaComoIngrediente: (usos[id] ?? []).map((dishId) => ({ dishId })) }));
        if (where.fichaDeProducao) return where.id.in.filter((id) => producao.has(id)).map((id) => ({ id }));
        return fichas.filter((f) => where.id.in.includes(f.id)).map((f) => ({ id: f.id, name: f.name, yieldUnit: f.yieldUnit, fichaDeProducao: true, items: (f.filhos ?? []).map((c) => ({ componentDishId: c })) }));
      }),
    },
  }) as never;

  test("editar a ficha B, que já está dentro de A dentro de P, não aceita ficha com 2 níveis embaixo (A, B, N1, N2 = 4 > 3)", async () => {
    expect(await primeiroProblemaDeFicha(clienteComUsos(), "b", [{ componentDishId: "n1", unit: "UN" }], true)).toMatch(/até 3 níveis/);
  });

  test("com um nível só embaixo cabe (A, B, N2 = 3)", async () => {
    expect(await primeiroProblemaDeFicha(clienteComUsos(), "b", [{ componentDishId: "n2", unit: "UN" }], true)).toBeNull();
  });
});

describe("o limite de níveis não depende da ordem das consultas", () => {
  // X -> A -> B -> C: X tem 4 níveis (estoura), A tem 3 (cabe).
  const linha = (id: string, filho?: string): Linha => ({
    id, name: id.toUpperCase(), code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 1, yieldUnit: "UN",
    items: filho ? [item(null, 1, "UN", filho)] : [item(FARINHA, 100, "G")]
  });
  const cadeia = [linha("x", "a"), linha("a", "b"), linha("b", "c"), linha("c")];

  test("A tem custo e X não, consultando X antes de A, A antes de X ou só A", async () => {
    for (const ordem of [["x", "a"], ["a", "x"], ["a"]]) {
      const r = await resolverFichas(banco(cadeia).client, ordem);
      expect(r.get("a")?.custoPorUnidade).not.toBeNull();
      if (ordem.includes("x")) {
        expect(r.get("x")).toMatchObject({ incompleta: true, custoPorUnidade: null });
        expect(r.get("x")?.motivo).toMatch(/até 3 níveis/);
      }
    }
  });
});

describe("a ficha de produção conta como um nível dela mesma", () => {
  test("C usada por B, usada por A: acrescentar D embaixo de C faria 4 fichas e é recusado", async () => {
    const dados = [{ id: "d", name: "D", yieldUnit: "UN", fichaDeProducao: true, items: [] as Array<{ componentDishId: string }> }];
    const c = {
      dish: {
        findMany: vi.fn(async ({ where, select }: { where: { id: { in: string[] }; fichaDeProducao?: boolean }; select: Record<string, unknown> }) => {
          if (select.usadaComoIngrediente) return where.id.in.map((id) => ({ usadaComoIngrediente: id === "c" ? [{ dishId: "b" }] : id === "b" ? [{ dishId: "a" }] : [] }));
          if (where.fichaDeProducao) return where.id.in.map((id) => ({ id }));
          return dados.filter((l) => where.id.in.includes(l.id));
        }),
      },
    } as never;
    expect(await primeiroProblemaDeFicha(c, "c", [{ componentDishId: "d", unit: "UN" }], true)).toMatch(/até 3 níveis/);
  });

  test("ficha de produção nova, sem uso, com um nível embaixo: cabe (ela + 1 = 2)", async () => {
    const dados = [{ id: "d", name: "D", yieldUnit: "UN", fichaDeProducao: true, items: [] as Array<{ componentDishId: string }> }];
    const c = {
      dish: {
        findMany: vi.fn(async ({ where, select }: { where: { id: { in: string[] } }; select: Record<string, unknown> }) =>
          select.usadaComoIngrediente ? where.id.in.map(() => ({ usadaComoIngrediente: [] })) : dados.filter((l) => where.id.in.includes(l.id))),
      },
    } as never;
    expect(await primeiroProblemaDeFicha(c, null, [{ componentDishId: "d", unit: "UN" }], true)).toBeNull();
  });
});
