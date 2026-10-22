import { describe, expect, it } from "vitest";
import { chaveDaLoja, lojaDaDescricao, resumoDeReceita, type LinhaReceitaIfood } from "../ifood-receita.js";
import { somarResumos } from "../ifood-sem-dados.js";

const linha = (loja: string, over: Partial<LinhaReceitaIfood> = {}): LinhaReceitaIfood => ({
  date: new Date("2026-09-30T00:00:00.000Z"),
  description: `Delivery iFood - ${loja} (consolidado do mes)`,
  tickets: 10,
  grossAmount: 1000,
  platformFees: 400,
  netAmount: 600,
  ...over
});

const base = { year: 2026, month: 9, settlements: [] };

describe("chaveDaLoja / lojaDaDescricao", () => {
  it("ignora &, hífen, acento e espaço", () => {
    expect(chaveDaLoja("Pateo da Luz & Massas e Parmeggiana")).toBe(chaveDaLoja("Pateo da Luz Massas e Parmeggiana"));
    expect(chaveDaLoja("Peposo - Frei Caneca")).toBe(chaveDaLoja("Peposo Frei Caneca"));
  });

  it("só reconhece a linha consolidada do portal", () => {
    expect(lojaDaDescricao("Delivery iFood - Peposo - Frei Caneca (consolidado do mes)")).toBe("Peposo - Frei Caneca");
    expect(lojaDaDescricao("Delivery iFood - quarta-feira")).toBeNull();
    expect(lojaDaDescricao(null)).toBeNull();
  });
});

describe("resumoDeReceita", () => {
  it("monta bruto, líquido, dedução e pedidos da loja", () => {
    const r = resumoDeReceita({ ...base, storeId: "a", storeLabel: "Pateo da Luz Pizzaria", linhas: [linha("Pateo da Luz Pizzaria", { tickets: 10, grossAmount: 811.89, netAmount: 433.06 })] });
    expect(r).not.toBeNull();
    expect(r!.isMock).toBe(false);
    expect(r!.totals).toMatchObject({ orders: 10, grossAmount: 811.89, netAmount: 433.06, ifoodFeeAmount: 378.83 });
  });

  it("'Pateo da Luz' NÃO pega a linha da Pizzaria nem a da Massas (nome prefixo de outro)", () => {
    const linhas = [linha("Pateo da Luz", { grossAmount: 4386.4 }), linha("Pateo da Luz Pizzaria", { grossAmount: 811.89 }), linha("Pateo da Luz & Massas e Parmeggiana", { grossAmount: 1227.37 })];
    const r = resumoDeReceita({ ...base, storeId: "a", storeLabel: "Pateo da Luz", linhas });
    expect(r!.totals.grossAmount).toBe(4386.4);
  });

  it("devolve null quando a loja não foi importada no mês", () => {
    expect(resumoDeReceita({ ...base, storeId: "a", storeLabel: "Peposo Frei Caneca", linhas: [linha("Pateo da Luz")] })).toBeNull();
  });

  it("líquido negativo (Peposo) é preservado, sem arredondar para zero", () => {
    const r = resumoDeReceita({ ...base, storeId: "a", storeLabel: "Peposo Frei Caneca", linhas: [linha("Peposo - Frei Caneca", { grossAmount: 304.98, netAmount: -229.57, tickets: 6 })] });
    expect(r!.totals.netAmount).toBe(-229.57);
    expect(r!.totals.ifoodFeeAmount).toBe(534.55);
  });

  it("consolidado das 4 lojas soma o bruto e os pedidos de setembro", () => {
    const lojas: Array<[string, string, number, number, number]> = [
      ["Pateo da Luz", "Pateo da Luz", 4386.4, 2737.24, 65],
      ["Pateo da Luz Massas e Parmeggiana", "Pateo da Luz & Massas e Parmeggiana", 1227.37, 507.12, 22],
      ["Pateo da Luz Pizzaria", "Pateo da Luz Pizzaria", 811.89, 433.06, 10],
      ["Peposo Frei Caneca", "Peposo - Frei Caneca", 304.98, -229.57, 6]
    ];
    const todas = lojas.map(([, desc, g, n, t]) => linha(desc, { grossAmount: g, netAmount: n, tickets: t }));
    const resumos = lojas.map(([apelido], i) => resumoDeReceita({ ...base, storeId: String(i), storeLabel: apelido, linhas: todas })!);
    const total = somarResumos(resumos, 2026, 9);
    expect(total.totals.grossAmount).toBe(6730.64);
    expect(total.totals.netAmount).toBe(3447.85);
    expect(total.totals.orders).toBe(103);
    expect(total.isMock).toBe(false);
  });
});
