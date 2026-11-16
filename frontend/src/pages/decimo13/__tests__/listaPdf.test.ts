import { describe, expect, test } from "vitest";
import type { Decimo13Linha, LinhaPagamentoMeio, ListaDecimo13 } from "../../../api/client";
import { codigoDaListaDecimo, listaDecimoParaPdf, regrasDaListaDecimo, seloDaListaDecimo } from "../listaPdf";
import { parcelaDaLinha, resumirParcela } from "../parcelas";

// Dados FICTÍCIOS: o repositório é público.
const linha = (over: Partial<LinhaPagamentoMeio>): LinhaPagamentoMeio => ({
  employeeId: "e1", nome: "Ana Silva", grupo: "EMPRESA TESTE LTDA", origem: "EXTRATO", valor: 1000, situacao: "LANCADO",
  vencimento: "2026-11-30", pagoEm: null, valorPago: null, payrollItemId: "i1", pix: "pix@teste", pixTipo: "EMAIL", contaBancaria: null,
  aviso: null, atualizarPara: null, ...over,
});
const lista = (linhas: LinhaPagamentoMeio[], aLancar = 0): ListaDecimo13 => ({
  parcela: 1, ano: 2026, linhas, total: 0, avisos: [], aLancar: { pessoas: aLancar, total: 0 }, lancado: { pessoas: 0, total: 0 }, pago: { pessoas: 0, total: 0 },
});

describe("listaDecimoParaPdf", () => {
  test("os pagos saem da lista e vão para 'já pagos'; o total é só do que falta pagar", () => {
    const pdf = listaDecimoParaPdf(lista([
      linha({ valor: 1000 }),
      linha({ employeeId: "e2", nome: "Bia", valor: 500, situacao: "PAGO", pagoEm: "2026-11-28", valorPago: 490 }),
    ]));
    expect(pdf.linhas.map((l) => l.nome)).toEqual(["Ana Silva"]);
    expect(pdf.total).toBe(1000);
    expect(pdf.jaPagos).toEqual([{ nome: "Bia", valor: 490, pagoEm: "2026-11-28" }]);
  });
  test("leva o PIX e o aviso da linha (ex.: composição do combinado)", () => {
    const pdf = listaDecimoParaPdf(lista([linha({ aviso: "Inclui a diferença do salário combinado" })]));
    expect(pdf.linhas[0]).toMatchObject({ pix: "pix@teste", aviso: "Inclui a diferença do salário combinado" });
  });
});

describe("selo e regras", () => {
  test("prévia enquanto falta lançar ou atualizar; lançado quando tudo está no Contas a Pagar", () => {
    expect(seloDaListaDecimo(lista([linha({})], 2))).toEqual({ texto: "PRÉVIA - FALTAM LANÇAR 2", tom: "aviso" });
    expect(seloDaListaDecimo(lista([linha({ atualizarPara: 10 })])).texto).toBe("PRÉVIA - FALTA LANÇAR 1");
    expect(seloDaListaDecimo(lista([linha({})])).texto).toBe("LANÇADO NO CONTAS A PAGAR");
  });
  test("regras e código por parcela", () => {
    expect(regrasDaListaDecimo(1)[0]).toContain("1ª parcela");
    expect(regrasDaListaDecimo(2)[0]).toContain("2ª parcela");
    expect(codigoDaListaDecimo(2026, 2)).toBe("13O-P2-2026");
  });
});

describe("combinado aguardando o extrato", () => {
  const base = {
    employeeId: "e1", nome: "Caio", setor: null, motivoSemCalculo: null, preRegistro: false, semRegistroAte: null, registroEm: null, acerto: null,
    calculo: { vencimento1: "2026-11-30", vencimento2: "2026-12-20" } as Decimo13Linha["calculo"],
    p2: { existe: false, paga: false, lancado: null, devido: null, gerar: false, excesso: 0 },
  };
  test("sem título do extrato: situação própria, não conta como a lançar", () => {
    const l: Decimo13Linha = { ...base, origem: "COMBINADO", p1: { existe: false, paga: false, lancado: null, devido: 573, gerar: false, aguardaExtrato: true } };
    const p = parcelaDaLinha(l, 1);
    expect(p.situacao).toBe("AGUARDANDO_EXTRATO");
    const r = resumirParcela([p]);
    expect(r.novas).toBe(0);
    expect(r.pessoas).toBe(0); // a pessoa já conta na linha CLT
  });
});

