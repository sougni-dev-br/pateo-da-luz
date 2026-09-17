import { describe, expect, test } from "vitest";
import { podeAprovar, verificarFechamento, type EntradaDaVerificacao } from "../verificacao-fechamento.js";
import type { EloDaCadeia } from "../cadeia-inventario.js";

const CADEIA_OK: EloDaCadeia[] = [
  { competenceYear: 2026, competenceMonth: 6, inicial: 81137.68, final: 95251.09 },
  { competenceYear: 2026, competenceMonth: 7, inicial: 95251.09, final: 41799.29 },
  { competenceYear: 2026, competenceMonth: 8, inicial: 41799.29, final: 56378.23 }
];

function entrada(over: Partial<EntradaDaVerificacao> = {}): EntradaDaVerificacao {
  return {
    competenceYear: 2026,
    competenceMonth: 8,
    itens: [{ productId: "p1", productName: "SALMAO", unit: "KG", quantity: 10, unitCost: 41.45 }],
    totalValue: 56378.23,
    historicoDeCusto: [
      { productId: "p1", competenceMonth: 6, unitCost: 40 },
      { productId: "p1", competenceMonth: 7, unitCost: 42 }
    ],
    totaisAnteriores: [95251.09, 41799.29, 81137.68],
    cadeia: CADEIA_OK,
    ...over
  };
}

describe("inventario saudavel", () => {
  test("nao produz achado nenhum", () => {
    expect(verificarFechamento(entrada())).toEqual([]);
    expect(podeAprovar([])).toBe(true);
  });
});

describe("CADEIA_QUEBRADA", () => {
  test("mes sem inicial bloqueia, com o valor que deveria ter", () => {
    const achados = verificarFechamento(entrada({
      competenceMonth: 7,
      cadeia: [
        { competenceYear: 2026, competenceMonth: 6, inicial: 81137.68, final: 115291.14 },
        { competenceYear: 2026, competenceMonth: 7, inicial: null, final: 49888.87 }
      ]
    }));
    const c = achados.find((a) => a.codigo === "CADEIA_QUEBRADA")!;
    expect(c.severidade).toBe("BLOQUEIO");
    expect(c.exemplos[0].numero).toMatch(/115\.291,14/);
    expect(podeAprovar(achados)).toBe(false);
  });

  test("quebra em mes POSTERIOR ao que se fecha nao entra", () => {
    // Fechar agosto nao pode ser travado por setembro ainda nao ter inicial.
    const achados = verificarFechamento(entrada({
      competenceMonth: 8,
      cadeia: [...CADEIA_OK, { competenceYear: 2026, competenceMonth: 9, inicial: null, final: null }]
    }));
    expect(achados.find((a) => a.codigo === "CADEIA_QUEBRADA")).toBeUndefined();
  });

  test("inicial que nao bate com o final anterior tambem bloqueia", () => {
    const achados = verificarFechamento(entrada({
      cadeia: [
        { competenceYear: 2026, competenceMonth: 7, inicial: 95251.09, final: 41799.29 },
        { competenceYear: 2026, competenceMonth: 8, inicial: 30000, final: 56378.23 }
      ]
    }));
    expect(achados.find((a) => a.codigo === "CADEIA_QUEBRADA")?.severidade).toBe("BLOQUEIO");
  });
});

describe("ITEM_SEM_CUSTO", () => {
  test("item com saldo e custo nulo aparece, ordenado por quantidade", () => {
    const achados = verificarFechamento(entrada({
      itens: [
        { productId: "p1", productName: "SALMAO", unit: "KG", quantity: 10, unitCost: 41.45 },
        { productId: "p2", productName: "CAIXA DE PIZZA BROTO", unit: "UN", quantity: 400, unitCost: null },
        { productId: "p3", productName: "VINHO SAINT FELICIEN", unit: "UN", quantity: 8, unitCost: 0 }
      ]
    }));
    const a = achados.find((x) => x.codigo === "ITEM_SEM_CUSTO")!;
    expect(a.severidade).toBe("ALERTA");
    expect(a.titulo).toMatch(/2 itens/);
    expect(a.exemplos[0].produto).toBe("CAIXA DE PIZZA BROTO");
  });

  test("item zerado SEM saldo nao e problema", () => {
    // Contou zero: nao existe no estoque, nao precisa de custo.
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "p9", productName: "SUMIU", unit: "UN", quantity: 0, unitCost: null }]
    }));
    expect(achados.find((a) => a.codigo === "ITEM_SEM_CUSTO")).toBeUndefined();
  });

  test("alerta sozinho nao impede aprovar", () => {
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "p2", productName: "X", unit: "UN", quantity: 5, unitCost: null }]
    }));
    expect(podeAprovar(achados)).toBe(true);
  });
});

