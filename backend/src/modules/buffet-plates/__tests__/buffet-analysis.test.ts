import { describe, expect, test } from "vitest";
import { analisarBuffet, type PdvDoDia, type PesagemDoDia } from "../buffet-analysis.js";

const prod = (date: string, itemId: string, netG: number): PesagemDoDia => ({ date, itemId, phase: "PRODUCAO", netG });
const sobra = (date: string, itemId: string, netG: number): PesagemDoDia => ({ date, itemId, phase: "SOBRA", netG });
const custos = (o: Record<string, number | null>) => new Map(Object.entries(o));

describe("análise do buffet — por dia", () => {
  const pesagens = [
    prod("2026-11-18", "arroz", 10000), prod("2026-11-18", "arroz", 2000), sobra("2026-11-18", "arroz", 3000),
    prod("2026-11-18", "feijao", 8000), sobra("2026-11-18", "feijao", 1000),
  ];
  const pdv: PdvDoDia[] = [{ date: "2026-11-18", people: 60, revenue: 5400 }];
  const r = analisarBuffet(pesagens, pdv, custos({ arroz: 5, feijao: 10 }));

  test("soma produção e reposição, abate a sobra e valoriza pelo custo por kg", () => {
    const d = r.days[0];
    expect(d).toMatchObject({ date: "2026-11-18", producedG: 20000, leftoverG: 4000, consumedG: 16000, itemsProduced: 2, itemsWithLeftover: 2 });
    // produzido: 12 kg × 5 + 8 kg × 10 = 140; sobra: 3 × 5 + 1 × 10 = 25; consumido: 115
    expect(d).toMatchObject({ producedCost: 140, leftoverCost: 25, consumedCost: 115, itemsWithCost: 2 });
  });

  test("por pessoa: gramas, custo, receita e margem", () => {
    expect(r.days[0]).toMatchObject({ people: 60, revenue: 5400, gPerPerson: 267, costPerPerson: 2.33, revenuePerPerson: 90, marginPerPerson: 87.67 });
  });

  test("dia sem dado do PDV não inventa pessoas nem margem", () => {
    const sem = analisarBuffet(pesagens, [], custos({ arroz: 5, feijao: 10 })).days[0];
    expect(sem).toMatchObject({ people: null, revenue: null, gPerPerson: null, costPerPerson: null, marginPerPerson: null });
    expect(sem.producedCost).toBe(140);
  });

  test("dia com 0 pessoas também não divide", () => {
    const zero = analisarBuffet(pesagens, [{ date: "2026-11-18", people: 0, revenue: 0 }], custos({ arroz: 5 })).days[0];
    expect(zero.costPerPerson).toBeNull();
    expect(zero.gPerPerson).toBeNull();
  });
});

describe("análise do buffet — regra da sobra pesada", () => {
  test("prato sem sobra pesada fica fora do consumo e da sobra do dia (não vira consumo total)", () => {
    const r = analisarBuffet([prod("d1", "a", 10000), sobra("d1", "a", 2000), prod("d1", "b", 5000)], [{ date: "d1", people: 10, revenue: 900 }], custos({}));
    expect(r.days[0]).toMatchObject({ producedG: 15000, leftoverG: 2000, consumedG: 8000, itemsWithLeftover: 1 });
  });

  test("sobra zero pesada (panela vazia) vale: consumiu tudo", () => {
    const r = analisarBuffet([prod("d1", "a", 10000), sobra("d1", "a", 0)], [], custos({}));
    expect(r.days[0]).toMatchObject({ leftoverG: 0, consumedG: 10000, itemsWithLeftover: 1 });
  });

  test("sobra maior que a produção não gera consumo negativo; sobra sem produção é ignorada", () => {
    const r = analisarBuffet([prod("d1", "a", 1000), sobra("d1", "a", 1500), sobra("d1", "fantasma", 900)], [], custos({}));
    expect(r.days[0].consumedG).toBe(0);
    expect(r.items.map((i) => i.itemId)).toEqual(["a"]);
  });
});

