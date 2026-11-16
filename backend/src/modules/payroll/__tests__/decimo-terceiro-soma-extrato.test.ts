import { beforeEach, describe, expect, test, vi } from "vitest";

// Soma da diferença do salário combinado ao título do 13º do extrato. Dados FICTÍCIOS (repo público).
vi.mock("../../../config/database.js", () => ({
  prisma: { payrollItem: { findMany: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));

import { prisma } from "../../../config/database.js";
import { foiSomado, liquidoDoExtrato, semMarcasDoCombinado, valorComCombinado } from "../decimo-terceiro-combinado.js";
import { somarCombinadoAoExtrato } from "../decimo-terceiro-combinado.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const item = (over: Record<string, unknown> = {}) => ({
  id: "i1", employeeId: "e1", amount: 2000, details: { liquido: 2000, calculo: "DECIMO_TERCEIRO" },
  employee: { firstName: "Ana", lastName: "Silva" }, ...over,
});

describe("regras puras da soma", () => {
  test("valor integral = líquido do extrato + diferença, com a composição à vista", () => {
    const r = valorComCombinado(2000, 500.5);
    expect(r.valor).toBe(2500.5);
    expect(r.detalhes).toMatchObject({ liquidoExtrato: 2000, complemento: 500.5, origemValor: "DECIMO_COMBINADO" });
    expect(r.detalhes.composicao).toContain("2.500,50");
  });
  test("o líquido do extrato sobrevive à soma (liquidoExtrato) e vem de liquido quando ainda não foi somado", () => {
    expect(liquidoDoExtrato({ liquido: 1800 })).toBe(1800);
    expect(liquidoDoExtrato({ liquido: 1800, liquidoExtrato: 1700 })).toBe(1700);
    expect(liquidoDoExtrato({})).toBeNull();
    expect(liquidoDoExtrato(null)).toBeNull();
  });
  test("reconhece o somado e limpa só as marcas da soma", () => {
    const somado = { liquido: 2000, empresa: "X", ...valorComCombinado(2000, 500).detalhes };
    expect(foiSomado(somado)).toBe(true);
    expect(foiSomado({ liquido: 2000 })).toBe(false);
    expect(semMarcasDoCombinado(somado)).toEqual({ liquido: 2000, empresa: "X" });
  });
});

describe("somarCombinadoAoExtrato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
  });

  test("soma a diferença ao título em aberto e guarda o líquido nos detalhes", async () => {
    db.payrollItem.findMany.mockResolvedValue([item()]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toEqual([{ employeeId: "e1", nome: "Ana Silva", antes: 2000, depois: 2573 }]);
    const { data, where } = db.payrollItem.updateMany.mock.calls[0][0];
    expect(data.amount).toBe(2573);
    expect(data.details).toMatchObject({ liquido: 2000, liquidoExtrato: 2000, complemento: 573, origemValor: "DECIMO_COMBINADO" });
    // Só grava se ninguém pagou ou excluiu no meio.
    expect(where).toMatchObject({ id: "i1", deletedAt: null, paymentDate: null });
  });

  test("só olha título em aberto, ativo e da 1ª parcela do extrato", async () => {
    db.payrollItem.findMany.mockResolvedValue([]);
    await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(db.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({
      type: "DECIMO_TERCEIRO", competenceYear: 2026, periodLabel: "13º Salário - 1ª parcela (extrato)", deletedAt: null, paymentDate: null,
    });
  });

  test("rodar de novo com a diferença já somada não grava nada", async () => {
    const somado = valorComCombinado(2000, 573);
    db.payrollItem.findMany.mockResolvedValue([item({ amount: somado.valor, details: { liquido: 2000, ...somado.detalhes } })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toHaveLength(0);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("a diferença mudou: o título é refeito a partir do líquido do extrato, sem somar duas vezes", async () => {
    const somado = valorComCombinado(2000, 573);
    db.payrollItem.findMany.mockResolvedValue([item({ amount: somado.valor, details: { liquido: 2000, ...somado.detalhes } })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 600]]), "u1");
    expect(r.alterados[0]).toMatchObject({ antes: 2573, depois: 2600 });
  });

  test("quem não tem mais diferença volta ao líquido do extrato", async () => {
    const somado = valorComCombinado(2000, 573);
    db.payrollItem.findMany.mockResolvedValue([item({ amount: somado.valor, details: { liquido: 2000, ...somado.detalhes } })]);
    const r = await somarCombinadoAoExtrato(2026, new Map(), "u1");
    expect(r.alterados[0]).toMatchObject({ antes: 2573, depois: 2000 });
    expect(db.payrollItem.updateMany.mock.calls[0][0].data.details).toEqual({ liquido: 2000 });
  });

  test("quem não tem combinado e nunca foi somado não é tocado", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ employeeId: "e2" })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toHaveLength(0);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("título ajustado à mão no Contas a Pagar (valor diferente do líquido do extrato): não é sobrescrito e avisa", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ amount: 1950 })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toHaveLength(0);
    expect(r.avisos[0]).toContain("ajustado à mão");
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("título somado e depois ajustado à mão: também não é sobrescrito", async () => {
    const somado = valorComCombinado(2000, 573);
    db.payrollItem.findMany.mockResolvedValue([item({ amount: 2400, details: { liquido: 2000, ...somado.detalhes } })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 600]]), "u1");
    expect(r.alterados).toHaveLength(0);
    expect(r.avisos[0]).toContain("ajustado à mão");
  });

  test("o jsonb devolve as chaves em outra ordem: rodar de novo continua sem gravar nem auditar", async () => {
    const somado = valorComCombinado(2000, 573);
    const reordenado = Object.fromEntries(Object.entries({ liquido: 2000, ...somado.detalhes }).reverse());
    db.payrollItem.findMany.mockResolvedValue([item({ amount: somado.valor, details: reordenado })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toHaveLength(0);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("título sem o líquido guardado: avisa e não grava", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ details: {} })]);
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.avisos[0]).toContain("Ana Silva");
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("alguém pagou no meio (updateMany não casa): não conta como alterado", async () => {
    db.payrollItem.findMany.mockResolvedValue([item()]);
    db.payrollItem.updateMany.mockResolvedValue({ count: 0 });
    const r = await somarCombinadoAoExtrato(2026, new Map([["e1", 573]]), "u1");
    expect(r.alterados).toHaveLength(0);
  });
});
