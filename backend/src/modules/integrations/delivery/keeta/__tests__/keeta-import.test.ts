import { describe, expect, test } from "vitest";
import { lerTabelaKeeta, parseCsvKeeta, planejarImportacao, type DiaExistente } from "../keeta-import.js";

const CABECALHO = ["Data", "Vendas de itens", "Promoção da loja", "Ganhos líquidos", "Pedidos"];

describe("lerTabelaKeeta", () => {
  test("calcula o bruto como vendas menos promoção e a retenção como bruto menos repasse", () => {
    const r = lerTabelaKeeta([CABECALHO, ["01/04/2026", "1000,00", "100,00", "700,00", "20"]]);
    expect(r.erros).toEqual([]);
    expect(r.dias).toEqual([
      { date: "2026-04-01", orders: 20, grossAmount: 900, netAmount: 700, platformFees: 200 }
    ]);
  });

  test("aceita datas ISO, Date do Excel e números no formato brasileiro e americano", () => {
    const r = lerTabelaKeeta([
      CABECALHO,
      ["2026-04-02", "R$ 1.234,56", "0", "1.000,00", "10"],
      [new Date(Date.UTC(2026, 3, 3)), 500.5, 0, 400.25, 5]
    ]);
    expect(r.erros).toEqual([]);
    expect(r.dias.map((d) => [d.date, d.grossAmount, d.netAmount])).toEqual([
      ["2026-04-02", 1234.56, 1000],
      ["2026-04-03", 500.5, 400.25]
    ]);
  });

  test("encontra o cabeçalho mesmo com linhas de título antes e ignora linha de total", () => {
    const r = lerTabelaKeeta([
      ["Relatório Keeta"],
      [],
      CABECALHO,
      ["01/04/2026", "100", "0", "80", "2"],
      ["Total", "100", "0", "80", "2"]
    ]);
    expect(r.erros).toEqual([]);
    expect(r.dias).toHaveLength(1);
  });

  test("lê as colunas com os nomes do relatório 'Dados do restaurante' do portal", () => {
    const r = lerTabelaKeeta([
      ["Data", "Ganhos líquidos", "Vendas de itens", "Despesa", "Despesas da plataforma", "Comissão", "Pedidos válidos"],
      ["20260401", 700, 1000, 100, 50, 150, 20]
    ]);
    expect(r.erros).toEqual([]);
    expect(r.dias).toEqual([{ date: "2026-04-01", orders: 20, grossAmount: 900, netAmount: 700, platformFees: 200 }]);
  });

  test("sem a coluna de promoção, o bruto é igual às vendas", () => {
    const r = lerTabelaKeeta([["Data", "Vendas de itens", "Ganhos líquidos", "Pedidos"], ["01/04/2026", "100", "80", "2"]]);
    expect(r.dias[0]?.grossAmount).toBe(100);
  });

  test("recusa o arquivo quando faltam colunas obrigatórias, dizendo quais", () => {
    const r = lerTabelaKeeta([["Data", "Pedidos"], ["01/04/2026", "2"]]);
    expect(r.dias).toEqual([]);
    expect(r.erros[0]).toContain("Vendas de itens");
    expect(r.erros[0]).toContain("Ganhos líquidos");
  });

  test("rejeita a linha em que o repasse é maior que o bruto, sem derrubar as demais", () => {
    const r = lerTabelaKeeta([
      CABECALHO,
      ["01/04/2026", "100", "0", "150", "2"],
      ["02/04/2026", "100", "0", "80", "2"]
    ]);
    expect(r.dias.map((d) => d.date)).toEqual(["2026-04-02"]);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain("01/04/2026");
  });

  test("rejeita data repetida e data inválida", () => {
    const r = lerTabelaKeeta([
      CABECALHO,
      ["01/04/2026", "100", "0", "80", "2"],
      ["01/04/2026", "100", "0", "80", "2"],
      ["31/02/2026", "100", "0", "80", "2"]
    ]);
    expect(r.dias).toHaveLength(1);
    expect(r.erros).toHaveLength(2);
  });
});

describe("parseCsvKeeta", () => {
  test("lê CSV com ponto e vírgula, aspas e BOM", () => {
    const csv = '﻿Data;Vendas de itens;"Ganhos líquidos";Pedidos\n01/04/2026;"1.000,50";"800,25";12\n';
    expect(parseCsvKeeta(csv)).toEqual([
      ["Data", "Vendas de itens", "Ganhos líquidos", "Pedidos"],
      ["01/04/2026", "1.000,50", "800,25", "12"]
    ]);
  });

  test("lê CSV com vírgula quando não há ponto e vírgula", () => {
    expect(parseCsvKeeta("a,b\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("planejarImportacao", () => {
  const dia = (date: string, gross: number, net: number, orders = 1) => ({
    date, orders, grossAmount: gross, netAmount: net, platformFees: Math.round((gross - net) * 100) / 100
  });

  test("classifica cada dia em novo, alterado ou igual", () => {
    const existentes: DiaExistente[] = [
      { id: "a", date: "2026-04-01", orders: 1, grossAmount: 100, netAmount: 80 },
      { id: "b", date: "2026-04-02", orders: 1, grossAmount: 100, netAmount: 80 }
    ];
    const plano = planejarImportacao(
      [dia("2026-04-01", 100, 80), dia("2026-04-02", 120, 90), dia("2026-04-03", 50, 40)],
      existentes
    );
    expect(plano.map((p) => [p.dia.date, p.acao])).toEqual([
      ["2026-04-01", "IGUAL"],
      ["2026-04-02", "ALTERAR"],
      ["2026-04-03", "CRIAR"]
    ]);
    expect(plano[1]?.existenteId).toBe("b");
  });

  test("mais de um lançamento ativo no mesmo dia vira conflito e não é tocado", () => {
    const existentes: DiaExistente[] = [
      { id: "a", date: "2026-04-01", orders: 1, grossAmount: 100, netAmount: 80 },
      { id: "b", date: "2026-04-01", orders: 1, grossAmount: 10, netAmount: 8 }
    ];
    const plano = planejarImportacao([dia("2026-04-01", 100, 80)], existentes);
    expect(plano[0]?.acao).toBe("CONFLITO");
  });

  test("rodar duas vezes com o mesmo arquivo não altera nada na segunda", () => {
    const novos = [dia("2026-04-01", 100, 80)];
    const primeira = planejarImportacao(novos, []);
    expect(primeira[0]?.acao).toBe("CRIAR");
    const gravado: DiaExistente[] = [{ id: "keeta-import-20260401", date: "2026-04-01", orders: 1, grossAmount: 100, netAmount: 80 }];
    expect(planejarImportacao(novos, gravado)[0]?.acao).toBe("IGUAL");
  });
});
