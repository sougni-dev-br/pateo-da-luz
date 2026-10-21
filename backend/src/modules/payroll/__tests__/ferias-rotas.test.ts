import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Programação de férias: período e prazo vêm da data de registro; a rota só grava o que a
// casa decidiu. Banco de mentira; "hoje" fixo em 15/10/2026.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findMany: vi.fn(), findFirst: vi.fn() },
    feriasProgramacao: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    feriasSolicitacao: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  // A transação roda o callback com o mesmo banco de mentira (o FOR UPDATE é só uma consulta).
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../extras-comum.js", () => ({ hojeEmSaoPaulo: () => "2026-10-15" }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { carregarFerias, contarAlertas, feriasRouter, montarPessoa } from "../ferias.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/ferias", feriasRouter);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const eliana = (extra: Record<string, unknown> = {}) => ({
  id: "e1", firstName: "Eliana", lastName: "Souza", displayName: null,
  admissionDate: d("2025-03-01"), admissaoCarteira: null, company: { tradeName: "Pateo" },
  feriasProgramadas: [], feriasRegistradas: [], ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  db.employee.findFirst.mockResolvedValue(eliana());
  db.employee.findMany.mockResolvedValue([eliana()]);
  db.feriasProgramacao.create.mockResolvedValue({ id: "f1" });
});

describe("GET /payroll/ferias", () => {
  test("lista só quem tem data-base e separa quem está sem data", async () => {
    db.employee.findMany.mockResolvedValue([eliana(), eliana({ id: "e2", firstName: "Sem", admissionDate: null })]);
    const r = await request(app).get("/payroll/ferias");
    expect(r.status).toBe(200);
    expect(r.body.hoje).toBe("2026-10-15");
    expect(r.body.pessoas).toHaveLength(1);
    expect(r.body.semDataDeAdmissao).toEqual([{ employeeId: "e2", nome: "Sem Souza" }]);
    expect(r.body.pessoas[0].periodos[0].limiteInicioGozo).toBe("2027-01-30");
  });

  test("a data de registro em carteira vale mais que a admissão", () => {
    const p = montarPessoa(eliana({ admissaoCarteira: d("2025-06-01") }) as never, "2026-10-15");
    expect(p.admissao).toBe("2025-06-01");
    expect(p.periodos[0].limiteInicioGozo).toBe("2027-05-02");
  });

  test("contarAlertas separa vencidas de a vencer", () => {
    const vencida = montarPessoa(eliana() as never, "2027-02-10");
    const aVencer = montarPessoa(eliana() as never, "2026-12-15");
    expect(contarAlertas([vencida])).toEqual({ vencidas: 1, aVencer: 0 });
    expect(contarAlertas([aVencer])).toEqual({ vencidas: 0, aVencer: 1 });
  });
});

describe("POST /payroll/ferias", () => {
  const corpo = { employeeId: "e1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", dias: 30 };

  test("sem sessão recusa", async () => {
    (getSessionUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await request(app).post("/payroll/ferias").send(corpo)).status).toBe(401);
  });

  test("programa e audita", async () => {
    const r = await request(app).post("/payroll/ferias").send(corpo);
    expect(r.status).toBe(201);
    expect(db.feriasProgramacao.create.mock.calls[0][0].data).toMatchObject({ employeeId: "e1", dias: 30, status: "PROGRAMADA", createdById: "u1" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "SCHEDULE_VACATION", entityId: "f1" }));
  });

  test("recusa período que ainda está sendo adquirido", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ admissionDate: d("2026-08-01") }));
    const r = await request(app).post("/payroll/ferias").send({ ...corpo, aquisitivoInicio: "2026-08-01", gozoInicio: "2026-12-01" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/ainda não terminou/);
  });

  test("recusa início de gozo antes do fim do aquisitivo", async () => {
    const r = await request(app).post("/payroll/ferias").send({ ...corpo, gozoInicio: "2026-02-01" });
    expect(r.status).toBe(400);
  });

  test("recusa mais dias do que o período tem a programar", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasProgramadas: [{ id: "x", aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-11-01"), dias: 20, diasAbono: 0, status: "PROGRAMADA", observacao: null }],
    }));
    const r = await request(app).post("/payroll/ferias").send({ ...corpo, dias: 15 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/10 dia/);
  });

  test("abono de até 10 dias soma ao total", async () => {
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, dias: 20, diasAbono: 10 })).status).toBe(201);
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, dias: 20, diasAbono: 11 })).status).toBe(400);
  });

  test("recusa período inventado, parte curta demais, data impossível e dias fracionados", async () => {
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, aquisitivoInicio: "2025-04-01" })).status).toBe(400);
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, dias: 3 })).status).toBe(400);
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, gozoInicio: "2026-02-31" })).status).toBe(400);
    expect((await request(app).post("/payroll/ferias").send({ ...corpo, dias: 10.5 })).status).toBe(400);
    expect(db.feriasProgramacao.create).not.toHaveBeenCalled();
  });

  test("período que a ficha de registro já mostra como gozado não aceita nova programação", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasRegistradas: [{ aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-04-01"), gozoFim: d("2026-04-30") }],
    }));
    const r = await request(app).post("/payroll/ferias").send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/ficha de registro/);
  });

  test("funcionário que não é CLT ativo dá 404", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/payroll/ferias").send(corpo)).status).toBe(404);
  });
});