describe("análise do buffet — por prato", () => {
  const dias = ["d1", "d2", "d3"];
  const pdv: PdvDoDia[] = dias.map((date) => ({ date, people: 50, revenue: 4500 }));

  test("gramas por pessoa, sobra e custo por pessoa saem do consumo dos dias com sobra pesada", () => {
    const pesagens = dias.flatMap((d) => [prod(d, "a", 10000), sobra(d, "a", 2000)]);
    const [a] = analisarBuffet(pesagens, pdv, custos({ a: 8 })).items;
    expect(a).toMatchObject({ days: 3, daysWithLeftover: 3, producedG: 30000, leftoverG: 6000, consumedG: 24000, leftoverPct: 0.2, gPerPerson: 160 });
    expect(a).toMatchObject({ costPerKg: 8, leftoverCost: 48, consumedCost: 192, costPerPerson: 1.28, signals: [] });
  });

  test("sinais: sobra alta, pode faltar e poucos dias", () => {
    const alta = dias.flatMap((d) => [prod(d, "alta", 10000), sobra(d, "alta", 3000)]);
    const baixa = dias.flatMap((d) => [prod(d, "baixa", 10000), sobra(d, "baixa", 100)]);
    const poucos = [prod("d1", "novo", 5000), sobra("d1", "novo", 1000)];
    const por = Object.fromEntries(analisarBuffet([...alta, ...baixa, ...poucos], pdv, custos({})).items.map((i) => [i.itemId, i.signals]));
    expect(por.alta).toEqual(["SOBRA_ALTA"]);
    expect(por.baixa).toEqual(["PODE_FALTAR"]);
    expect(por.novo).toEqual(["POUCOS_DIAS"]);
  });

  test("prato sem custo conhecido não tem valores em R$", () => {
    const [a] = analisarBuffet(dias.flatMap((d) => [prod(d, "a", 10000), sobra(d, "a", 2000)]), pdv, custos({ a: null })).items;
    expect(a).toMatchObject({ costPerKg: null, leftoverCost: null, consumedCost: null, costPerPerson: null });
    expect(a.gPerPerson).toBe(160);
  });

  test("prato sem nenhuma sobra pesada não tem sobra% nem gramas por pessoa", () => {
    const [a] = analisarBuffet(dias.map((d) => prod(d, "a", 10000)), pdv, custos({ a: 8 })).items;
    expect(a).toMatchObject({ daysWithLeftover: 0, leftoverPct: null, gPerPerson: null, consumedCost: null });
    expect(a.signals).toEqual(["POUCOS_DIAS"]);
  });

  test("ordena pelo que mais se produz", () => {
    const r = analisarBuffet([prod("d1", "pouco", 1000), prod("d1", "muito", 9000)], [], custos({}));
    expect(r.items.map((i) => i.itemId)).toEqual(["muito", "pouco"]);
  });
});

describe("análise do buffet — resumo do período", () => {
  test("soma os dias e calcula custo, receita e margem por pessoa só nos dias com pessoas", () => {
    const pesagens = [prod("d1", "a", 10000), sobra("d1", "a", 2000), prod("d2", "a", 10000), sobra("d2", "a", 2000), prod("d3", "a", 10000), sobra("d3", "a", 0)];
    const pdv: PdvDoDia[] = [{ date: "d1", people: 40, revenue: 3600 }, { date: "d2", people: 60, revenue: 5400 }];
    const r = analisarBuffet(pesagens, pdv, custos({ a: 10 }));
    expect(r.summary).toMatchObject({ days: 3, daysWithPeople: 2, people: 100, producedG: 30000, leftoverG: 4000, consumedG: 26000 });
    // d3 sem PDV: entra na produção e no custo total, mas não nas contas por pessoa
    expect(r.summary).toMatchObject({ producedCost: 300, leftoverCost: 40, consumedCost: 260 });
    expect(r.summary).toMatchObject({ revenue: 9000, costPerPerson: 2, revenuePerPerson: 90, marginPerPerson: 88 });
    expect(r.summary.leftoverPct).toBeCloseTo(4000 / 30000, 4);
    expect(r.summary.gPerPerson).toBe(160);
  });

  test("sem nenhuma pesagem o resumo vem zerado e sem divisão", () => {
    const r = analisarBuffet([], [{ date: "d1", people: 10, revenue: 900 }], custos({}));
    expect(r.days).toEqual([]);
    expect(r.summary).toMatchObject({ days: 0, people: 0, leftoverPct: null, costPerPerson: null, marginPerPerson: null, producedCost: null });
  });
});

