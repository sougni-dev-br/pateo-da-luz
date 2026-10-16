import { describe, expect, test } from "vitest";
import { podeArquivarContagem, podeDesarquivarContagem } from "../contagem-arquivada.js";

describe("podeArquivarContagem", () => {
  test("contagem concluída sem inventário pode ser arquivada", () => {
    expect(podeArquivarContagem({ status: "CONCLUIDA", generatedInventoryId: null, generatedInventoryStatus: null })).toBe(true);
  });

  test("contagem cujo inventário foi cancelado também pode", () => {
    expect(podeArquivarContagem({ status: "CONCLUIDA", generatedInventoryId: "inv", generatedInventoryStatus: "CANCELADO" })).toBe(true);
  });

  test("contagem que gerou inventário ativo não pode: ela já tem destino", () => {
    expect(podeArquivarContagem({ status: "CONCLUIDA", generatedInventoryId: "inv", generatedInventoryStatus: "APROVADO" })).toBe(false);
  });

  test("só a concluída arquiva: aberta, em andamento, cancelada e já arquivada não", () => {
    for (const status of ["ABERTA", "EM_ANDAMENTO", "CANCELADA", "ARQUIVADA"]) {
      expect(podeArquivarContagem({ status, generatedInventoryId: null, generatedInventoryStatus: null })).toBe(false);
    }
  });
});

describe("podeDesarquivarContagem", () => {
  test("só a arquivada volta", () => {
    expect(podeDesarquivarContagem({ status: "ARQUIVADA" })).toBe(true);
    expect(podeDesarquivarContagem({ status: "CONCLUIDA" })).toBe(false);
    expect(podeDesarquivarContagem({ status: "CANCELADA" })).toBe(false);
  });
});
