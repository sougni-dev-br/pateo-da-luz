import { describe, expect, test } from "vitest";
import { LIMITE_DE_ITENS_DO_RASCUNHO, conferirVersao, validarRascunho } from "../requisicao-rascunho.js";

const cabecalho = { date: "2026-10-15", shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" };

describe("validarRascunho", () => {
  test("aceita cabeçalho e escolhas, conta os itens e guarda o resumo", () => {
    const r = validarRascunho({ conteudo: { cabecalho, escolhas: { p1: { unit: "KG", quantity: "2,5" }, p2: { unit: "UN", quantity: "3" } } }, summary: "Alface, Tomate" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.itemCount).toBe(2);
      expect(r.valor.summary).toBe("Alface, Tomate");
      expect(r.valor.conteudo.escolhas.p1).toEqual({ unit: "KG", quantity: "2,5" });
    }
  });

  test("escolha sem quantidade ou malformada fica de fora, sem derrubar o resto", () => {
    const r = validarRascunho({ conteudo: { cabecalho, escolhas: { p1: { unit: "KG", quantity: "" }, p2: { unit: "KG" }, p3: null, p4: { unit: "UN", quantity: "1" } } } });
    expect(r.ok && Object.keys(r.valor.conteudo.escolhas)).toEqual(["p4"]);
  });

  test("corpo inválido é recusado", () => {
    expect(validarRascunho(null).ok).toBe(false);
    expect(validarRascunho({ conteudo: { cabecalho } }).ok).toBe(false);
    expect(validarRascunho({ conteudo: { cabecalho, escolhas: [] } }).ok).toBe(false);
    expect(validarRascunho({ conteudo: { escolhas: {} } }).ok).toBe(false);
  });

  test("rascunho com itens demais é recusado", () => {
    const escolhas = Object.fromEntries(Array.from({ length: LIMITE_DE_ITENS_DO_RASCUNHO + 1 }, (_, i) => [`p${i}`, { unit: "UN", quantity: "1" }]));
    expect(validarRascunho({ conteudo: { cabecalho, escolhas } }).ok).toBe(false);
  });

  test("textos longos são cortados: o JSON volta para todos os usuários da tela", () => {
    const r = validarRascunho({ conteudo: { cabecalho: { ...cabecalho, notes: "x".repeat(5000) }, escolhas: { p1: { unit: "KG".repeat(50), quantity: "9".repeat(100) } } }, summary: "s".repeat(1000) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.conteudo.cabecalho.notes).toHaveLength(300);
      expect(r.valor.conteudo.escolhas.p1.unit).toHaveLength(16);
      expect(r.valor.conteudo.escolhas.p1.quantity).toHaveLength(32);
      expect(r.valor.summary).toHaveLength(200);
    }
  });

  test("só as chaves do rascunho passam (nada extra do navegador)", () => {
    const r = validarRascunho({ conteudo: { cabecalho: { ...cabecalho, injetado: "x" }, escolhas: { p1: { unit: "KG", quantity: "1", outro: "y" } } } });
    expect(r.ok && JSON.stringify(r.valor.conteudo)).not.toContain("injetado");
    expect(r.ok && JSON.stringify(r.valor.conteudo)).not.toContain("outro");
  });
});

describe("conferirVersao", () => {
  test("a versão que a pessoa viu pode salvar e avança", () => {
    expect(conferirVersao(3, 3)).toEqual({ ok: true, proxima: 4 });
    expect(conferirVersao(3, "3")).toEqual({ ok: true, proxima: 4 });
  });

  test("versão antiga ou ausente é conflito: ninguém sobrescreve em silêncio", () => {
    expect(conferirVersao(3, 2)).toEqual({ ok: false, atual: 3 });
    expect(conferirVersao(3, undefined)).toEqual({ ok: false, atual: 3 });
  });
});
