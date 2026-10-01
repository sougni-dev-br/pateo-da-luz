import { describe, expect, test } from "vitest";
import type { RescisaoResumo } from "../../../../api/client";
import { situacaoRescisao } from "../situacao";

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