describe("CUSTO_FORA_DA_SERIE", () => {
  test("pega o SACO AMOSTRA: custo da embalagem aplicado a cada unidade", () => {
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "s", productName: "SACO AMOSTRA TARJA 12X30 C800", unit: "UN", quantity: 720, unitCost: 113.16 }],
      historicoDeCusto: [
        { productId: "s", competenceMonth: 5, unitCost: 0.1095 },
        { productId: "s", competenceMonth: 6, unitCost: 0.1095 }
      ]
    }));
    const a = achados.find((x) => x.codigo === "CUSTO_FORA_DA_SERIE")!;
    expect(a.exemplos[0].produto).toMatch(/SACO AMOSTRA/);
    expect(a.exemplos[0].numero).toMatch(/1033x/);
  });

  test("pega tambem o sentido inverso — custo unitario onde a serie e de embalagem", () => {
    // Foi o caso do snapshot de maio: R$ 0,0432 onde os outros meses tinham R$ 42.
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "e", productName: "ETIQUETA LACRE C/1000", unit: "UN", quantity: 10, unitCost: 0.0432 }],
      historicoDeCusto: [
        { productId: "e", competenceMonth: 6, unitCost: 42 },
        { productId: "e", competenceMonth: 7, unitCost: 42 }
      ]
    }));
    expect(achados.find((x) => x.codigo === "CUSTO_FORA_DA_SERIE")).toBeDefined();
  });

  test("variacao de hortifruti nao vira alerta", () => {
    // Inhame de R$ 3 a R$ 14,80/kg entre safra e entressafra e real.
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "i", productName: "INHAME", unit: "KG", quantity: 5, unitCost: 14.8 }],
      historicoDeCusto: [
        { productId: "i", competenceMonth: 6, unitCost: 3 },
        { productId: "i", competenceMonth: 7, unitCost: 3.5 }
      ]
    }));
    expect(achados.find((x) => x.codigo === "CUSTO_FORA_DA_SERIE")).toBeUndefined();
  });

  test("produto sem historico nao gera achado", () => {
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "novo", productName: "PRODUTO NOVO", unit: "UN", quantity: 1, unitCost: 999 }],
      historicoDeCusto: []
    }));
    expect(achados.find((x) => x.codigo === "CUSTO_FORA_DA_SERIE")).toBeUndefined();
  });

  test("o proprio mes nao entra na referencia", () => {
    // Comparar o item consigo mesmo daria fator 1 e esconderia tudo.
    const achados = verificarFechamento(entrada({
      itens: [{ productId: "s", productName: "SACO", unit: "UN", quantity: 720, unitCost: 113.16 }],
      historicoDeCusto: [
        { productId: "s", competenceMonth: 8, unitCost: 113.16 },
        { productId: "s", competenceMonth: 6, unitCost: 0.1095 }
      ]
    }));
    expect(achados.find((x) => x.codigo === "CUSTO_FORA_DA_SERIE")).toBeDefined();
  });
});

describe("ITEM_CONCENTRADO", () => {
  test("pega o agosto inflado: um item era 59% do inventario", () => {
    // Este e o teste que realmente cobre o caso real. Comparar o TOTAL nao pega:
    // R$ 137 mil contra mediana de R$ 81 mil da 1,7x, abaixo de qualquer limiar
    // que nao acusasse tambem a queda legitima de julho.
    const achados = verificarFechamento(entrada({
      totalValue: 137751.59,
      itens: [
        { productId: "s", productName: "SACO AMOSTRA TARJA 12X30 C800", unit: "UN", quantity: 720, unitCost: 113.16 },
        { productId: "p1", productName: "SALMAO", unit: "KG", quantity: 156, unitCost: 41.45 }
      ]
    }));
    const a = achados.find((x) => x.codigo === "ITEM_CONCENTRADO")!;
    expect(a.severidade).toBe("ALERTA");
    expect(a.exemplos[0].produto).toMatch(/SACO AMOSTRA/);
    expect(a.exemplos[0].numero).toMatch(/59% do inventário/);
  });

  test("inventario bem distribuido nao alerta", () => {
    // Em agosto corrigido o maior item era o salmao, com 11%.
    expect(verificarFechamento(entrada({
      totalValue: 56378.23,
      itens: [{ productId: "p1", productName: "SALMAO", unit: "KG", quantity: 156, unitCost: 41.45 }]
    })).find((x) => x.codigo === "ITEM_CONCENTRADO")).toBeUndefined();
  });

  test("item sem custo nao entra na concentracao", () => {
    expect(verificarFechamento(entrada({
      totalValue: 1000,
      itens: [{ productId: "x", productName: "SEM CUSTO", unit: "UN", quantity: 9999, unitCost: null }]
    })).find((x) => x.codigo === "ITEM_CONCENTRADO")).toBeUndefined();
  });
});

