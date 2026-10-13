import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    wasteSettings: { findUnique: vi.fn(), updateMany: vi.fn() },
    wasteEntry: { findMany: vi.fn() },
    inventorySector: { findMany: vi.fn() },
  },
}));
vi.mock("../../notifications/whatsapp.service.js", () => ({ sendWhatsAppText: vi.fn() }));
vi.mock("../../notifications/recipients.service.js", () => ({ listActivePhones: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { listActivePhones } from "../../notifications/recipients.service.js";
import { sendWhatsAppText } from "../../notifications/whatsapp.service.js";
import { avisarSePassouDoLimite } from "../waste-alert.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const HOJE = "2026-10-14";
const entrada = (totalCost: number, reason = "EXPIRED") => ({ productId: "p1", dishId: null, reason, sectorId: null, totalCost, product: { name: "Salmão" }, dish: null });

beforeEach(() => {
  vi.clearAllMocks();
  db.wasteSettings.findUnique.mockResolvedValue({ dailyAlertValue: 500, lastAlertDay: null });
  db.wasteSettings.updateMany.mockResolvedValue({ count: 1 });
  db.wasteEntry.findMany.mockResolvedValue([entrada(400), entrada(200)]);
  db.inventorySector.findMany.mockResolvedValue([]);
  vi.mocked(listActivePhones).mockResolvedValue([{ id: "r1", name: "Eli", phone: "5511999999999" }, { id: "r2", name: "Gestor", phone: "5511888888888" }]);
  vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true } as never);
});

describe("avisarSePassouDoLimite", () => {
  test("passou do limite: reserva o dia e avisa todos os destinatários", async () => {
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("ENVIADO");
    expect(db.wasteSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastAlertDay: new Date(`${HOJE}T00:00:00.000Z`) } }));
    expect(sendWhatsAppText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1]).toMatch(/limite/);
  });

  test("sem limite configurado não consulta lançamentos nem envia", async () => {
    db.wasteSettings.findUnique.mockResolvedValue(null);
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("NAO_PRECISA");
    expect(db.wasteEntry.findMany).not.toHaveBeenCalled();
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  test("abaixo do limite não avisa", async () => {
    db.wasteEntry.findMany.mockResolvedValue([entrada(100)]);
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("NAO_PRECISA");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  test("já avisou hoje: não repete", async () => {
    db.wasteSettings.findUnique.mockResolvedValue({ dailyAlertValue: 500, lastAlertDay: new Date(`${HOJE}T00:00:00Z`) });
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("NAO_PRECISA");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    // E nem relê o dia inteiro a cada lançamento só para concluir que não precisa.
    expect(db.wasteEntry.findMany).not.toHaveBeenCalled();
  });

  test("perdeu a corrida da reserva para outro lançamento: não envia", async () => {
    db.wasteSettings.updateMany.mockResolvedValue({ count: 0 });
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("NAO_PRECISA");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  test("ninguém recebeu: devolve a reserva para o próximo lançamento tentar de novo", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, skipped: true, reason: "desconectado" } as never);
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("SEM_DESTINATARIO");
    expect(db.wasteSettings.updateMany).toHaveBeenLastCalledWith({ where: { id: "singleton", lastAlertDay: new Date(`${HOJE}T00:00:00.000Z`) }, data: { lastAlertDay: null } });
  });

  test("um destinatário que falha não impede os outros nem desfaz o aviso", async () => {
    vi.mocked(sendWhatsAppText).mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce({ ok: true } as never);
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("ENVIADO");
    expect(db.wasteSettings.updateMany).toHaveBeenCalledTimes(1);
  });

  test("falha depois da reserva (ex.: banco caiu ao buscar destinatários) devolve o dia e propaga o erro", async () => {
    vi.mocked(listActivePhones).mockRejectedValue(new Error("banco fora"));
    await expect(avisarSePassouDoLimite(HOJE, HOJE)).rejects.toThrow("banco fora");
    expect(db.wasteSettings.updateMany).toHaveBeenLastCalledWith({ where: { id: "singleton", lastAlertDay: new Date(`${HOJE}T00:00:00.000Z`) }, data: { lastAlertDay: null } });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  test("sem destinatário cadastrado também devolve a reserva", async () => {
    vi.mocked(listActivePhones).mockResolvedValue([]);
    expect(await avisarSePassouDoLimite(HOJE, HOJE)).toBe("SEM_DESTINATARIO");
    expect(db.wasteSettings.updateMany).toHaveBeenCalledTimes(2);
  });
});
