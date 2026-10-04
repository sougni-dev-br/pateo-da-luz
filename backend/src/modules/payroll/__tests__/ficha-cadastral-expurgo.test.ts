import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { fichaCadastral: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog } from "../../security/security-utils.js";
import { DIAS_GUARDA_CANCELADA, expurgarFichasCanceladas } from "../ficha-cadastral-expurgo.js";

const db = prisma as unknown as { fichaCadastral: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> } };
const AGORA = new Date("2026-10-04T12:00:00Z");

describe("expurgo das fichas canceladas", () => {
  beforeEach(() => vi.clearAllMocks());

  test("apaga só as canceladas há mais de 90 dias e registra sem dado pessoal", async () => {
    db.fichaCadastral.findMany.mockResolvedValue([{ id: "f1" }, { id: "f2" }]);
    db.fichaCadastral.deleteMany.mockResolvedValue({ count: 2 });
    expect(await expurgarFichasCanceladas(AGORA)).toBe(2);
    const limite = new Date(AGORA.getTime() - DIAS_GUARDA_CANCELADA * 86_400_000);
    expect(limite.toISOString().slice(0, 10)).toBe("2026-07-06");
    const filtro = { status: "CANCELADA", canceladaEm: { lt: limite } };
    expect(db.fichaCadastral.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: filtro }));
    expect(db.fichaCadastral.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["f1", "f2"] }, ...filtro } });
    const registro = vi.mocked(auditLog).mock.calls[0][0];
    expect(registro).toMatchObject({ action: "FICHA_CADASTRAL_EXPURGO", newValue: { apagadas: 2, ids: ["f1", "f2"], prazoDias: 90 } });
    expect(Object.keys(registro.newValue as object)).toEqual(["apagadas", "ids", "prazoDias", "canceladasAntesDe"]);
  });

  test("nada vencido: não apaga nem registra", async () => {
    db.fichaCadastral.findMany.mockResolvedValue([]);
    expect(await expurgarFichasCanceladas(AGORA)).toBe(0);
    expect(db.fichaCadastral.deleteMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