describe("POST /payroll/ferias — sobreposição e gozada no futuro", () => {
  const outra = { id: "x", aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-12-01"), dias: 15, diasAbono: 0, status: "PROGRAMADA", observacao: null };
  test("recusa datas que batem com outras férias da pessoa", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [outra] }));
    const r = await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-10", dias: 15 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/batem com outras férias/);
    const ok = await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-16", dias: 15 });
    expect(ok.status).toBe(201);
  });
  test("recusa marcar como gozadas férias que ainda não começaram", async () => {
    const r = await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", dias: 30, status: "GOZADA" });
    expect(r.status).toBe(400);
  });
});

describe("POST /payroll/ferias — regras de divisão e prazo", () => {
  const base = { employeeId: "e1", aquisitivoInicio: "2025-03-01" };
  const parte = (id: string, inicio: string, dias: number) => ({ id, aquisitivoInicio: d("2025-03-01"), gozoInicio: d(inicio), dias, diasAbono: 0, status: "PROGRAMADA", observacao: null });

  test("trava a linha do funcionário antes de gravar", async () => {
    await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 30 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  test("não deixa sobrar menos de 5 dias", async () => {
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 26 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Sobrariam 4 dias/);
  });
  test("aceita parte menor que 5 dias só quando é tudo o que sobra", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [parte("x", "2026-11-01", 26)] }));
    const ok = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-10", dias: 4 });
    expect(ok.status).toBe(201);
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [parte("x", "2026-11-01", 20)] }));
    const sobra = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-10", dias: 4 });
    expect(sobra.status).toBe(400);
  });
  test("no máximo 3 partes", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [parte("a", "2026-11-01", 14), parte("b", "2026-12-01", 5), parte("c", "2027-01-05", 5)] }));
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2027-02-01", dias: 6 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no máximo 3 partes/);
  });
  test("ao dividir, uma das partes precisa ter 14 dias", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [parte("a", "2026-11-01", 10)] }));
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-10", dias: 20 });
    expect(r.status).toBe(201);
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [parte("a", "2026-11-01", 15), parte("b", "2026-12-20", 5)] }));
    const ok = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2027-01-20", dias: 10 });
    expect(ok.status).toBe(201);
  });
  test("recusa data de início a mais de 2 anos e situação inválida", async () => {
    expect((await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "9999-12-31", dias: 30 })).status).toBe(400);
    expect((await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 30, status: "CANCELADA" })).status).toBe(400);
  });
  test("ficha com gozo parcial abate só os dias dela; o resto continua programável", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasRegistradas: [{ aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-04-01"), gozoFim: d("2026-04-10"), abonoInicio: null, abonoFim: null }],
    }));
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 20 });
    expect(r.status).toBe(201);
    const demais = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 30 });
    expect(demais.status).toBe(400);
  });
  test("ficha sem datas de gozo não quita o período", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasRegistradas: [{ aquisitivoInicio: d("2025-03-01"), gozoInicio: null, gozoFim: null, abonoInicio: null, abonoFim: null }],
    }));
    expect((await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-01", dias: 30 })).status).toBe(201);
  });
});

describe("POST /payroll/ferias — já gozado, sem datas", () => {
  test("quita o saldo do período como GOZADA, sem data de início", async () => {
    const r = await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2025-03-01", semDatas: true });
    expect(r.status).toBe(201);
    expect(db.feriasProgramacao.create.mock.calls[0][0].data).toMatchObject({ gozoInicio: null, dias: 30, status: "GOZADA", diasAbono: 0 });
  });
  test("recusa período sem saldo e período em aquisição", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasProgramadas: [{ id: "x", aquisitivoInicio: d("2025-03-01"), gozoInicio: null, dias: 30, diasAbono: 0, status: "GOZADA", observacao: null }],
    }));
    expect((await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2025-03-01", semDatas: true })).status).toBe(400);
    db.employee.findFirst.mockResolvedValue(eliana({ admissionDate: d("2026-08-01") }));
    expect((await request(app).post("/payroll/ferias").send({ employeeId: "e1", aquisitivoInicio: "2026-08-01", semDatas: true })).status).toBe(400);
  });
});