describe("achados da auditoria", () => {
  const baseLinha = {
    employeeId: "e1", nome: "Caio", setor: null, motivoSemCalculo: null, preRegistro: false, semRegistroAte: null, registroEm: null, acerto: null,
    calculo: { vencimento1: "2026-11-30", vencimento2: "2026-12-20" } as Decimo13Linha["calculo"],
    p2: { existe: false, paga: false, lancado: null, devido: null, gerar: false, excesso: 0 },
  };
  test("diferença já somada ao título do extrato não entra de novo nos totais", () => {
    const l: Decimo13Linha = { ...baseLinha, origem: "COMBINADO", p1: { existe: true, paga: false, lancado: 573, devido: 573, gerar: false, somadaAoExtrato: true } };
    const p = parcelaDaLinha(l, 1);
    expect(p.situacao).toBe("SOMADA");
    const r = resumirParcela([p]);
    expect(r.totalLancado).toBe(0);
    expect(r.totalNovas).toBe(0);
    expect(r.pessoas).toBe(0); // a pessoa já conta na linha CLT
  });
  test("somada e paga também não entra nos totais (o título pago do extrato já a inclui)", () => {
    const l: Decimo13Linha = { ...baseLinha, origem: "COMBINADO", p1: { existe: true, paga: true, lancado: 573, devido: 573, gerar: false, somadaAoExtrato: true } };
    expect(resumirParcela([parcelaDaLinha(l, 1)]).totalLancado).toBe(0);
  });
  test("diferença lançada à parte (legado) continua nos totais: é outro título", () => {
    const l: Decimo13Linha = { ...baseLinha, origem: "COMBINADO", p1: { existe: true, paga: false, lancado: 573, devido: 573, gerar: false } };
    const p = parcelaDaLinha(l, 1);
    expect(p.situacao).toBe("LANCADA");
    expect(resumirParcela([p]).totalLancado).toBe(573);
  });
  test("selo do PDF: prévia quando alguém aguarda o extrato ou falta somar; nunca 'lançado'", () => {
    expect(seloDaListaDecimo({ ...lista([linha({})]), aguardandoExtrato: ["Caio"] }).texto).toBe("PRÉVIA - FALTA LANÇAR 1");
    expect(seloDaListaDecimo(lista([linha({ atualizarPara: 3100 })])).tom).toBe("aviso");
  });
  test("o aviso de quem aguarda o extrato vai nas regras impressas", () => {
    expect(regrasDaListaDecimo(1, ["Caio Lima"])[0]).toContain("Caio Lima");
    expect(regrasDaListaDecimo(1)[0]).toContain("CLT");
  });
});

describe("reauditoria", () => {
  const baseL = {
    employeeId: "e1", nome: "Caio", setor: null, motivoSemCalculo: null, preRegistro: false, semRegistroAte: null, registroEm: null, acerto: null,
    calculo: { vencimento1: "2026-11-30", vencimento2: "2026-12-20" } as Decimo13Linha["calculo"],
  };
  const p2vazio = { existe: false, paga: false, lancado: null, devido: null, gerar: false, excesso: 0 };

  test("somada com valor antigo (o cálculo mudou): entra só a diferença de valor nos totais e conta para atualizar", () => {
    const l: Decimo13Linha = { ...baseL, origem: "COMBINADO", p2: p2vazio, p1: { existe: true, paga: false, lancado: 500, devido: 562.5, gerar: true, somadaAoExtrato: true } };
    const p = parcelaDaLinha(l, 1);
    expect(p).toMatchObject({ situacao: "SOMADA", gerar: true, atualizarPara: 562.5, valor: 500 });
    const r = resumirParcela([p]);
    expect(r.atualizar).toBe(1);
    expect(r.totalNovas).toBeCloseTo(62.5, 2); // o título do extrato (linha CLT) já tem os 500
    expect(r.totalLancado).toBe(0);
  });
  test("título pago que precisa de conferência não entra em totais nem em 'falta lançar'", () => {
    const l: Decimo13Linha = { ...baseL, origem: "COMBINADO", p2: p2vazio, p1: { existe: true, paga: true, lancado: null, devido: 573, gerar: false, conferir: true } };
    const p = parcelaDaLinha(l, 1);
    expect(p.situacao).toBe("CONFERIR");
    const r = resumirParcela([p]);
    expect(r.novas + r.totalNovas + r.totalLancado + r.lancadas).toBe(0);
  });
  test("2ª parcela da diferença com a 1ª aguardando o extrato: aguarda, não 'falta lançar'", () => {
    const l: Decimo13Linha = {
      ...baseL, origem: "COMBINADO", p1: { existe: false, paga: false, lancado: null, devido: 573, gerar: false, aguardaExtrato: true },
      p2: { existe: false, paga: false, lancado: null, devido: 700.33, gerar: true, excesso: 0 },
    };
    expect(parcelaDaLinha(l, 2).situacao).toBe("AGUARDANDO_EXTRATO");
  });
});

describe("terceira auditoria", () => {
  const baseL = {
    employeeId: "e1", nome: "Caio", setor: null, motivoSemCalculo: null, preRegistro: false, semRegistroAte: null, registroEm: null, acerto: null,
    calculo: { vencimento1: "2026-11-30", vencimento2: "2026-12-20" } as Decimo13Linha["calculo"],
  };
  const p2 = { existe: false, paga: false, lancado: null, devido: 700.33, gerar: true, excesso: 0 };
  test("2ª parcela com a 1ª para conferir ou ainda por lançar/atualizar: não é 'falta lançar'", () => {
    for (const p1 of [{ conferir: true, gerar: false }, { gerar: true }]) {
      const l: Decimo13Linha = { ...baseL, origem: "COMBINADO", p2, p1: { existe: false, paga: false, lancado: null, devido: 573, ...p1 } };
      expect(parcelaDaLinha(l, 2).situacao).toBe("AGUARDANDO_EXTRATO");
      expect(resumirParcela([parcelaDaLinha(l, 2)]).novas).toBe(0);
    }
  });
  test("2ª parcela com a 1ª somada e em dia: é a lançar normalmente", () => {
    const l: Decimo13Linha = { ...baseL, origem: "COMBINADO", p2, p1: { existe: true, paga: false, lancado: 573, devido: 573, gerar: false, somadaAoExtrato: true } };
    expect(parcelaDaLinha(l, 2).situacao).toBe("A_LANCAR");
  });
});
