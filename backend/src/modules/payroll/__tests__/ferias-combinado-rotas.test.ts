import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn() }));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../ferias-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ferias-combinado.service.js")>()),
  somarCombinadoAFerias: vi.fn(),
}));

import { userHasPermission } from "../../security/menu-permissions.js";
import { getSessionUser } from "../../security/security-utils.js";
import { RecusaFerias, somarCombinadoAFerias } from "../ferias-combinado.service.js";
import { feriasCombinadoRouter } from "../ferias-combinado.routes.js";

const app = express();
app.use(express.json());
app.use("/payroll/ferias/combinado", feriasCombinadoRouter);
const enviar = (corpo: Record<string, unknown>) => request(app).post("/payroll/ferias/combinado").send(corpo);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: {} } as never);
});

describe("POST /payroll/ferias/combinado", () => {
  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await enviar({ payrollItemId: "f1" })).status).toBe(401);
  });

  test("sem permissão de ver Funcionários: 403 e nada é calculado (combinado e gorjeta são dado de salário)", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await enviar({ payrollItemId: "f1", aplicar: true });
    expect(r.status).toBe(403);
    expect(somarCombinadoAFerias).not.toHaveBeenCalled();
    expect(vi.mocked(userHasPermission).mock.calls[0].slice(1)).toEqual(["employees", "view"]);
  });

  test("sem título: 400", async () => {
    expect((await enviar({})).status).toBe(400);
  });

  test("gorjetasInformadas que não é objeto: 400", async () => {
    expect((await enviar({ payrollItemId: "f1", gorjetasInformadas: [1] })).status).toBe(400);
  });

  test("prévia por padrão: aplicar só vale com true literal", async () => {
    await enviar({ payrollItemId: "f1", aplicar: "true" });
    expect(vi.mocked(somarCombinadoAFerias).mock.calls[0][0]).toMatchObject({ payrollItemId: "f1", aplicar: false });
    await enviar({ payrollItemId: "f1", aplicar: true, gorjetasInformadas: { "2026-03": 100 } });
    expect(vi.mocked(somarCombinadoAFerias).mock.calls[1][0]).toMatchObject({ aplicar: true, informadas: { "2026-03": 100 } });
  });

  test("recusa do serviço vira o status e a mensagem", async () => {
    vi.mocked(somarCombinadoAFerias).mockRejectedValue(new RecusaFerias(409, "já foi pago"));
    const r = await enviar({ payrollItemId: "f1", aplicar: true });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("já foi pago");
  });
});