describe("PATCH e DELETE /payroll/ferias/:id", () => {
  const gravada = { id: "f1", employeeId: "e1", aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-10-01"), dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null };

  test("marcar como gozada não conta os próprios dias duas vezes", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [gravada] }));
    const r = await request(app).patch("/payroll/ferias/f1").send({ status: "GOZADA" });
    expect(r.status).toBe(200);
    expect(db.feriasProgramacao.update.mock.calls[0][0].data.status).toBe("GOZADA");
  });

  test("editar datas ignora a própria linha e o histórico da ficha que chegou depois", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    db.employee.findFirst.mockResolvedValue(eliana({
      feriasProgramadas: [gravada],
      feriasRegistradas: [{ aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-04-01"), gozoFim: d("2026-04-30"), abonoInicio: null, abonoFim: null }],
    }));
    const r = await request(app).patch("/payroll/ferias/f1").send({ status: "GOZADA" });
    expect(r.status).toBe(200);
  });

  test("PATCH com situação inválida é recusado", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [gravada] }));
    expect((await request(app).patch("/payroll/ferias/f1").send({ status: "CANCELADA" })).status).toBe(400);
    expect(db.feriasProgramacao.update).not.toHaveBeenCalled();
  });

  test("programação inexistente dá 404", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(null);
    expect((await request(app).patch("/payroll/ferias/zz").send({ status: "GOZADA" })).status).toBe(404);
    expect((await request(app).delete("/payroll/ferias/zz")).status).toBe(404);
  });

  test("cancelar remove e audita", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    const r = await request(app).delete("/payroll/ferias/f1");
    expect(r.status).toBe(200);
    expect(db.feriasProgramacao.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCEL_VACATION" }));
  });
});

describe("dias vedados para começar as férias", () => {
  const base = { employeeId: "e1", aquisitivoInicio: "2025-03-01", dias: 30 };

  test("recusa início em sábado, domingo, feriado e nos 2 dias antes de feriado", async () => {
    for (const gozoInicio of ["2026-12-05", "2026-12-06", "2026-11-20", "2026-12-23"]) {
      const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio });
      expect(r.status, gozoInicio).toBe(400);
      expect(r.body.message).toMatch(/não podem começar em/);
    }
    expect(db.feriasProgramacao.create).not.toHaveBeenCalled();
  });

  test("aceita segunda-feira comum", async () => {
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-07" });
    expect(r.status).toBe(201);
  });

  test("férias já gozadas (histórico) não passam pela regra", async () => {
    const r = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-08-08", dias: 30, status: "GOZADA" });
    expect(r.status).toBe(201);
  });

  test("a lista traz os feriados e o setor de cada pessoa", async () => {
    db.employee.findMany.mockResolvedValue([eliana({ sector: "Cozinha" })]);
    const r = await request(app).get("/payroll/ferias");
    expect(r.body.pessoas[0].setor).toBe("Cozinha");
    expect(r.body.feriados["2026-12-25"]).toBe("Natal");
  });
});

describe("repouso lido da escala", () => {
  const tercas = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"].map(d);
  const base = { employeeId: "e1", aquisitivoInicio: "2025-03-01", dias: 30 };

  test("quem folga às terças pode começar no sábado, mas não na segunda", async () => {
    db.employee.findFirst.mockResolvedValue(eliana({ scheduleDays: tercas.map((date) => ({ date })) }));
    const ok = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-05" }); // sábado
    expect(ok.status).toBe(201);
    const nao = await request(app).post("/payroll/ferias").send({ ...base, gozoInicio: "2026-12-07" }); // segunda: 1 dia antes do repouso
    expect(nao.status).toBe(400);
    expect(nao.body.message).toMatch(/repouso semanal/);
  });

  test("a lista informa o repouso e se veio da escala", async () => {
    db.employee.findMany.mockResolvedValue([eliana({ scheduleDays: tercas.map((date) => ({ date })) }), eliana({ id: "e3" })]);
    const r = await request(app).get("/payroll/ferias");
    expect(r.body.pessoas[0]).toMatchObject({ repousoSemanal: [2], repousoPelaEscala: true });
    expect(r.body.pessoas[1]).toMatchObject({ repousoSemanal: [0], repousoPelaEscala: false });
  });
});

