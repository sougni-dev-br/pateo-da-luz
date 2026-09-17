import { describe, expect, test } from "vitest";
import {
  classificarPendencias,
  mesTerminou,
  progressoDoMes,
  resumirFechamento,
  type PendenciaDoFechamento
} from "../fechamento-pendencias";

// As pendências reais que o backend emite para junho/2026.
const PENDENCIAS: PendenciaDoFechamento[] = [
  { key: "supplier:abc", label: "Fornecedor: CONDOMINIO DO SHOPPING" },
  { key: "block:taxes", label: "Impostos: nenhum lancamento registrado" },
  { key: "block:finalInventory", label: "Inventario final do mes ausente" },
  { key: "block:revenue", label: "Faturamento salao com apenas 10 dias (esperado >= 25)" },
  { key: "block:inventoryItemsWithoutCost", label: "3 itens de inventario sem custo" }
];

const FIM = "2026-06-30";
const DIA_10 = new Date(2026, 5, 10);
const DIA_30 = new Date(2026, 5, 30);
const JULHO = new Date(2026, 6, 5);

describe("mesTerminou", () => {
  test("no meio do mês, não terminou", () => {
    expect(mesTerminou(FIM, DIA_10)).toBe(false);
  });

  test("no próprio último dia, conta como terminado", () => {
    // Fechar no dia 30 é o caso normal: exigir o dia 1º do mês seguinte faria a
    // tela mudar de comportamento justamente no dia em que se fecha.
    expect(mesTerminou(FIM, DIA_30)).toBe(true);
  });

  test("depois do mês, terminado", () => {
    expect(mesTerminou(FIM, JULHO)).toBe(true);
  });

  test("a hora do dia não muda a resposta", () => {
    expect(mesTerminou(FIM, new Date(2026, 5, 30, 1, 0))).toBe(true);
    expect(mesTerminou(FIM, new Date(2026, 5, 30, 23, 59))).toBe(true);
    expect(mesTerminou(FIM, new Date(2026, 5, 29, 23, 59))).toBe(false);
  });

  test("data inválida não quebra", () => {
    expect(mesTerminou("", DIA_10)).toBe(false);
    expect(mesTerminou("lixo", DIA_10)).toBe(false);
  });
});

describe("classificarPendencias — durante o mês", () => {
  const classificadas = classificarPendencias(PENDENCIAS, FIM, DIA_10);
  const natureza = (key: string) => classificadas.find((p) => p.key === key)?.natureza;

  test("imposto, inventário final e fornecedor mensal ficam aguardando", () => {
    expect(natureza("block:taxes")).toBe("AGUARDANDO");
    expect(natureza("block:finalInventory")).toBe("AGUARDANDO");
    expect(natureza("supplier:abc")).toBe("AGUARDANDO");
  });

  test("faturamento com poucos dias no dia 10 é esperado, não falha", () => {
    expect(natureza("block:revenue")).toBe("AGUARDANDO");
  });

  test("item de inventário sem custo é erro em qualquer dia", () => {
    // Não depende do calendário: o que foi lançado já está errado.
    expect(natureza("block:inventoryItemsWithoutCost")).toBe("ATENCAO");
  });

  test("qualquer fornecedor entra pelo prefixo", () => {
    const [p] = classificarPendencias([{ key: "supplier:xyz-123", label: "x" }], FIM, DIA_10);
    expect(p.natureza).toBe("AGUARDANDO");
  });
});

describe("classificarPendencias — depois do mês", () => {
  test("o que era espera vira atenção sozinho", () => {
    // A mesma pendência muda de natureza quando o mês acaba, sem ninguém
    // reclassificar nada.
    const classificadas = classificarPendencias(PENDENCIAS, FIM, JULHO);
    expect(classificadas.every((p) => p.natureza === "ATENCAO")).toBe(true);
  });

  test("no último dia do mês já cobra tudo", () => {
    const classificadas = classificarPendencias(PENDENCIAS, FIM, DIA_30);
    expect(classificadas.every((p) => p.natureza === "ATENCAO")).toBe(true);
  });
});

describe("os defeitos nunca esperam", () => {
  test.each([
    "block:purchasesWithoutItems",
    "block:taxesWithoutCompetence",
    "block:inventoryItemsWithoutCost",
    "block:payrollWithoutDreCategory",
    "block:purchaseDateFarFromCompetence"
  ])("%s é ATENCAO mesmo no dia 1", (key) => {
    const [p] = classificarPendencias([{ key, label: "x" }], FIM, new Date(2026, 5, 1));
    expect(p.natureza).toBe("ATENCAO");
  });

  test("chave desconhecida é tratada como defeito", () => {
    // Na dúvida, mostrar. Esconder o que não se reconhece é como o inventário
    // final ficou quatro meses invisível.
    const [p] = classificarPendencias([{ key: "block:novidade", label: "x" }], FIM, DIA_10);
    expect(p.natureza).toBe("ATENCAO");
  });
});

describe("resumirFechamento", () => {
  test("no dia 10 separa 4 esperas de 1 atenção", () => {
    const r = resumirFechamento(PENDENCIAS, FIM, DIA_10);
    expect(r.aguardando).toHaveLength(4);
    expect(r.atencao).toHaveLength(1);
    expect(r.mesTerminou).toBe(false);
    expect(r.semNadaParaFazer).toBe(false);
  });

  test("em julho tudo é atenção", () => {
    const r = resumirFechamento(PENDENCIAS, FIM, JULHO);
    expect(r.aguardando).toHaveLength(0);
    expect(r.atencao).toHaveLength(5);
  });

  test("sem pendência nenhuma, nada a fazer", () => {
    const r = resumirFechamento([], FIM, DIA_10);
    expect(r.semNadaParaFazer).toBe(true);
    expect(r.atencao).toEqual([]);
  });

  test("só esperas também conta como nada a fazer agora", () => {
    // É o estado normal de um mês em andamento sem erro: a tela deve dizer
    // "está tudo certo até aqui", não "4 pendências".
    const r = resumirFechamento(
      PENDENCIAS.filter((p) => p.key !== "block:inventoryItemsWithoutCost"), FIM, DIA_10);
    expect(r.semNadaParaFazer).toBe(true);
    expect(r.aguardando).toHaveLength(4);
  });
});

describe("progressoDoMes", () => {
  test("dia 10 de junho: 10 de 30", () => {
    const p = progressoDoMes("2026-06-01", "2026-06-30", DIA_10);
    expect(p).toEqual({ diaAtual: 10, totalDeDias: 30, fracao: 1 / 3 });
  });

  test("último dia fecha em 30 de 30", () => {
    const p = progressoDoMes("2026-06-01", "2026-06-30", DIA_30);
    expect(p.diaAtual).toBe(30);
    expect(p.fracao).toBe(1);
  });

  test("mês já passado não ultrapassa o total", () => {
    const p = progressoDoMes("2026-06-01", "2026-06-30", JULHO);
    expect(p.diaAtual).toBe(30);
    expect(p.fracao).toBe(1);
  });

  test("mês futuro não fica negativo", () => {
    const p = progressoDoMes("2026-06-01", "2026-06-30", new Date(2026, 4, 15));
    expect(p.diaAtual).toBe(0);
    expect(p.fracao).toBe(0);
  });

  test("fevereiro tem 28", () => {
    expect(progressoDoMes("2026-02-01", "2026-02-28", new Date(2026, 1, 14)).totalDeDias).toBe(28);
  });
});
