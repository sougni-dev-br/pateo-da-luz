import { beforeEach, describe, expect, test, vi } from "vitest";

// O sync do PDV pula o dia em periodo TRAVADO e reporta. Um erro qualquer (banco fora,
// timeout) NAO e trava: tem que falhar o sync inteiro para o agente tentar de novo, e nao
// aparecer como "periodo fechado" com o faturamento do dia sem gravar.
vi.mock("../../../../config/database.js", () => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    agileSaleItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    agileSale: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) }
  };
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)), __tx: tx };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({ auditLog: vi.fn() }));
vi.mock("../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { assertPeriodWritableForDate } from "../../../cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../../../cmv-real/period-locked-error.js";
import { auditLog } from "../../../security/security-utils.js";
import { importAgileSync } from "../agile-sync.service.js";
import { agileSyncPayloadSchema } from "../agile-sync.types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const travada = vi.mocked(assertPeriodWritableForDate);

const venda = (nr: string, dia: string) => ({
  nrseqvenda: nr, dt_movimento: dia, turno: "Almoço", situacao_da_venda: "RECEBIDA", qtd_pessoas: 2, vl_total: 100, vl_servico_inf: 10
});
const payload = () =>
  agileSyncPayloadSchema.parse({
    periodoInicio: "2026-08-19",
    periodoFim: "2026-08-20",
    vendas: [venda("1", "2026-08-19"), venda("2", "2026-08-20")],
    pagamentos: [],
    itens: []
  });

const ehDia = (d: Date, iso: string) => d.toISOString().slice(0, 10) === iso;

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
});

describe("importAgileSync — trava de periodo", () => {
  test("sem trava: grava os dois dias e nao avisa de periodo", async () => {
    const r = await importAgileSync(payload());
    expect(r.diasImportados).toBe(2);
    expect(r.avisos.join(" ")).not.toMatch(/periodo fechado/);
    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "AGILE_SYNC_BLOCKED_BY_PERIOD_LOCK" }));
  });

  test("dia em periodo TRAVADO de verdade: e pulado, reportado e auditado; o outro dia grava", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-19")) throw new PeriodLockedError("Sincronizacao do Agile PDV bloqueado: o fechamento mensal de 08/2026 esta travado.");
    });
    const r = await importAgileSync(payload());
    expect(r.diasImportados).toBe(1);
    expect(r.avisos.join(" ")).toContain("1 dia(s) nao gravado(s) por periodo fechado/mes travado: 2026-08-19");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AGILE_SYNC_BLOCKED_BY_PERIOD_LOCK" }));
  });

  test("erro de banco ao checar a trava NAO e trava: o sync falha inteiro e nada e gravado", async () => {
    const falha = new Error("Can't reach database server at dpg-x:5432");
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-20")) throw falha;
    });
    await expect(importAgileSync(payload())).rejects.toBe(falha);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.__tx.$executeRaw).not.toHaveBeenCalled();
  });

  test("erro de banco nao gera o alerta falso de 'periodo fechado' na auditoria", async () => {
    travada.mockRejectedValue(new Error("timeout"));
    await expect(importAgileSync(payload())).rejects.toThrow("timeout");
    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "AGILE_SYNC_BLOCKED_BY_PERIOD_LOCK" }));
  });

  test("trava num dia e erro de banco em outro: o erro vence, o sync falha e nada e auditado como trava", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-19")) throw new PeriodLockedError("travado");
      throw new Error("connection reset");
    });
    await expect(importAgileSync(payload())).rejects.toThrow("connection reset");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "AGILE_SYNC_BLOCKED_BY_PERIOD_LOCK" }));
  });

  test("falha na checagem da trava nao deixa auditoria de venda fora do salao (o agente vai tentar de novo)", async () => {
    travada.mockRejectedValue(new Error("timeout"));
    const comViagem = agileSyncPayloadSchema.parse({
      periodoInicio: "2026-08-19", periodoFim: "2026-08-19",
      vendas: [venda("1", "2026-08-19"), { ...venda("2", "2026-08-19"), modo_venda: "viagem" }], pagamentos: [], itens: []
    });
    await expect(importAgileSync(comViagem)).rejects.toThrow("timeout");
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("erro generico no PRIMEIRO dia tambem derruba o sync (nao so no ultimo)", async () => {
    travada.mockRejectedValueOnce(new Error("connection reset"));
    await expect(importAgileSync(payload())).rejects.toThrow("connection reset");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
