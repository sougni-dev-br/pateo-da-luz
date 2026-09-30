import { beforeEach, describe, expect, test, vi } from "vitest";
import { executarBackfill, linhasDoAudit, type RegistroAuditoria } from "../cadastro-historico-backfill.js";

// Backfill do histórico do cadastro a partir da auditoria: simulação não grava, CPF nunca
// sai da auditoria, e rodar de novo não duplica.
const CPF = "52998224725";
const cadastro = (over: Record<string, unknown>) => ({
  id: "e1", cpf: CPF, firstName: "Ana", baseSalary: "2200", modality: "NAO_CLT", position: "Garçom", companyId: null,
  salarioCombinado: null, recebeAdiantamento: false, pixKey: CPF, ...over,
});
const audit = (id: string, action: string, prev: unknown, novo: unknown, em = "2026-07-18T23:30:00Z"): RegistroAuditoria => ({
  id, action, entityId: "e1", userId: "u1", previousValue: prev, newValue: novo, createdAt: new Date(em),
});

const AUDITS = [
  audit("a1", "UPDATE_EMPLOYEE", cadastro({}), cadastro({ baseSalary: "2500", modality: "CLT" })),
  audit("a2", "UPDATE_SALARIO_COMBINADO", { valor: null, motivo: null }, { valor: 5200, motivo: "acima do registrado" }, "2026-09-29T00:29:00Z"),
  audit("a3", "TERMINATE_EMPLOYEE", cadastro({}), cadastro({ terminationDate: "2026-09-12" })),
];

function banco(existentes: Array<{ origemRef: string; campo: string }> = [], corte: Date | null = null) {
  return {
    auditLog: { findMany: vi.fn(async () => AUDITS) },
    employee: { findMany: vi.fn(async () => [{ id: "e1" }]) },
    user: { findMany: vi.fn(async () => [{ id: "u1", name: "Eli" }]) },
    employeeHistorico: {
      findFirst: vi.fn(async () => (corte ? { createdAt: corte } : null)),
      findMany: vi.fn(async () => existentes),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
  };
}

describe("linhas a partir da auditoria", () => {
  test("uma por campo rastreado que mudou; vigente desde o dia em São Paulo; sem CPF", () => {
    const linhas = linhasDoAudit(AUDITS[0]);
    expect(linhas.map((l) => [l.campo, l.valorAnterior, l.valorNovo])).toEqual([
      ["baseSalary", "2200.00", "2500.00"], ["modality", "NAO_CLT", "CLT"],
    ]);
    // 18/07 23:30 UTC = 18/07 20:30 em São Paulo.
    expect(linhas[0].vigenteDesde).toEqual(new Date("2026-07-18T00:00:00Z"));
    expect(JSON.stringify(linhas)).not.toContain(CPF);
  });
  test("salário combinado vem do formato { valor, motivo }, com o motivo", () => {
    const [l] = linhasDoAudit(AUDITS[1]);
    expect(l).toMatchObject({ campo: "salarioCombinado", valorAnterior: null, valorNovo: "5200.00" });
    expect(l.motivo).toContain("acima do registrado");
    // 29/09 00:29 UTC ainda é 28/09 em São Paulo.
    expect(l.vigenteDesde).toEqual(new Date("2026-09-28T00:00:00Z"));
  });
  test("desligamento sem mudança nos campos rastreados e campo novo que a auditoria antiga não tinha: nada", () => {
    expect(linhasDoAudit(AUDITS[2])).toEqual([]);
    const semCampo = { ...cadastro({}) } as Record<string, unknown>;
    delete semCampo.recebeAdiantamento;
    expect(linhasDoAudit(audit("a4", "UPDATE_EMPLOYEE", semCampo, cadastro({ recebeAdiantamento: true })))).toEqual([]);
  });
  test("criação não é mudança", () => {
    expect(linhasDoAudit(audit("a5", "CREATE_EMPLOYEE", null, cadastro({})))).toEqual([]);
  });
});

describe("executar", () => {
  beforeEach(() => vi.clearAllMocks());

  test("simulação calcula e não grava nada", async () => {
    const db = banco();
    const r = await executarBackfill(db as never, { aplicar: false });
    expect(r.novas).toHaveLength(3);
    expect(r.gravadas).toBe(0);
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("aplicar grava com origem BACKFILL, o id da auditoria e o nome de quem alterou", async () => {
    const db = banco();
    const r = await executarBackfill(db as never, { aplicar: true });
    expect(r.gravadas).toBe(3);
    const { data, skipDuplicates } = db.employeeHistorico.createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>>; skipDuplicates: boolean };
    expect(skipDuplicates).toBe(true);
    expect(data[0]).toMatchObject({ origem: "BACKFILL", origemRef: "a1", criadoPorNome: "Eli", createdAt: new Date("2026-07-18T23:30:00Z") });
    expect(JSON.stringify(data)).not.toContain(CPF);
  });

  test("rodar de novo não duplica: o que já existe fica de fora", async () => {
    const db = banco([{ origemRef: "a1", campo: "baseSalary" }, { origemRef: "a1", campo: "modality" }, { origemRef: "a2", campo: "salarioCombinado" }]);
    const r = await executarBackfill(db as never, { aplicar: true });
    expect(r.novas).toHaveLength(0);
    expect(r.jaExistiam).toBe(3);
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("com o histórico já sendo gravado pelo sistema, só lê a auditoria de antes disso", async () => {
    const corte = new Date("2026-10-01T10:00:00Z");
    const db = banco([], corte);
    await executarBackfill(db as never, { aplicar: false });
    expect(db.auditLog.findMany.mock.calls[0][0]).toMatchObject({ where: { createdAt: { lt: corte } } });
  });
});
