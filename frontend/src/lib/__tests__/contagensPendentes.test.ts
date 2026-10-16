import { describe, expect, test } from "vitest";
import { contarContagensPendentes } from "../contagensPendentes";

const sessao = (over: Partial<{ status: string; generatedInventoryId: string | null; source: string | null; linkedSnapshotId: string | null }> = {}) => ({
  status: "CONCLUIDA", generatedInventoryId: null, source: "SISTEMA", linkedSnapshotId: null, ...over
});

describe("contarContagensPendentes", () => {
  test("conta a contagem concluída do sistema que ainda não gerou inventário", () => {
    expect(contarContagensPendentes([sessao()])).toBe(1);
  });

  test("não conta contagem que já gerou inventário", () => {
    expect(contarContagensPendentes([sessao({ generatedInventoryId: "inv1" })])).toBe(0);
  });

  test("não conta contagem importada da planilha: ela já tem inventário próprio e nunca gera outro", () => {
    expect(contarContagensPendentes([sessao({ source: "IMPORTACAO_PLANILHA" })])).toBe(0);
    expect(contarContagensPendentes([sessao({ linkedSnapshotId: "snap1" })])).toBe(0);
  });

  test("não conta contagem aberta nem cancelada", () => {
    expect(contarContagensPendentes([sessao({ status: "ABERTA" }), sessao({ status: "CANCELADA" })])).toBe(0);
  });

  test("soma só as que valem", () => {
    expect(contarContagensPendentes([sessao(), sessao(), sessao({ source: "IMPORTACAO_PLANILHA" }), sessao({ generatedInventoryId: "x" })])).toBe(2);
  });
});