describe("carregarFerias sem a escala (Dashboard)", () => {
  test("só lê as folgas quando a escala é pedida", async () => {
    await carregarFerias("2026-10-15");
    expect(db.employee.findMany.mock.calls[0][0].select.scheduleDays).toBeDefined();
    db.employee.findMany.mockClear();
    const pessoas = await carregarFerias("2026-10-15", { comEscala: false });
    expect(db.employee.findMany.mock.calls[0][0].select.scheduleDays).toBeUndefined();
    expect(pessoas[0].repousoSemanal).toEqual([0]); // sem escala, o repouso é o padrão
  });
});

describe("aviso por escrito das datas (avisado)", () => {
  const gravada = { id: "f1", employeeId: "e1", aquisitivoInicio: d("2025-03-01"), gozoInicio: d("2026-12-07"), dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, avisadoEm: null, avisadoPorId: null };

  test("marcar grava a data e quem marcou, e audita", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    const r = await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: true });
    expect(r.status).toBe(200);
    const dados = db.feriasProgramacao.update.mock.calls[0][0].data;
    expect(dados.avisadoEm).toBeInstanceOf(Date);
    expect(dados.avisadoPorId).toBe("u1");
    expect(r.body.avisadoEm).toEqual(expect.any(String));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "NOTIFY_VACATION", entityId: "f1" }));
  });

  test("marcar de novo não troca a data nem quem marcou", async () => {
    const antes = new Date("2026-10-01T12:00:00.000Z");
    db.feriasProgramacao.findUnique.mockResolvedValue({ ...gravada, avisadoEm: antes, avisadoPorId: "u9" });
    await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: true });
    const dados = db.feriasProgramacao.update.mock.calls[0][0].data;
    expect(dados.avisadoEm).toBe(antes);
    expect(dados.avisadoPorId).toBe("u9");
  });

  test("desmarcar limpa a data e quem marcou", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue({ ...gravada, avisadoEm: new Date(), avisadoPorId: "u9" });
    const r = await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: false });
    expect(r.status).toBe(200);
    expect(db.feriasProgramacao.update.mock.calls[0][0].data).toEqual({ avisadoEm: null, avisadoPorId: null });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UNDO_NOTIFY_VACATION" }));
  });

  test("recusa corpo sem avisado, férias já gozadas e programação inexistente", async () => {
    db.feriasProgramacao.findUnique.mockResolvedValue(gravada);
    expect((await request(app).post("/payroll/ferias/f1/avisado").send({})).status).toBe(400);
    expect((await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: "sim" })).status).toBe(400);
    db.feriasProgramacao.findUnique.mockResolvedValue({ ...gravada, status: "GOZADA" });
    expect((await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: true })).status).toBe(400);
    db.feriasProgramacao.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/payroll/ferias/zz/avisado").send({ avisado: true })).status).toBe(404);
    expect(db.feriasProgramacao.update).not.toHaveBeenCalled();
  });

  test("sem sessão é 401", async () => {
    (getSessionUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await request(app).post("/payroll/ferias/f1/avisado").send({ avisado: true })).status).toBe(401);
  });

  test("mudar a data apaga o aviso; mudar só a observação mantém", async () => {
    const avisada = { ...gravada, avisadoEm: new Date("2026-10-01T12:00:00.000Z"), avisadoPorId: "u9" };
    db.feriasProgramacao.findUnique.mockResolvedValue(avisada);
    db.employee.findFirst.mockResolvedValue(eliana({ feriasProgramadas: [avisada] }));
    await request(app).patch("/payroll/ferias/f1").send({ gozoInicio: "2026-12-14" });
    expect(db.feriasProgramacao.update.mock.calls[0][0].data).toMatchObject({ avisadoEm: null, avisadoPorId: null });
    db.feriasProgramacao.update.mockClear();
    await request(app).patch("/payroll/ferias/f1").send({ observacao: "combinado por telefone" });
    expect(db.feriasProgramacao.update.mock.calls[0][0].data).not.toHaveProperty("avisadoEm");
  });

  test("a lista devolve o aviso de cada programação", async () => {
    const avisada = { ...gravada, avisadoEm: new Date("2026-10-01T12:00:00.000Z") };
    db.employee.findMany.mockResolvedValue([eliana({ feriasProgramadas: [avisada] })]);
    const r = await request(app).get("/payroll/ferias");
    expect(r.body.pessoas[0].periodos[0].programacoes[0].avisadoEm).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("pedido do colaborador (solicitação)", () => {
  const pedido = { employeeId: "e1", aquisitivoInicio: "2025-03-01", inicio: "2026-12-14", dias: 15, diasAbono: 0, observacao: "  quer passar o Natal em família  " };
  const gravado = { id: "s1", employeeId: "e1", aquisitivoInicio: d("2025-03-01"), inicio: d("2026-12-14"), dias: 15, diasAbono: 0, observacao: "quer passar o Natal em família", createdAt: new Date("2026-10-20T12:00:00.000Z") };

  beforeEach(() => {
    db.feriasSolicitacao.findUnique.mockResolvedValue(null);
    db.feriasSolicitacao.upsert.mockResolvedValue(gravado);
  });

  test("registra o pedido (201), limpa a observação e audita", async () => {
    const r = await request(app).put("/payroll/ferias/solicitacao").send(pedido);
    expect(r.status).toBe(201);
    const arg = db.feriasSolicitacao.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ employeeId: "e1", dias: 15, diasAbono: 0, observacao: "quer passar o Natal em família", createdById: "u1" });
    expect(arg.where.employeeId_aquisitivoInicio.employeeId).toBe("e1");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTER_VACATION_REQUEST", entityId: "s1" }));
  });

  test("trocar um pedido que já existe devolve 200 e audita a mudança com o valor anterior", async () => {
    db.feriasSolicitacao.findUnique.mockResolvedValue(gravado);
    const r = await request(app).put("/payroll/ferias/solicitacao").send({ ...pedido, inicio: "2027-01-11" });
    expect(r.status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE_VACATION_REQUEST", previousValue: expect.objectContaining({ inicio: "2026-12-14" }) }));
  });

  test("o pedido não passa pela regra de dia vedado: sábado, só o que a pessoa pediu", async () => {
    const r = await request(app).put("/payroll/ferias/solicitacao").send({ ...pedido, inicio: "2026-12-12" }); // sábado
    expect(r.status).toBe(201);
  });

  test("recusa pedido antes do fim do aquisitivo, período em aquisição, 31 dias, abono demais e data inválida", async () => {
    const manda = (extra: Record<string, unknown>) => request(app).put("/payroll/ferias/solicitacao").send({ ...pedido, ...extra });
    expect((await manda({ inicio: "2026-02-01" })).status).toBe(400);
    expect((await manda({ aquisitivoInicio: "2026-03-01" })).status).toBe(400); // período ainda em aquisição ou inexistente
    expect((await manda({ dias: 31 })).status).toBe(400);
    expect((await manda({ dias: 25, diasAbono: 10 })).status).toBe(400); // 35 dias no total
    expect((await manda({ diasAbono: 11 })).status).toBe(400);
    expect((await manda({ inicio: "2026-02-31" })).status).toBe(400);
    expect((await manda({ inicio: "9999-12-31" })).status).toBe(400);
    expect(db.feriasSolicitacao.upsert).not.toHaveBeenCalled();
  });

  test("sem sessão é 401 e sem funcionário é 400", async () => {
    expect((await request(app).put("/payroll/ferias/solicitacao").send({ ...pedido, employeeId: "" })).status).toBe(400);
    (getSessionUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await request(app).put("/payroll/ferias/solicitacao").send(pedido)).status).toBe(401);
  });

  test("retirar o pedido remove e audita; pedido inexistente é 404", async () => {
    db.feriasSolicitacao.findUnique.mockResolvedValue(gravado);
    const r = await request(app).delete("/payroll/ferias/solicitacao/s1");
    expect(r.status).toBe(200);
    expect(db.feriasSolicitacao.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCEL_VACATION_REQUEST" }));
    db.feriasSolicitacao.findUnique.mockResolvedValue(null);
    expect((await request(app).delete("/payroll/ferias/solicitacao/zz")).status).toBe(404);
  });

  test("a lista devolve o pedido dentro do período certo, com o último dia", async () => {
    db.employee.findMany.mockResolvedValue([eliana({ feriasSolicitadas: [gravado] })]);
    const r = await request(app).get("/payroll/ferias");
    expect(r.body.pessoas[0].periodos[0].solicitacao).toEqual({
      id: "s1", inicio: "2026-12-14", fim: "2026-12-28", dias: 15, diasAbono: 0, observacao: "quer passar o Natal em família", registradaEm: "2026-10-20T12:00:00.000Z",
    });
  });

  test("período sem pedido vem com solicitacao nula", async () => {
    const r = await request(app).get("/payroll/ferias");
    expect(r.body.pessoas[0].periodos[0].solicitacao).toBeNull();
  });
});
