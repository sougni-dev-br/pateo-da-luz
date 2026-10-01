import { describe, expect, test } from "vitest";
import type { RescisaoResumo } from "../../../../api/client";
import { situacaoRescisao } from "../situacao";
import { FILTROS, contarPorSituacao, linhasDaLista } from "../ListaRescisoes";

const base: RescisaoResumo = {
  employeeId: "e1", nome: "Ana Silva", apelido: null, empresa: "Pateo", semRegistro: true,
  saida: "2026-09-12", motivo: null, rescisao: null, termo: null,
};
const lancada = (pagas: number, parcelas = 2) => ({ parcelas, pagas, liquido: 1000, valorPago: pagas * 500, proximoVencimento: pagas < parcelas ? "2026-10-20" : null });
const termo = { arquivo: "trct.pdf", importadoEm: "2026-09-30T10:00:00Z", gorjeta: 300, liquido: 4000, pagamento: "2026-09-30" };
const HOJE = "2026-10-01";

describe("situacaoRescisao", () => {
  test("sem registro, nada lançado: falta lançar e o próximo passo é conferir a apuração", () => {
    const s = situacaoRescisao(base, HOJE);
    expect(s.situacao).toBe("FALTA_LANCAR");
    expect(s.rotulo).toBe("Falta lançar");
    expect(s.proximoPasso).toMatch(/apuração/i);
  });

  test("CLT sem termo e sem lançamento: falta lançar, esperando o termo", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false }, HOJE);
    expect(s.situacao).toBe("FALTA_LANCAR");
    expect(s.proximoPasso).toMatch(/termo/i);
  });

  test("CLT com termo e sem lançamento: termo importado, falta lançar o bruto", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, termo }, HOJE);
    expect(s.situacao).toBe("TERMO_IMPORTADO");
    expect(s.proximoPasso).toMatch(/lançar/i);
  });

  test("lançada sem nada pago: pagar em Contas a Pagar", () => {
    const s = situacaoRescisao({ ...base, rescisao: lancada(0) }, HOJE);
    expect(s.situacao).toBe("LANCADA");
    expect(s.proximoPasso).toMatch(/Contas a Pagar/);
  });

  test("CLT lançada sem o termo: lembra de importar o termo", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, rescisao: lancada(0) }, HOJE);
    expect(s.situacao).toBe("LANCADA");
    expect(s.proximoPasso).toMatch(/termo/i);
  });

  test("parte paga: paga em parte, com quantas faltam", () => {
    const s = situacaoRescisao({ ...base, rescisao: lancada(1, 3) }, HOJE);
    expect(s.situacao).toBe("PAGA_EM_PARTE");
    expect(s.proximoPasso).toMatch(/2 de 3/);
  });

  test("tudo pago: concluída", () => {
    const s = situacaoRescisao({ ...base, rescisao: lancada(2) }, HOJE);
    expect(s.situacao).toBe("PAGA");
    expect(s.tom).toBe("success");
    expect(s.proximoPasso).toMatch(/concluída/i);
  });

  test("CLT paga sem termo: ainda falta importar o termo", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, rescisao: lancada(2) }, HOJE);
    expect(s.situacao).toBe("PAGA");
    expect(s.proximoPasso).toMatch(/termo/i);
  });

  test("ainda vai sair: avisa a data", () => {
    const s = situacaoRescisao({ ...base, saida: "2026-10-15" }, HOJE);
    expect(s.situacao).toBe("FALTA_LANCAR");
    expect(s.saindo).toBe(true);
    expect(s.proximoPasso).toMatch(/15\/10/);
  });

  test("sem data de saída: primeiro registrar o desligamento", () => {
    const s = situacaoRescisao({ ...base, saida: null }, HOJE);
    expect(s.proximoPasso).toMatch(/data de saída/i);
  });
});

describe("quitada no termo", () => {
  const quitada = { parcelas: 1, pagas: 1, liquido: 0, valorPago: 0, proximoVencimento: null, quitadaNoTermo: { itemId: "q1" } };

  test("CLT com termo de líquido zero registrado: quitada no termo, concluída", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, rescisao: quitada, termo: { ...termo, liquido: 0, gorjeta: null } }, HOJE);
    expect(s.situacao).toBe("QUITADA_NO_TERMO");
    expect(s.rotulo).toBe("Quitada no termo");
    expect(s.tom).toBe("success");
    expect(s.proximoPasso).toBe("Concluída — nada a pagar (líquido zero no termo)");
  });

  test("não pede o termo de novo mesmo sem termo na gorjeta", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, rescisao: quitada, termo: null }, HOJE);
    expect(s.situacao).toBe("QUITADA_NO_TERMO");
    expect(s.proximoPasso).not.toMatch(/importar/i);
  });

  test("o filtro da lista tem a situação nova e conta quem está nela", () => {
    expect(FILTROS.map((f) => f.id)).toContain("QUITADA_NO_TERMO");
    const linhas = linhasDaLista([{ ...base, semRegistro: false, rescisao: quitada }, base], HOJE);
    expect(contarPorSituacao(linhas)).toMatchObject({ TODAS: 2, QUITADA_NO_TERMO: 1, FALTA_LANCAR: 1 });
  });
});

describe("quitada sem valor (líquido zero ou saldo devedor perdoado)", () => {
  const quitada = (perdoado: number) => ({
    parcelas: 1, pagas: 1, liquido: 0, valorPago: 0, proximoVencimento: null, quitadaNoTermo: null,
    quitadaSemValor: { itemId: "z1", saldoDevedorPerdoado: perdoado },
  });

  test("líquido zero: Quitada, concluída, nada a pagar", () => {
    const s = situacaoRescisao({ ...base, rescisao: quitada(0) }, HOJE);
    expect(s.situacao).toBe("QUITADA");
    expect(s.rotulo).toBe("Quitada");
    expect(s.tom).toBe("success");
    expect(s.proximoPasso).toBe("Concluída — nada a pagar");
  });

  test("saldo perdoado: o próximo passo diz quanto foi perdoado", () => {
    const s = situacaoRescisao({ ...base, rescisao: quitada(153.23) }, HOJE);
    expect(s.situacao).toBe("QUITADA");
    expect(s.proximoPasso.replace(/\s/g, " ")).toBe("Concluída — saldo devedor de R$ 153,23 perdoado");
  });

  test("CLT quitada sem valor não pede o termo de novo", () => {
    const s = situacaoRescisao({ ...base, semRegistro: false, rescisao: quitada(0), termo: null }, HOJE);
    expect(s.situacao).toBe("QUITADA");
    expect(s.proximoPasso).not.toMatch(/importar/i);
  });

  test("o filtro da lista tem a situação e conta quem está nela", () => {
    expect(FILTROS.find((f) => f.id === "QUITADA")).toMatchObject({ rotulo: "Quitada", tom: "success" });
    const linhas = linhasDaLista([{ ...base, rescisao: quitada(10) }, base], HOJE);
    expect(contarPorSituacao(linhas)).toMatchObject({ TODAS: 2, QUITADA: 1, FALTA_LANCAR: 1 });
  });
});
