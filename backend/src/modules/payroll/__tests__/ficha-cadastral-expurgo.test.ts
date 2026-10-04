import { beforeEach, describe, expect, test, vi } from "vitest";

// O comportamento real (o que sai e o que fica, cascata das fotos) é conferido contra o Postgres;
// aqui fica a orquestração: lotes, anonimização, registro e tudo-ou-nada.
const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
vi.mock("../../../config/database.js", () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));

import { prisma } from "../../../config/database.js";
import { DIAS_GUARDA, expurgarFichas } from "../ficha-cadastral-expurgo.js";

const AGORA = new Date("2026-10-04T12:00:00Z");
const sql = (m: ReturnType<typeof vi.fn>, i: number) => (m.mock.calls[i][0] as TemplateStringsArray).join("?");

describe("expurgo das fichas canceladas e vencidas", () => {
  beforeEach(() => vi.clearAllMocks());

  test("apaga, anonimiza a auditoria antiga e registra só ids e contagens, na mesma transação", async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: "f1", status: "CANCELADA" }, { id: "f2", status: "ENVIADA" }]);
    expect(await expurgarFichas(AGORA)).toBe(2);
    const del = sql(tx.$queryRaw, 0);
    expect(del).toContain(`DELETE FROM "FichaCadastral"`);
    expect(del).toContain("status = 'CANCELADA' AND \"canceladaEm\" < ?");
    expect(del).toContain("status IN ('ENVIADA', 'PREENCHENDO') AND \"expiraEm\" < ?");
    expect(del).not.toMatch(/FINALIZADA|CONCLUIDA/);
    expect(del).toContain("RETURNING id");
    expect(tx.$queryRaw.mock.calls[0][1]).toEqual(new Date(AGORA.getTime() - DIAS_GUARDA * 86_400_000));
    expect(sql(tx.$executeRaw, 0)).toContain(`UPDATE "AuditLog"`);
    expect(tx.$executeRaw.mock.calls[0]).toContainEqual(["f1", "f2"]);
    expect(sql(tx.$executeRaw, 1)).toContain("FICHA_CADASTRAL_EXPURGO");
    const registro = JSON.parse(tx.$executeRaw.mock.calls[1][2] as string);
    expect(registro).toEqual({ apagadas: 2, ids: ["f1", "f2"], canceladas: 1, vencidas: 1, prazoDias: 90, antesDe: "2026-07-06T12:00:00.000Z" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test("lote cheio: continua até esvaziar", async () => {
    const cheio = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, status: "ENVIADA" }));
    tx.$queryRaw.mockResolvedValueOnce(cheio).mockResolvedValueOnce([{ id: "x", status: "CANCELADA" }]);
    expect(await expurgarFichas(AGORA)).toBe(101);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  test("nada para apagar: não anonimiza nem registra", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await expurgarFichas(AGORA)).toBe(0);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  test("falha no registro desfaz o lote (o erro sobe para a transação)", async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: "f1", status: "CANCELADA" }]);
    tx.$executeRaw.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("sem conexão"));
    await expect(expurgarFichas(AGORA)).rejects.toThrow("sem conexão");
  });
});
