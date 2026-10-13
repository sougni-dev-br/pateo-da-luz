import { describe, expect, test } from "vitest";
import { analisarDesperdicio, diasEntre, periodoAnterior, type EntradaAnalisada } from "../waste-analise.js";

// Período de 7 dias (qua 2026-10-07 a ter 2026-10-13); o anterior é 30/09 a 06/10.
const FROM = "2026-10-07";
const TO = "2026-10-13";

function entrada(parcial: Partial<EntradaAnalisada> & { dia: string }): EntradaAnalisada {
  return {
    itemKey: "p1",
    itemName: "Tomate",
    sector: "Hortifruti",
    reason: "SPOILED",
    totalCost: 10,
    quantity: 1,
    unit: "KG",
    registeredById: "u1",
    createdAt: new Date(`${parcial.dia}T18:00:00.000Z`),
    hasPhoto: false,
    ...parcial,
  };
}

const base = { from: FROM, to: TO, anterior: [] as EntradaAnalisada[], faturamento: [], comCusto: true, nomesDasPessoas: new Map([["u1", "Ana"], ["u2", "Beto"]]) };

describe("período", () => {
  test("conta os dias inclusive e acha o período anterior do mesmo tamanho", () => {
    expect(diasEntre(FROM, TO)).toBe(7);
    expect(periodoAnterior(FROM, TO)).toEqual({ from: "2026-09-30", to: "2026-10-06" });
  });

  test("a série diária cobre todos os dias, com zero onde nada foi lançado", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-09" })] });
    expect(r.porDia).toHaveLength(7);
    expect(r.porDia.find((d) => d.dia === "2026-10-09")).toMatchObject({ lancamentos: 1, valor: 10 });
    expect(r.porDia.find((d) => d.dia === "2026-10-10")).toMatchObject({ lancamentos: 0, valor: 0 });
  });

  test("dia da semana: cada dia ocorre uma vez em 7 dias e soma o que foi lançado nele", () => {
    // 2026-10-09 é sexta.
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-09" }), entrada({ dia: "2026-10-09", totalCost: 5 })] });
    const sexta = r.porDiaDaSemana.find((s) => s.nome === "Sexta");
    expect(sexta).toMatchObject({ lancamentos: 2, valor: 15, ocorrencias: 1 });
    expect(r.porDiaDaSemana.reduce((s, x) => s + x.ocorrencias, 0)).toBe(7);
  });
});

describe("totais e comparação com o período anterior", () => {
  test("soma o valor e conta o que ficou sem custo", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM }), entrada({ dia: FROM, totalCost: null })] });
    expect(r.total).toEqual({ lancamentos: 2, valor: 10, semCusto: 1 });
  });

  test("traz o total e o grupo do período anterior para a tela calcular a variação", () => {
    const r = analisarDesperdicio({
      ...base,
      atual: [entrada({ dia: FROM, totalCost: 30 })],
      anterior: [entrada({ dia: "2026-10-01", totalCost: 20 }), entrada({ dia: "2026-10-02", totalCost: 20 })],
    });
    expect(r.anterior).toMatchObject({ lancamentos: 2, valor: 40 });
    expect(r.porMotivo[0]).toMatchObject({ chave: "SPOILED", valor: 30, anteriorValor: 40, anteriorLancamentos: 2 });
  });

  test("grupo que não existia antes volta com anterior zerado", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM, reason: "EXPIRED" })], anterior: [entrada({ dia: "2026-10-01" })] });
    expect(r.porMotivo[0]).toMatchObject({ chave: "EXPIRED", anteriorLancamentos: 0, anteriorValor: 0 });
  });
});

