import { describe, expect, test } from "vitest";
import { encontrarRefacoes, JANELA_REFACAO_MINUTOS, TOLERANCIA_VALOR_REFACAO, type VendaParaRefacao } from "../agile-analise-refacao.js";

// Comanda cancelada e refeita (mesmo dia, mesmas pessoas, valor parecido, poucas horas depois) NAO e
// perda de venda: o valor reaparece numa venda recebida. A regra precisa ser conservadora, porque
// errar para o lado do "refez" esconde perda de verdade.
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaParaRefacao> & { saleId: string }): VendaParaRefacao => ({
  movementDate: dia("2026-10-05"), saleStatus: "RECEBIDA", saleHour: "13:00", people: 2, totalAmount: 200, ...over
});
const cancelada = (over: Partial<VendaParaRefacao> & { saleId: string }) => venda({ saleStatus: "CANCELADA", ...over });

describe("constantes da regra", () => {
  test("janela de 10 minutos e tolerancia de 2% de valor (medidos com dados reais e dias trocados)", () => {
    expect(JANELA_REFACAO_MINUTOS).toBe(10);
    expect(TOLERANCIA_VALOR_REFACAO).toBe(0.02);
  });
});

describe("encontrarRefacoes", () => {
  test("par claro: mesmo dia, mesmas pessoas, valor igual e 5 minutos depois", () => {
    const r = encontrarRefacoes([cancelada({ saleId: "c1", saleHour: "13:00" }), venda({ saleId: "r1", saleHour: "13:05" })]);
    expect([...r.entries()]).toEqual([["c1", "r1"]]);
  });

  test("a venda recebida pode vir ANTES da cancelada (abre a nova e cancela a velha)", () => {
    const r = encontrarRefacoes([cancelada({ saleId: "c1", saleHour: "13:05" }), venda({ saleId: "r1", saleHour: "13:00" })]);
    expect(r.get("c1")).toBe("r1");
  });

  test.each([
    ["outro dia", { movementDate: dia("2026-10-06") }],
    ["outro numero de pessoas", { people: 3 }],
    ["valor 5% maior", { totalAmount: 210 }],
    ["valor 5% menor", { totalAmount: 190 }],
    ["horario 30 minutos depois", { saleHour: "13:30" }],
    ["horario 3 horas depois", { saleHour: "16:00" }]
  ])("nao pareia quando muda %s", (_nome, mudanca) => {
    const r = encontrarRefacoes([cancelada({ saleId: "c1" }), venda({ saleId: "r1", ...mudanca })]);
    expect(r.size).toBe(0);
  });

  test("limites: exatamente 2% e exatamente 10 minutos ainda pareiam", () => {
    const r = encontrarRefacoes([
      cancelada({ saleId: "c1", saleHour: "12:00", totalAmount: 200 }),
      venda({ saleId: "r1", saleHour: "12:10", totalAmount: 204 })
    ]);
    expect(r.get("c1")).toBe("r1");
  });

  test("um pouco alem dos limites nao pareia", () => {
    expect(encontrarRefacoes([cancelada({ saleId: "c1", saleHour: "12:00" }), venda({ saleId: "r1", saleHour: "12:11" })]).size).toBe(0);
    expect(encontrarRefacoes([cancelada({ saleId: "c1" }), venda({ saleId: "r1", totalAmount: 204.5 })]).size).toBe(0);
  });

  test("duas mesas DIFERENTES de mesmo tamanho e valor parecido, com 40 min entre elas, nao viram 'refacao'", () => {
    // O caso que a regra antiga (120 min, 10%) pareava: coincidencia, nao refacao.
    const r = encontrarRefacoes([
      cancelada({ saleId: "c1", saleHour: "20:00", totalAmount: 180 }),
      venda({ saleId: "r1", saleHour: "20:40", totalAmount: 175 })
    ]);
    expect(r.size).toBe(0);
  });

  test("sem horario em qualquer das duas, nao ha como afirmar: nao pareia", () => {
    expect(encontrarRefacoes([cancelada({ saleId: "c1", saleHour: null }), venda({ saleId: "r1" })]).size).toBe(0);
    expect(encontrarRefacoes([cancelada({ saleId: "c1" }), venda({ saleId: "r1", saleHour: null })]).size).toBe(0);
  });

  test("recebida sem horario nao vira 'meia-noite': nao pareia nem com cancelada de madrugada", () => {
    expect(encontrarRefacoes([cancelada({ saleId: "c1", saleHour: "00:05" }), venda({ saleId: "r1", saleHour: null })]).size).toBe(0);
  });

  test("sem pessoas (0) ou valor zero nao pareia: coincidencia sem informacao", () => {
    expect(encontrarRefacoes([cancelada({ saleId: "c1", people: 0 }), venda({ saleId: "r1", people: 0 })]).size).toBe(0);
    expect(encontrarRefacoes([cancelada({ saleId: "c1", totalAmount: 0 }), venda({ saleId: "r1", totalAmount: 0 })]).size).toBe(0);
  });

  test("cada venda recebida refaz no maximo UMA cancelada", () => {
    const r = encontrarRefacoes([
      cancelada({ saleId: "c1", saleHour: "13:00" }),
      cancelada({ saleId: "c2", saleHour: "13:05" }),
      venda({ saleId: "r1", saleHour: "13:10" })
    ]);
    expect(r.size).toBe(1);
    expect(new Set(r.values()).size).toBe(1);
  });

  test("duas canceladas e duas recebidas: cada uma fica com o seu par mais proximo", () => {
    const r = encontrarRefacoes([
      cancelada({ saleId: "c1", saleHour: "12:00", totalAmount: 200 }),
      cancelada({ saleId: "c2", saleHour: "19:00", totalAmount: 300 }),
      venda({ saleId: "r1", saleHour: "12:05", totalAmount: 202 }),
      venda({ saleId: "r2", saleHour: "19:03", totalAmount: 304 })
    ]);
    expect(Object.fromEntries(r)).toEqual({ c1: "r1", c2: "r2" });
  });

  test("entre dois candidatos escolhe o mais proximo no horario", () => {
    const r = encontrarRefacoes([
      cancelada({ saleId: "c1", saleHour: "13:00" }),
      venda({ saleId: "longe", saleHour: "13:09" }),
      venda({ saleId: "perto", saleHour: "13:02" })
    ]);
    expect(r.get("c1")).toBe("perto");
  });

  test("so cancelada procura par; recebida com recebida nao e refacao", () => {
    expect(encontrarRefacoes([venda({ saleId: "r1" }), venda({ saleId: "r2" })]).size).toBe(0);
  });

  test("status que nao e RECEBIDA nem CANCELADA e ignorado", () => {
    const r = encontrarRefacoes([cancelada({ saleId: "c1" }), venda({ saleId: "a1", saleStatus: "EM ABERTO" })]);
    expect(r.size).toBe(0);
  });

  test("empate total (mesmo valor, mesma hora, mesmas pessoas): o resultado e o mesmo em qualquer ordem", () => {
    const linhas = [
      cancelada({ saleId: "c1", saleHour: "12:00" }), cancelada({ saleId: "c2", saleHour: "12:00" }),
      venda({ saleId: "r1", saleHour: "12:03" }), venda({ saleId: "r2", saleHour: "12:03" })
    ];
    const direta = Object.fromEntries(encontrarRefacoes(linhas));
    const inversa = Object.fromEntries(encontrarRefacoes([...linhas].reverse()));
    expect(direta).toEqual(inversa);
    expect(direta).toEqual({ c1: "r1", c2: "r2" });
  });

  test("resultado nao depende da ordem das linhas", () => {
    const linhas = [
      cancelada({ saleId: "c1", saleHour: "12:00" }), cancelada({ saleId: "c2", saleHour: "12:04", totalAmount: 205 }),
      venda({ saleId: "r1", saleHour: "12:05" }), venda({ saleId: "r2", saleHour: "12:08", totalAmount: 206 })
    ];
    const a = Object.fromEntries(encontrarRefacoes(linhas));
    const b = Object.fromEntries(encontrarRefacoes([...linhas].reverse()));
    expect(a).toEqual(b);
  });

  test("lista vazia", () => {
    expect(encontrarRefacoes([]).size).toBe(0);
  });
});
