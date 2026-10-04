import { beforeEach, describe, expect, test, vi } from "vitest";

// O comportamento real (o que sai e o que fica, cascata das fotos, anonimização) é conferido contra
// o Postgres; aqui fica a orquestração: escolha do lote, arquivos antes da cascata, registro.
const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
vi.mock("../../../config/database.js", () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));

import { prisma } from "../../../config/database.js";
import { DIAS_GUARDA, expurgarFichas } from "../ficha-cadastral-expurgo.js";

const AGORA = new Date("2026-10-04T12:00:00Z");
const sql = (m: ReturnType<typeof vi.fn>, i: number) => (m.mock.calls[i][0] as TemplateStringsArray).join("?");

/** Um lote: ids escolhidos, arquivos dessas fichas e o que o DELETE devolveu. */
function lote(escolhidas: string[], arquivos: Array<{ id: string; fichaId: string }>, apagadas: Array<{ id: string; status: string }>) {
  tx.$queryRaw
    .mockResolvedValueOnce(escolhidas.map((id) => ({ id })))
    .mockResolvedValueOnce(arquivos)
    .mockResolvedValueOnce(apagadas);
}

describe("expurgo das fichas canceladas e vencidas", () => {
  beforeEach(() => vi.clearAllMocks());

  test("escolhe travando, guarda os arquivos antes da cascata, apaga e anonimiza pelo índice", async () => {
    lote(["f1", "f2"], [{ id: "a1", fichaId: "f1" }], [{ id: "f1", status: "CANCELADA" }, { id: "f2", status: "ENVIADA" }]);
    expect(await expurgarFichas(AGORA)).toBe(2);
    const escolha = sql(tx.$queryRaw, 0);
    expect(escolha).toContain("FOR UPDATE SKIP LOCKED");
    expect(escolha).not.toMatch(/FINALIZADA|CONCLUIDA/);
    expect(tx.$queryRaw.mock.calls[0][1]).toEqual(new Date(AGORA.getTime() - DIAS_GUARDA * 86_400_000));
    expect(sql(tx.$queryRaw, 1)).toContain(`FROM "FichaCadastralArquivo"`);
    const del = sql(tx.$queryRaw, 2);
    expect(del).toContain(`DELETE FROM "FichaCadastral"`);
    expect(del).toContain("RETURNING id");
    // Anonimização: fichas e arquivos pelo entityId (índice), não por JSON.
    expect(sql(tx.$executeRaw, 0)).not.toContain("->>");
    expect(tx.$executeRaw.mock.calls[0]).toContainEqual(["f1", "f2"]);
    expect(tx.$executeRaw.mock.calls[0]).toContainEqual(["a1"]);
    const registro = JSON.parse(tx.$executeRaw.mock.calls[1][2] as string);
    expect(registro).toEqual({ apagadas: 2, ids: ["f1", "f2"], canceladas: 1, vencidas: 1, prazoDias: 90, antesDe: "2026-07-06T12:00:00.000Z" });
  });

  test("ficha renovada entre a escolha e o DELETE: não conta, e o arquivo dela não é anonimizado", async () => {
    lote(["f1", "f2"], [{ id: "a2", fichaId: "f2" }], [{ id: "f1", status: "CANCELADA" }]);
    expect(await expurgarFichas(AGORA)).toBe(1);
    expect(tx.$executeRaw.mock.calls[0]).toContainEqual([]);
  });

  test("lote cheio: continua até esvaziar; prazo da transação maior que o padrão", async () => {
    const cem = Array.from({ length: 100 }, (_, i) => `f${i}`);
    lote(cem, [], cem.map((id) => ({ id, status: "ENVIADA" })));
    lote(["x"], [], [{ id: "x", status: "CANCELADA" }]);
    expect(await expurgarFichas(AGORA)).toBe(101);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toMatchObject({ timeout: 120_000 });
  });

  test("nada para apagar: não anonimiza nem registra", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await expurgarFichas(AGORA)).toBe(0);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  test("falha no registro: o erro sobe para a transação (que desfaz o lote)", async () => {
    lote(["f1"], [], [{ id: "f1", status: "CANCELADA" }]);
    tx.$executeRaw.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("sem conexão"));
    await expect(expurgarFichas(AGORA)).rejects.toThrow("sem conexão");
  });
});