describe("itens", () => {
  test("ordena por valor e diz em quantos dias e por qual motivo o item perde", () => {
    const r = analisarDesperdicio({
      ...base,
      atual: [
        entrada({ dia: "2026-10-07", itemKey: "a", itemName: "Salmão", totalCost: 100, reason: "EXPIRED" }),
        entrada({ dia: "2026-10-08", itemKey: "b", itemName: "Alface", totalCost: 5, reason: "SPOILED" }),
        entrada({ dia: "2026-10-09", itemKey: "b", itemName: "Alface", totalCost: 5, reason: "SPOILED" }),
        entrada({ dia: "2026-10-09", itemKey: "b", itemName: "Alface", totalCost: 5, reason: "PREPARATION_ERROR" }),
      ],
    });
    expect(r.porProduto.map((p) => p.nome)).toEqual(["Salmão", "Alface"]);
    expect(r.porProduto[1]).toMatchObject({ dias: 2, lancamentos: 3, quantidade: 3, unidade: "KG", motivoPrincipal: "SPOILED", motivoPrincipalRotulo: "Estragado" });
  });

  test("quantidade some quando o item aparece em duas unidades (somar kg com UN não faz sentido)", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM, unit: "KG" }), entrada({ dia: FROM, unit: "UN" })] });
    expect(r.porProduto[0]).toMatchObject({ quantidade: null, unidade: null });
  });

  test("reincidente é o item perdido em 3 ou mais dias diferentes, não o de um dia só", () => {
    const umDiaSo = Array.from({ length: 5 }, () => entrada({ dia: FROM, itemKey: "x", itemName: "Evento" }));
    const recorrente = ["2026-10-07", "2026-10-09", "2026-10-12"].map((dia) => entrada({ dia, itemKey: "y", itemName: "Pão", totalCost: 2 }));
    const r = analisarDesperdicio({ ...base, atual: [...umDiaSo, ...recorrente] });
    expect(r.reincidentes.map((p) => p.nome)).toEqual(["Pão"]);
  });

  test("itens que fazem 80% do valor: poucos itens concentram a perda", () => {
    const r = analisarDesperdicio({
      ...base,
      atual: [
        entrada({ dia: FROM, itemKey: "a", itemName: "A", totalCost: 80 }),
        entrada({ dia: FROM, itemKey: "b", itemName: "B", totalCost: 10 }),
        entrada({ dia: FROM, itemKey: "c", itemName: "C", totalCost: 10 }),
      ],
    });
    expect(r.itensPara80).toBe(1);
    expect(r.produtosTotal).toBe(3);
  });

  test("corta a lista nos 15 maiores mas informa o total de itens", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => entrada({ dia: FROM, itemKey: `i${i}`, itemName: `Item ${i}`, totalCost: i + 1 }));
    const r = analisarDesperdicio({ ...base, atual: muitos });
    expect(r.porProduto).toHaveLength(15);
    expect(r.produtosTotal).toBe(20);
  });
});

describe("taxa de perda sobre o comprado", () => {
  test("perdido ÷ comprado no período, na mesma unidade", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM, quantity: 2 }), entrada({ dia: FROM, quantity: 3 })], comprados: new Map([["p1", 50]]) });
    expect(r.porProduto[0]).toMatchObject({ quantidade: 5, comprado: 50, taxaDePerda: 10 });
  });

  test("sem compra no período a taxa fica nula (não vira infinito nem zero)", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM })], comprados: new Map() });
    expect(r.porProduto[0]).toMatchObject({ comprado: null, taxaDePerda: null });
  });

  test("item em duas unidades não tem taxa: não dá para dividir kg por UN", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM, unit: "KG" }), entrada({ dia: FROM, unit: "UN" })], comprados: new Map([["p1", 50]]) });
    expect(r.porProduto[0]).toMatchObject({ comprado: null, taxaDePerda: null });
  });

  test("sem permissão de custo a quantidade comprada não sai", () => {
    const r = analisarDesperdicio({ ...base, comCusto: false, atual: [entrada({ dia: FROM })], comprados: new Map([["p1", 50]]) });
    expect(r.porProduto[0]).toMatchObject({ comprado: null, taxaDePerda: null });
  });
});

