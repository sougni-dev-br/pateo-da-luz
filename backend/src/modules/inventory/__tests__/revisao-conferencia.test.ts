import { describe, expect, test } from "vitest";
import {
  LIMITE_DE_CONFERENCIA,
  exigeConferencia,
  pendenciasParaAprovar,
  validarRevisao
} from "../revisao-conferencia.js";

describe("exigeConferencia", () => {
  test("alerta a partir do limite exige conferencia", () => {
    expect(exigeConferencia({ classe: "IMPOSSIVEL", impacto: LIMITE_DE_CONFERENCIA })).toBe(true);
    expect(exigeConferencia({ classe: "ZERADO_SUSPEITO", impacto: 600 })).toBe(true);
    expect(exigeConferencia({ classe: "FORA_DO_HISTORICO", impacto: 51 })).toBe(true);
  });

  test("alerta pequeno fica opcional", () => {
    // Setembro/2026: 34 dos 123 alertas valiam menos de R$ 50.
    expect(exigeConferencia({ classe: "ZERADO_SUSPEITO", impacto: 12 })).toBe(false);
  });

  test("alerta sem custo exige: nao da para saber se pesa", () => {
    expect(exigeConferencia({ classe: "IMPOSSIVEL", impacto: null })).toBe(true);
  });

  test("coerente, sem referencia e pendente nao entram", () => {
    expect(exigeConferencia({ classe: "COERENTE", impacto: 9999 })).toBe(false);
    expect(exigeConferencia({ classe: "SEM_REFERENCIA", impacto: 9999 })).toBe(false);
    expect(exigeConferencia({ classe: "PENDENTE", impacto: null })).toBe(false);
  });
});

describe("pendenciasParaAprovar", () => {
  const base = { classe: "IMPOSSIVEL" as const, impacto: 100 };

  test("falta conferir: sem motivo ou marcado para recontar", () => {
    const itens = [
      { ...base, itemId: "a", motivo: null },
      { ...base, itemId: "b", motivo: "RECONTAR" },
      { ...base, itemId: "c", motivo: "CORRETO" },
      { ...base, itemId: "d", motivo: "CORRIGIDO" },
      { ...base, itemId: "e", classe: "COERENTE" as const, motivo: null },
      { ...base, itemId: "f", impacto: 10, motivo: null }
    ];
    expect(pendenciasParaAprovar(itens).map((i) => i.itemId)).toEqual(["a", "b"]);
  });
});

describe("validarRevisao", () => {
  test("motivos aceitos", () => {
    for (const motivo of ["CORRETO", "COMPRA_NAO_LANCADA", "ERRO_DE_UNIDADE", "CORRIGIDO", "RECONTAR"]) {
      expect(validarRevisao(motivo, "")).toEqual({ ok: true, motivo, observacao: null });
    }
  });

  test("outro exige observacao", () => {
    expect(validarRevisao("OUTRO", "  ")).toEqual({ ok: false, erro: "Descreva o motivo em \"Outro\"." });
    expect(validarRevisao("OUTRO", "produto vencido descartado")).toEqual({ ok: true, motivo: "OUTRO", observacao: "produto vencido descartado" });
  });

  test("motivo vazio desfaz a conferencia", () => {
    expect(validarRevisao(null, "")).toEqual({ ok: true, motivo: null, observacao: null });
  });

  test("motivo desconhecido e recusado", () => {
    expect(validarRevisao("APROVADO_NA_MARRA", "")).toEqual({ ok: false, erro: "Motivo de conferência inválido." });
  });

  test("observacao longa e cortada", () => {
    const r = validarRevisao("CORRETO", "x".repeat(600));
    expect(r.ok && r.observacao?.length).toBe(500);
  });
});