describe("TOTAL_FORA_DA_SERIE", () => {
  test("erro de ordem de grandeza e pego", () => {
    const achados = verificarFechamento(entrada({ totalValue: 900000 }));
    const a = achados.find((x) => x.codigo === "TOTAL_FORA_DA_SERIE")!;
    expect(a.severidade).toBe("ALERTA");
    expect(a.exemplos[0].numero).toMatch(/900\.000,00/);
  });

  test("NAO pega o agosto inflado — a serie e volatil demais", () => {
    // Documenta a limitacao de proposito: quem cobre este caso e ITEM_CONCENTRADO.
    expect(verificarFechamento(entrada({ totalValue: 137751.59 }))
      .find((x) => x.codigo === "TOTAL_FORA_DA_SERIE")).toBeUndefined();
  });

  test("oscilacao normal da serie nao alerta", () => {
    expect(verificarFechamento(entrada({ totalValue: 56378.23 }))
      .find((x) => x.codigo === "TOTAL_FORA_DA_SERIE")).toBeUndefined();
  });

  test("com menos de tres meses nao ha serie para comparar", () => {
    // Dois pontos nao formam serie: alertar seria chutar.
    expect(verificarFechamento(entrada({ totalValue: 500000, totaisAnteriores: [95251.09, 41799.29] }))
      .find((x) => x.codigo === "TOTAL_FORA_DA_SERIE")).toBeUndefined();
  });

  test("queda de ordem de grandeza tambem alerta", () => {
    expect(verificarFechamento(entrada({ totalValue: 5000 }))
      .find((x) => x.codigo === "TOTAL_FORA_DA_SERIE")).toBeDefined();
  });
});

describe("podeAprovar", () => {
  test("so bloqueio impede", () => {
    expect(podeAprovar([{ codigo: "ITEM_SEM_CUSTO", severidade: "ALERTA", titulo: "", detalhe: "", exemplos: [] }])).toBe(true);
    expect(podeAprovar([{ codigo: "CADEIA_QUEBRADA", severidade: "BLOQUEIO", titulo: "", detalhe: "", exemplos: [] }])).toBe(false);
  });
});

describe("o inventario de agosto como estava — todos os achados juntos", () => {
  test("cadeia quebrada, itens sem custo, custo fora da serie e total fora da serie", () => {
    const achados = verificarFechamento({
      competenceYear: 2026,
      competenceMonth: 8,
      totalValue: 137751.59,
      itens: [
        { productId: "s", productName: "SACO AMOSTRA TARJA 12X30 C800", unit: "UN", quantity: 720, unitCost: 113.16 },
        { productId: "v", productName: "VINHO SAINT FELICIEN", unit: "UN", quantity: 8, unitCost: null },
        { productId: "p1", productName: "SALMAO", unit: "KG", quantity: 156, unitCost: 41.45 }
      ],
      historicoDeCusto: [
        { productId: "s", competenceMonth: 5, unitCost: 0.1095 },
        { productId: "s", competenceMonth: 6, unitCost: 0.1095 },
        { productId: "p1", competenceMonth: 6, unitCost: 40 },
        { productId: "p1", competenceMonth: 7, unitCost: 42 }
      ],
      totaisAnteriores: [73682.14, 81137.68, 95251.09, 41799.29],
      cadeia: [
        { competenceYear: 2026, competenceMonth: 7, inicial: null, final: 41799.29 },
        { competenceYear: 2026, competenceMonth: 8, inicial: null, final: 137751.59 }
      ]
    });
    expect(achados.map((a) => a.codigo).sort()).toEqual(
      ["CADEIA_QUEBRADA", "CUSTO_FORA_DA_SERIE", "ITEM_CONCENTRADO", "ITEM_SEM_CUSTO"]);
    expect(podeAprovar(achados)).toBe(false);
  });
});
