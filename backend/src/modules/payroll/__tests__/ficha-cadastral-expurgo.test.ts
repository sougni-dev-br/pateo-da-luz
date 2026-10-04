import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { fichaCadastral: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog } from "../../security/security-utils.js";
import { DIAS_GUARDA, expurgarFichas } from "../ficha-cadastral-expurgo.js";

const db = prisma as unknown as { fichaCadastral: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> } };
const AGORA = new Date("2026-10-04T12:00:00Z");

describe("expurgo das fichas canceladas e vencidas", () => {
  beforeEach(() => vi.clearAllMocks());

  test("apaga canceladas e vencidas há mais de 90 dias; concluída e enviada ao RH ficam", async () => {
    db.fichaCadastral.findMany.mockResolvedValue([{ id: "f1", status: "CANCELADA" }, { id: "f2", status: "ENVIADA" }, { id: "f3", status: "PREENCHENDO" }]);
    db.fichaCadastral.deleteMany.mockResolvedValue({ count: 3 });
    expect(await expurgarFichas(AGORA)).toBe(3);
    const limite = new Date(AGORA.getTime() - DIAS_GUARDA * 86_400_000);
    expect(limite.toISOString().slice(0, 10)).toBe("2026-07-06");
    const filtro = {
      OR: [
        { status: "CANCELADA", canceladaEm: { lt: limite } },
        { status: { in: ["ENVIADA", "PREENCHENDO"] }, expiraEm: { lt: limite } },
      ],
    };
    expect(db.fichaCadastral.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: filtro }));
    expect(db.fichaCadastral.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["f1", "f2", "f3"] }, ...filtro } });
    expect(JSON.stringify(filtro)).not.toMatch(/FINALIZADA|CONCLUIDA/);
    const registro = vi.mocked(auditLog).mock.calls[0][0];
    expect(registro).toMatchObject({ action: "FICHA_CADASTRAL_EXPURGO", newValue: { apagadas: 3, ids: ["f1", "f2", "f3"], canceladas: 1, vencidas: 2, prazoDias: 90 } });
    expect(Object.keys(registro.newValue as object)).toEqual(["apagadas", "ids", "canceladas", "vencidas", "prazoDias", "antesDe"]);
  });

  test("nada para apagar: não apaga nem registra", async () => {
    db.fichaCadastral.findMany.mockResolvedValue([]);
    expect(await expurgarFichas(AGORA)).toBe(0);
    expect(db.fichaCadastral.deleteMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
