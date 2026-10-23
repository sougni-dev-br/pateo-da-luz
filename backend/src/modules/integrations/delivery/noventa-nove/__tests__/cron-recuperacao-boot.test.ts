import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// O agendamento das 04:00 é um setTimeout em memória; um restart/deploy perto do horário engole a rodada.
// No boot, o cron confere o último sync do CRON concluído em SUCCESS e recupera a rodada se ela foi perdida.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    noventaNoveSyncLog: { findFirst: vi.fn() },
    deliveryStore: { count: vi.fn() }
  }
}));
vi.mock("../noventa-nove-http-client.js", () => ({ hasValidCredential: vi.fn() }));
vi.mock("../noventa-nove-menu.service.js", () => ({ importarCardapios: vi.fn() }));
vi.mock("../noventa-nove.service.js", () => ({ isSyncInFlight: vi.fn(), runSmartSyncGuarded: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import { hasValidCredential } from "../noventa-nove-http-client.js";
import { importarCardapios } from "../noventa-nove-menu.service.js";
import { isSyncInFlight, runSmartSyncGuarded } from "../noventa-nove.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const RECUPERACAO_MS = 2 * 60 * 1000 + 1_000;
// 12:00 BRT: o 04:00 de hoje (07:00Z) já passou, e o próximo está 16h à frente.
const AGORA = "2026-10-22T15:00:00Z";

async function subirCron() {
  // `timer` do módulo é estado global: cada teste precisa de uma instância nova.
  vi.resetModules();
  const { startNoventaNoveCronScheduler } = await import("../noventa-nove-cron.service.js");
  startNoventaNoveCronScheduler();
  await vi.advanceTimersByTimeAsync(RECUPERACAO_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AGORA));
  vi.clearAllMocks();
  vi.stubEnv("NOVENTA_NOVE_CRON_ENABLED", "true");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(hasValidCredential).mockResolvedValue(true);
  db.deliveryStore.count.mockResolvedValue(1);
  vi.mocked(isSyncInFlight).mockReturnValue(false);
  vi.mocked(runSmartSyncGuarded).mockResolvedValue({
    mode: "REAL",
    real: { ranAt: AGORA, hasCredential: true, perStore: [], totalPersisted: 0 },
    log: null
  });
  vi.mocked(importarCardapios).mockResolvedValue({ perStore: [] } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("recuperação da rodada no boot", () => {
  test("só considera rodada do cron (sem usuário) concluída com SUCCESS", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue({ finishedAt: new Date("2026-10-22T08:00:00Z") });
    await subirCron();

    expect(db.noventaNoveSyncLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { syncType: "REAL", status: "SUCCESS", triggeredByUserId: null, finishedAt: { not: null } }
      })
    );
  });

  test("última rodada anterior ao 04:00 de hoje: recupera (sync do mês + cardápio)", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue({ finishedAt: new Date("2026-10-21T07:05:00Z") });
    await subirCron();

    expect(runSmartSyncGuarded).toHaveBeenCalledWith(null, 2026, 10);
    expect(importarCardapios).toHaveBeenCalledTimes(1);
  });

  test("nunca rodou: recupera", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue(null);
    await subirCron();

    expect(runSmartSyncGuarded).toHaveBeenCalledTimes(1);
  });

  test("rodada de hoje já concluída: restart não repete o sync", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue({ finishedAt: new Date("2026-10-22T07:04:00Z") });
    await subirCron();

    expect(runSmartSyncGuarded).not.toHaveBeenCalled();
  });

  test("cron desligado (ambiente local): nem consulta o banco", async () => {
    vi.stubEnv("NOVENTA_NOVE_CRON_ENABLED", "false");
    await subirCron();

    expect(db.noventaNoveSyncLog.findFirst).not.toHaveBeenCalled();
    expect(runSmartSyncGuarded).not.toHaveBeenCalled();
  });

  test("sync já em andamento: a recuperação pula em vez de enfileirar atrás dele", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue(null);
    vi.mocked(isSyncInFlight).mockReturnValue(true);
    await subirCron();

    expect(runSmartSyncGuarded).not.toHaveBeenCalled();
  });

  test("loja que falhou depois dos retries vira console.error, não só 'N persistidos'", async () => {
    db.noventaNoveSyncLog.findFirst.mockResolvedValue(null);
    vi.mocked(runSmartSyncGuarded).mockResolvedValue({
      mode: "REAL",
      real: {
        ranAt: AGORA,
        hasCredential: true,
        totalPersisted: 0,
        perStore: [
          {
            storeId: "s1",
            storeLabel: "Loja fictícia",
            externalId: "LOJA-FICTICIA",
            status: "PARTIAL",
            itemsPersisted: { sales: 0, settlements: 0, fees: 0 },
            message: "Falhas parciais: billData: 99 Food retornou 429"
          }
        ]
      },
      log: null
    });
    await subirCron();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Loja fictícia: Falhas parciais: billData"));
  });
});
