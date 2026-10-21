import { describe, expect, test } from "vitest";
import {
  avaliarCanaisDeDelivery,
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

describe("canal de delivery sem faturamento", () => {
  test("canal com faturamento não gera pendência", () => {
    const todos = CANAIS_DE_DELIVERY.map((c) => c.id);
    expect(avaliarCanaisDeDelivery(todos)).toEqual([]);
  });

  test("cada canal zerado vira uma pendência própria", () => {
    const pendencias = avaliarCanaisDeDelivery(["KEETA"]);
    expect(pendencias.map((p) => p.key).sort()).toEqual(["delivery:IFOOD", "delivery:NOVENTA_NOVE"]);
  });

  test("o rótulo nomeia o canal", () => {
    const [p] = avaliarCanaisDeDelivery(["KEETA", "NOVENTA_NOVE"]);
    expect(p.label).toContain("iFood");
  });

  test("nenhum canal com faturamento: três pendências", () => {
    expect(avaliarCanaisDeDelivery([])).toHaveLength(3);
  });
});