describe("faturamento", () => {
  const faturamento = [
    { dia: "2026-10-08", liquido: 1000, pessoas: 50 },
    { dia: "2026-10-09", liquido: 3000, pessoas: 150 },
    { dia: "2026-10-01", liquido: 2000, pessoas: 80 },
  ];

  test("percentual do faturamento líquido do período e valor por pessoa atendida", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-08", totalCost: 80 })], faturamento });
    expect(r.faturamento).toMatchObject({ liquido: 4000, diasComVenda: 2, pessoas: 200, percentual: 2, porPessoa: 0.4, anteriorLiquido: 2000 });
  });

  test("percentual do período anterior só usa o faturamento dele", () => {
    const r = analisarDesperdicio({ ...base, atual: [], anterior: [entrada({ dia: "2026-10-01", totalCost: 100 })], faturamento });
    expect(r.faturamento?.percentualAnterior).toBe(5);
  });

  test("sem perda ou sem venda o percentual fica nulo, não zero", () => {
    expect(analisarDesperdicio({ ...base, atual: [], faturamento }).faturamento?.percentual).toBeNull();
    expect(analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM })], faturamento: [] }).faturamento?.percentual).toBeNull();
  });

  test("hoje ainda pode receber lançamentos: não conta como dia sem registro", () => {
    const comHoje = [{ dia: "2026-10-08", liquido: 1000, pessoas: 50 }, { dia: "2026-10-13", liquido: 2000, pessoas: 80 }];
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-08" })], faturamento: comHoje, hoje: "2026-10-13" });
    expect(r.qualidade).toMatchObject({ diasComVenda: 1, diasSemRegistro: 0 });
  });

  test("dia com venda e nenhum registro vira 'dia sem registro': pode ser perda não lançada", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-08" })], faturamento });
    expect(r.qualidade).toMatchObject({ diasComVenda: 2, diasSemRegistro: 1 });
  });
});

describe("qualidade do registro", () => {
  test("conta motivo 'Outro', lançamentos de memória (digitados 2+ dias depois) e maiores sem foto", () => {
    const r = analisarDesperdicio({
      ...base,
      atual: [
        entrada({ dia: "2026-10-07", reason: "OTHER", createdAt: new Date("2026-10-07T20:00:00.000Z") }),
        entrada({ dia: "2026-10-07", totalCost: 200, createdAt: new Date("2026-10-10T15:00:00.000Z") }),
        entrada({ dia: "2026-10-08", totalCost: 50, hasPhoto: true }),
      ],
    });
    expect(r.qualidade).toMatchObject({ motivoOutro: 1, retroativos: 1, semFotoNosMaiores: 2 });
  });

  test("lançamento do dia seguinte (virada do expediente) não é retroativo", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: "2026-10-07", createdAt: new Date("2026-10-08T14:00:00.000Z") })] });
    expect(r.qualidade.retroativos).toBe(0);
  });

  test("quem lançou: ordena por quantidade e resolve o nome", () => {
    const r = analisarDesperdicio({ ...base, atual: [entrada({ dia: FROM }), entrada({ dia: FROM, registeredById: "u2" }), entrada({ dia: FROM, registeredById: "u2" })] });
    expect(r.porPessoa).toEqual([{ id: "u2", nome: "Beto", lancamentos: 2 }, { id: "u1", nome: "Ana", lancamentos: 1 }]);
  });
});

describe("sem permissão de custo", () => {
  test("nenhum valor, nem faturamento: só contagens", () => {
    const r = analisarDesperdicio({ ...base, comCusto: false, atual: [entrada({ dia: FROM, totalCost: 99 })], anterior: [entrada({ dia: "2026-10-01", totalCost: 99 })], faturamento: [{ dia: FROM, liquido: 999, pessoas: 9 }] });
    expect(r.total).toEqual({ lancamentos: 1, valor: null, semCusto: 0 });
    expect(r.faturamento).toBeNull();
    expect(r.qualidade).toMatchObject({ semCusto: 0, semFotoNosMaiores: 0, diasSemRegistro: null, diasComVenda: null });
    // Nenhum campo monetário, em nenhum lugar da resposta, pode carregar número.
    const monetarios = new Set(["valor", "anteriorValor", "comprado", "taxaDePerda", "liquido"]);
    const vazados: string[] = [];
    const percorrer = (no: unknown, caminho: string) => {
      if (Array.isArray(no)) no.forEach((x, i) => percorrer(x, `${caminho}[${i}]`));
      else if (no && typeof no === "object") {
        for (const [k, v] of Object.entries(no)) {
          if (monetarios.has(k) && v !== null) vazados.push(`${caminho}.${k}`);
          percorrer(v, `${caminho}.${k}`);
        }
      }
    };
    percorrer(r, "analise");
    expect(vazados).toEqual([]);
    expect(r.porProduto[0].valor).toBeNull();
    expect(r.itensPara80).toBeNull();
  });
});