describe("análise do buffet — dia incompleto não gera conta por pessoa enganosa", () => {
  const pdv: PdvDoDia[] = [{ date: "d1", people: 100, revenue: 9000 }];

  test("com prato sem sobra pesada o dia não tem gramas por pessoa (consumo subestimado)", () => {
    const r = analisarBuffet([prod("d1", "a", 10000), sobra("d1", "a", 2000), prod("d1", "b", 5000)], pdv, custos({}));
    expect(r.days[0].gPerPerson).toBeNull();
    expect(r.summary.gPerPerson).toBeNull();
  });

  test("com prato sem custo o dia não tem custo nem margem por pessoa (a margem subiria sem motivo)", () => {
    const r = analisarBuffet([prod("d1", "a", 10000), prod("d1", "b", 5000)], pdv, custos({ a: 8, b: null }));
    expect(r.days[0]).toMatchObject({ itemsProduced: 2, itemsWithCost: 1, producedCost: 80, costPerPerson: null, marginPerPerson: null, revenuePerPerson: 90 });
    expect(r.summary).toMatchObject({ daysWithFullCost: 0, costPerPerson: null, marginPerPerson: null, revenuePerPerson: 90 });
  });

  test("o resumo mistura só os dias completos: custo e margem usam os mesmos dias", () => {
    const pesagens = [prod("d1", "a", 10000), prod("d2", "a", 10000), prod("d2", "b", 10000)];
    const dois: PdvDoDia[] = [{ date: "d1", people: 100, revenue: 9000 }, { date: "d2", people: 100, revenue: 18000 }];
    const r = analisarBuffet(pesagens, dois, custos({ a: 10, b: null }));
    // só d1 tem todos os pratos com custo: custo 100/100 = 1,00; receita 9000/100 = 90 → margem 89
    expect(r.summary).toMatchObject({ daysWithFullCost: 1, costPerPerson: 1, marginPerPerson: 89 });
  });

  test("dia com pessoas e nenhum prato com custo não entra no denominador do custo", () => {
    const pesagens = [prod("d1", "a", 10000), prod("d2", "b", 10000)];
    const dois: PdvDoDia[] = [{ date: "d1", people: 100, revenue: 9000 }, { date: "d2", people: 100, revenue: 9000 }];
    const r = analisarBuffet(pesagens, dois, custos({ a: 10, b: null }));
    expect(r.summary).toMatchObject({ daysWithFullCost: 1, costPerPerson: 1 });
  });
});

describe("análise do buffet — sobra acima do produzido e dias por pessoa", () => {
  test("a sobra é limitada ao produzido: sobra% não passa de 100% e produzido = sobra + consumido", () => {
    const r = analisarBuffet([prod("d1", "a", 1000), sobra("d1", "a", 1500)], [], custos({}));
    expect(r.days[0]).toMatchObject({ leftoverG: 1000, consumedG: 0 });
    expect(r.items[0]).toMatchObject({ leftoverG: 1000, leftoverPct: 1 });
  });

  test("daysForPerPerson conta só dias com sobra pesada E pessoas no PDV", () => {
    const pesagens = ["d1", "d2", "d3"].flatMap((d) => [prod(d, "a", 10000), sobra(d, "a", 1000)]);
    const [a] = analisarBuffet(pesagens, [{ date: "d1", people: 50, revenue: 4500 }], custos({})).items;
    expect(a).toMatchObject({ daysWithLeftover: 3, daysForPerPerson: 1 });
  });

  test("lastDayItemIds traz os pratos do dia pesado mais recente", () => {
    const r = analisarBuffet([prod("d1", "velho", 1000), prod("d2", "a", 1000), prod("d2", "b", 1000)], [], custos({}));
    expect(r.lastDayItemIds.sort()).toEqual(["a", "b"]);
    expect(analisarBuffet([], [], custos({})).lastDayItemIds).toEqual([]);
  });
});

