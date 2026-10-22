import { describe, expect, test } from "vitest";
import {
  avaliarCanaisDeDelivery,
  diasEsperadosDoMes,
  type FaturamentoDoCanal,
  avaliarFaturamentoDeEventos,
  avaliarFolhaLancada,
  avaliarGorjetaDoMes,
  CANAIS_DE_DELIVERY
} from "../pendencias-do-mes.js";

describe("folha do mês lançada", () => {
  test("com salário lançado não há pendência", () => {
    expect(avaliarFolhaLancada(12)).toEqual([]);
  });

  test("sem nenhum salário lançado é pendência", () => {
    const [p] = avaliarFolhaLancada(0);
    expect(p.key).toBe("block:payrollNotLaunched");
    expect(p.label).toMatch(/folha/i);
  });
});

describe("gorjeta do mês fechada", () => {
  test("todas as apurações fechadas: sem pendência", () => {
    expect(avaliarGorjetaDoMes({ total: 2, abertas: 0 })).toEqual([]);
  });

  test("nenhuma apuração no mês é pendência", () => {
    const [p] = avaliarGorjetaDoMes({ total: 0, abertas: 0 });
    expect(p.key).toBe("block:tipsNotClosed");
    expect(p.label).toMatch(/nenhuma apuração/i);
  });

  test("apuração ainda aberta segura o fechamento", () => {
    const [p] = avaliarGorjetaDoMes({ total: 2, abertas: 1 });
    expect(p.key).toBe("block:tipsNotClosed");
    expect(p.label).toMatch(/1 apuração\(ões\) em aberto/);
  });
});

describe("faturamento de eventos lançado fora do Agile", () => {
  // Ter um evento lançado não prova que todos foram: pode haver vários no mês.
  // A pendência só sai quando alguém confere e registra a conferência.
  test("mesmo com eventos lançados, segue pendente até alguém conferir", () => {
    const [p] = avaliarFaturamentoDeEventos({ lancamentos: 3, valor: 1500 });
    expect(p.key).toBe("block:eventRevenue");
    expect(p.label).toMatch(/3 lançamento\(s\)/);
    expect(p.label).toMatch(/1\.500,00/);
    expect(p.label).toMatch(/confira/i);
  });

  test("sem nenhum evento lançado a mensagem manda lançar", () => {
    const [p] = avaliarFaturamentoDeEventos({ lancamentos: 0, valor: 0 });
    expect(p.key).toBe("block:eventRevenue");
    expect(p.label).toMatch(/Lançar evento/);
  });
});

describe("faturamento de delivery: toda plataforma pede conferência", () => {
  const completo = (id: string, parcial: Partial<FaturamentoDoCanal> = {}): FaturamentoDoCanal => ({
    id, dias: 30, lancamentos: 83, bruto: 41250.30, liquido: 37120.80, ...parcial
  });
  const CONTEXTO = { diasEsperados: 30 };

  test("sem nenhum faturamento no mês, as três plataformas ficam pendentes", () => {
    const pendencias = avaliarCanaisDeDelivery([], CONTEXTO);
    expect(pendencias.map((p) => p.key).sort()).toEqual(["delivery:IFOOD", "delivery:KEETA", "delivery:NOVENTA_NOVE"]);
    expect(pendencias.every((p) => /nenhum faturamento/i.test(p.label))).toBe(true);
  });

  // A regra antiga só cobria o mês ZERADO: Keeta e 99 com o mês inteiro lançado
  // nunca apareciam, e ninguém afirmava que o valor bate com o relatório da plataforma.
  test("plataforma com o mês completo AINDA pede conferência, com o valor na mensagem", () => {
    const todas = CANAIS_DE_DELIVERY.map((c) => completo(c.id));
    const pendencias = avaliarCanaisDeDelivery(todas, CONTEXTO);
    expect(pendencias).toHaveLength(3);
    const [p] = pendencias;
    expect(p.label).toMatch(/30 de 30 dias|30\/30 dias/);
    expect(p.label).toMatch(/41.250,30/);
    expect(p.label).toMatch(/confira/i);
  });

  test("mês incompleto acusa quantos dias faltam", () => {
    const [p] = avaliarCanaisDeDelivery(
      [completo("KEETA", { dias: 18 }), completo("IFOOD"), completo("NOVENTA_NOVE")],
      CONTEXTO
    ).filter((x) => x.key === "delivery:KEETA");
    expect(p.label).toMatch(/18 de 30 dias/);
    expect(p.label).toMatch(/faltam 12 dia/);
  });

  test("a chave é a mesma nos três casos: uma conferência/justificativa resolve a plataforma", () => {
    const zerado = avaliarCanaisDeDelivery([], CONTEXTO).find((x) => x.key === "delivery:KEETA");
    const completoK = avaliarCanaisDeDelivery([completo("KEETA")], CONTEXTO).find((x) => x.key === "delivery:KEETA");
    expect(zerado?.key).toBe(completoK?.key);
  });

  test("o rótulo nomeia a plataforma e cabe no padrão 'título: detalhe'", () => {
    const p = avaliarCanaisDeDelivery([], CONTEXTO).find((x) => x.key === "delivery:IFOOD")!;
    expect(p.label.startsWith("Delivery iFood: ")).toBe(true);
  });

  test("mês em andamento: o esperado são os dias até ontem, não o mês inteiro", () => {
    const pendencias = avaliarCanaisDeDelivery([completo("KEETA", { dias: 18 })], { diasEsperados: 18 });
    const keeta = pendencias.find((x) => x.key === "delivery:KEETA")!;
    expect(keeta.label).toMatch(/18 de 18 dias|18\/18 dias/);
    expect(keeta.label).not.toMatch(/faltam/i);
  });

  test("dias de sobra não viram 'faltam negativo'", () => {
    const keeta = avaliarCanaisDeDelivery([completo("KEETA", { dias: 31 })], { diasEsperados: 30 })
      .find((x) => x.key === "delivery:KEETA")!;
    expect(keeta.label).not.toMatch(/faltam/i);
  });

  test("o líquido aparece quando há", () => {
    const keeta = avaliarCanaisDeDelivery([completo("KEETA", { liquido: 31890.45 })], CONTEXTO)
      .find((x) => x.key === "delivery:KEETA")!;
    expect(keeta.label).toMatch(/31.890,45/);
  });
});

describe("diasEsperadosDoMes", () => {
  test("mês encerrado: todos os dias do mês", () => {
    expect(diasEsperadosDoMes(2026, 9, new Date(Date.UTC(2026, 9, 22)))).toBe(30);
    expect(diasEsperadosDoMes(2026, 8, new Date(Date.UTC(2026, 9, 22)))).toBe(31);
  });

  test("mês em andamento: até ontem (o dia de hoje ainda não fechou)", () => {
    expect(diasEsperadosDoMes(2026, 10, new Date(Date.UTC(2026, 9, 22)))).toBe(21);
  });

  test("mês futuro: nenhum dia esperado", () => {
    expect(diasEsperadosDoMes(2026, 12, new Date(Date.UTC(2026, 9, 22)))).toBe(0);
  });

  test("dia 1º do mês: ainda não há dia fechado", () => {
    expect(diasEsperadosDoMes(2026, 10, new Date(Date.UTC(2026, 9, 1)))).toBe(0);
  });
});
