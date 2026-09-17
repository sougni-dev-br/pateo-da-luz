import { describe, expect, test } from "vitest";
import {
  baseEstaViva,
  cancelamentoDeveCancelarBase,
  podeReaproveitarBase,
  reaberturaDeveSoltarBase
} from "../base-oficial.js";

describe("baseEstaViva", () => {
  test("APPROVED e ACTIVE contam como base viva", () => {
    expect(baseEstaViva("APPROVED")).toBe(true);
    expect(baseEstaViva("ACTIVE")).toBe(true);
  });

  test("CANCELLED e ausencia de base nao contam", () => {
    expect(baseEstaViva("CANCELLED")).toBe(false);
    expect(baseEstaViva(null)).toBe(false);
  });
});

describe("cancelamentoDeveCancelarBase", () => {
  test("cancelar inventario com base viva cancela a base", () => {
    // Era o buraco: o inventario ia para CANCELADO e a base seguia APPROVED,
    // entao o CMV do mes continuava lendo um inventario que nao existe mais.
    expect(cancelamentoDeveCancelarBase("APPROVED")).toBe(true);
  });

  test("inventario sem base nao tenta cancelar nada", () => {
    expect(cancelamentoDeveCancelarBase(null)).toBe(false);
  });

  test("base ja cancelada nao e recancelada", () => {
    // Recancelar sobrescreveria motivo e data do cancelamento original.
    expect(cancelamentoDeveCancelarBase("CANCELLED")).toBe(false);
  });
});

describe("reaberturaDeveSoltarBase", () => {
  test("reabrir depois de cancelar solta o ponteiro", () => {
    expect(reaberturaDeveSoltarBase("CANCELLED")).toBe(true);
  });

  test("reabrir um REJEITADO mantem a base viva vinculada", () => {
    // Rejeitado nunca gerou cancelamento: a base continua valendo.
    expect(reaberturaDeveSoltarBase("APPROVED")).toBe(false);
    expect(reaberturaDeveSoltarBase(null)).toBe(false);
  });
});

describe("podeReaproveitarBase", () => {
  test("aprovar duas vezes reaproveita a base viva em vez de duplicar", () => {
    expect(podeReaproveitarBase("APPROVED")).toBe(true);
  });

  test("base cancelada NAO e reaproveitada", () => {
    // Se fosse, aprovar devolveria a base cancelada e o inventario terminaria
    // aprovado sem base viva — pior que a duplicacao que a trava evita.
    expect(podeReaproveitarBase("CANCELLED")).toBe(false);
  });
});

describe("o ciclo inteiro fecha", () => {
  test("aprovar - cancelar - reabrir - aprovar termina com base nova", () => {
    // 1. Inventario aprovado gerou a base.
    let base: string | null = "APPROVED";
    expect(podeReaproveitarBase(base)).toBe(true);

    // 2. Cancelamento derruba a base.
    expect(cancelamentoDeveCancelarBase(base)).toBe(true);
    base = "CANCELLED";

    // 3. Reabertura solta o ponteiro.
    expect(reaberturaDeveSoltarBase(base)).toBe(true);
    base = null;

    // 4. Nova aprovacao nao tem o que reaproveitar: gera base nova.
    expect(podeReaproveitarBase(base)).toBe(false);
  });

  test("cancelar duas vezes seguidas nao mexe na base de novo", () => {
    expect(cancelamentoDeveCancelarBase("APPROVED")).toBe(true);
    expect(cancelamentoDeveCancelarBase("CANCELLED")).toBe(false);
  });

  test("nenhum status vivo escapa por engano", () => {
    // Qualquer status que nao seja CANCELLED mantem a base em pe. Se um status
    // novo surgir no schema, ele entra como vivo — e a decisao passa a ser
    // explicita aqui, em vez de silenciosa.
    for (const status of ["ACTIVE", "APPROVED", "DRAFT", "QUALQUER_COISA"]) {
      expect(baseEstaViva(status)).toBe(true);
      expect(cancelamentoDeveCancelarBase(status)).toBe(true);
      expect(reaberturaDeveSoltarBase(status)).toBe(false);
    }
  });
});
