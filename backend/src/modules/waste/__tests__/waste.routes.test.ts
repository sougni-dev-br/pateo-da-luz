import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    product: { findUnique: vi.fn(), findMany: vi.fn() },
    dish: { findMany: vi.fn() },
    wasteEntry: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    inventorySector: { findMany: vi.fn() },
    wasteSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));
vi.mock("../../dishes/dish-detail.js", () => ({ carregarDetalhe: vi.fn() }));
vi.mock("../waste-alert.service.js", () => ({ avisarSePassouDoLimite: vi.fn() }));
vi.mock("../../notifications/recipients.service.js", () => ({ listActivePhones: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { todayInSaoPaulo } from "../../buffet-plates/buffet-prints.routes.js";
import { carregarDetalhe } from "../../dishes/dish-detail.js";
import { listActivePhones } from "../../notifications/recipients.service.js";
import { avisarSePassouDoLimite } from "../waste-alert.service.js";
import { wasteRouter } from "../waste.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/waste", wasteRouter);

const hoje = todayInSaoPaulo();
const produto = { id: "p1", isActive: true, name: "Salmão fresco", unit: "KG", unitMeasure: { code: "KG" }, inventorySectorId: "s1", conversions: [] as Array<{ fromUnit: string; toUnit: string; factor: number }> };
const lancamento = { productId: "p1", quantity: "2,5", reason: "EXPIRED", occurredOn: hoje, notes: "" };

function entradaGravada(data: Record<string, unknown>) {
  return {
    ...data,
    product: { name: "Salmão", externalCode: "001" },
    createdAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
  };
}

let podeVerCusto = true;
beforeEach(() => {
  vi.clearAllMocks();
  podeVerCusto = true;
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "ESTOQUISTA" } as never);
  vi.mocked(userHasPermission).mockImplementation(async () => podeVerCusto);
  db.product.findUnique.mockResolvedValue(produto);
  db.inventorySector.findMany.mockResolvedValue([{ id: "s1", name: "Câmara fria" }]);
  db.$queryRaw.mockResolvedValue([{ ultima: 40, ultimaData: new Date("2026-10-01"), base: null, baseAno: null, baseMes: null }]);
  vi.mocked(avisarSePassouDoLimite).mockResolvedValue("NAO_PRECISA");
  db.wasteEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => entradaGravada(data));
});

describe("POST /waste", () => {
  test("grava com o custo do servidor e ignora valor mandado pelo cliente", async () => {
    const r = await request(app).post("/waste").send({ ...lancamento, unitCost: 1, totalCost: 1 });
    expect(r.status).toBe(201);
    const data = db.wasteEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ productId: "p1", quantity: 2.5, unit: "KG", reason: "EXPIRED", sectorId: "s1", unitCost: 40, totalCost: 100, registeredById: "u1" });
    expect(data.costSource).toMatch(/ULTIMA_COMPRA/);
    expect(r.body).toMatchObject({ totalCost: 100, sectorName: "Câmara fria" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_WASTE_ENTRY", userId: "u1" }));
  });

  test("quem não vê custo lança normalmente e não recebe valor de volta", async () => {
    podeVerCusto = false;
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create.mock.calls[0][0].data.totalCost).toBe(100);
    expect(r.body).not.toHaveProperty("totalCost");
    expect(r.body).not.toHaveProperty("unitCost");
  });

  test("produto sem custo conhecido fica sem valor, não R$ 0,00", async () => {
    db.$queryRaw.mockResolvedValue([{ ultima: null, ultimaData: null, base: null, baseAno: null, baseMes: null }]);
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ unitCost: null, totalCost: null, costSource: null });
  });

  test.each([
    [{ quantity: "0" }, /quantidade/i],
    [{ reason: "ROUBO" }, /motivo/i],
    [{ occurredOn: "2999-01-01" }, /futura/i],
    [{ reason: "OTHER", notes: "" }, /observa/i],
  ])("recusa lançamento inválido %j", async (parcial, mensagem) => {
    const r = await request(app).post("/waste").send({ ...lancamento, ...parcial });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(mensagem);
    expect(db.wasteEntry.create).not.toHaveBeenCalled();
  });

  test("produto inativo ou inexistente", async () => {
    db.product.findUnique.mockResolvedValue({ ...produto, isActive: false });
    expect((await request(app).post("/waste").send(lancamento)).status).toBe(404);
    db.product.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/waste").send(lancamento)).status).toBe(404);
  });

  test("sem sessão devolve 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).post("/waste").send(lancamento)).status).toBe(401);
  });
});

describe("GET /waste", () => {
  const gravada = entradaGravada({
    id: "w1", productId: "p1", quantity: 2.5, unit: "KG", reason: "EXPIRED", occurredOn: new Date(`${hoje}T00:00:00Z`),
    sectorId: "s1", unitCost: 40, totalCost: 100, costSource: "ULTIMA_COMPRA", notes: null, registeredById: "u1",
  });

  test("lista com valores para quem vê custo", async () => {
    db.wasteEntry.findMany.mockResolvedValue([gravada]);
    const r = await request(app).get("/waste");
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ id: "w1", reasonLabel: "Vencido", totalCost: 100, occurredOn: hoje });
  });

  test("remove os campos de custo quando a permissão é negada", async () => {
    podeVerCusto = false;
    db.wasteEntry.findMany.mockResolvedValue([gravada]);
    const r = await request(app).get("/waste");
    expect(r.body.items[0]).not.toHaveProperty("totalCost");
    expect(r.body.items[0]).not.toHaveProperty("unitCost");
    expect(r.body.items[0]).not.toHaveProperty("costSource");
  });

  test.each([["from=2026-13-01"], ["from=2026-10-10&to=2026-10-01"], ["from=2020-01-01&to=2026-10-01"], ["reason=ROUBO"]])(
    "recusa consulta inválida %s",
    async (consulta) => {
      const r = await request(app).get(`/waste?${consulta}`);
      expect(r.status).toBe(400);
    },
  );
});

describe("GET /waste/summary", () => {
  const linha = (extra: Record<string, unknown>) => entradaGravada({ productId: "p1", reason: "EXPIRED", sectorId: "s1", totalCost: 100, ...extra });

  test("soma por motivo e produto", async () => {
    db.wasteEntry.findMany.mockResolvedValue([linha({}), linha({ reason: "SPOILED", totalCost: 50 })]);
    const r = await request(app).get("/waste/summary");
    expect(r.body.total).toEqual({ lancamentos: 2, valor: 150, semCusto: 0 });
    expect(r.body.porProduto[0]).toMatchObject({ nome: "Salmão", valor: 150 });
    expect(db.wasteEntry.findMany.mock.calls[0][0].where.cancelledAt).toBeNull();
  });

  test("sem permissão de custo devolve só contagens", async () => {
    podeVerCusto = false;
    db.wasteEntry.findMany.mockResolvedValue([linha({}), linha({ reason: "SPOILED", totalCost: 50 })]);
    const r = await request(app).get("/waste/summary");
    expect(r.body.total).toEqual({ lancamentos: 2, valor: null, semCusto: 0 });
    expect(r.body.porMotivo.every((g: { valor: unknown; semCusto: number }) => g.valor === null && g.semCusto === 0)).toBe(true);
  });
});

describe("POST /waste/:id/cancel", () => {
  test("cancela e audita", async () => {
    db.wasteEntry.findUnique.mockResolvedValue({ id: "w1", cancelledAt: null });
    db.wasteEntry.updateMany.mockResolvedValue({ count: 1 });
    const r = await request(app).post("/waste/w1/cancel").send({ reason: "lancei duas vezes" });
    expect(r.status).toBe(200);
    expect(db.wasteEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "w1", cancelledAt: null },
      data: expect.objectContaining({ cancelledById: "u1", cancelReason: "lancei duas vezes" }),
    }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCEL_WASTE_ENTRY" }));
  });

  test("exige motivo", async () => {
    expect((await request(app).post("/waste/w1/cancel").send({ reason: " " })).status).toBe(400);
    expect(db.wasteEntry.updateMany).not.toHaveBeenCalled();
  });

  test("inexistente, já cancelado e corrida entre dois cancelamentos", async () => {
    db.wasteEntry.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/waste/x/cancel").send({ reason: "engano" })).status).toBe(404);
    db.wasteEntry.findUnique.mockResolvedValue({ id: "w1", cancelledAt: new Date() });
    expect((await request(app).post("/waste/w1/cancel").send({ reason: "engano" })).status).toBe(409);
    db.wasteEntry.findUnique.mockResolvedValue({ id: "w1", cancelledAt: null });
    db.wasteEntry.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post("/waste/w1/cancel").send({ reason: "engano" })).status).toBe(409);
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("GET /waste/products", () => {
  test("busca curta devolve lista vazia sem consultar o banco", async () => {
    const r = await request(app).get("/waste/products?search=s");
    expect(r.body).toEqual([]);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  test("devolve unidade e setor", async () => {
    db.product.findMany.mockResolvedValue([{ id: "p1", name: "Salmão", externalCode: "001", unit: "KG", unitMeasure: { code: "KG" }, inventorySector: { name: "Câmara fria" }, conversions: [] }]);
    const r = await request(app).get("/waste/products?search=salm");
    expect(r.body).toEqual([{ id: "p1", name: "Salmão", code: "001", unit: "KG", sectorName: "Câmara fria", conversions: [], embalagemInferida: null }]);
  });
});

describe("prato pronto", () => {
  const prato = (extra: Record<string, unknown> = {}) => ({ id: "d1", isActive: true, yieldUnit: "KG", custoPorcao: 25, custoIncompleto: false, ...extra });
  const lancamentoPrato = { dishId: "d1", quantity: "3,2", reason: "PRODUCTION_LEFTOVER", occurredOn: hoje, notes: "" };

  test("grava ao custo da ficha técnica, na unidade de rendimento, sem tocar em produto", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue(prato() as never);
    const r = await request(app).post("/waste").send(lancamentoPrato);

    expect(r.status).toBe(201);
    const data = db.wasteEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ productId: null, dishId: "d1", unit: "KG", sectorId: null, unitCost: 25, totalCost: 80, costSource: "FICHA_TECNICA" });
    expect(db.product.findUnique).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test("ficha com custo incompleto não vira valor parcial", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue(prato({ custoIncompleto: true }) as never);
    const r = await request(app).post("/waste").send(lancamentoPrato);
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ unitCost: null, totalCost: null, costSource: null });
  });

  test("prato inexistente ou inativo", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue(null as never);
    expect((await request(app).post("/waste").send(lancamentoPrato)).status).toBe(404);
    vi.mocked(carregarDetalhe).mockResolvedValue(prato({ isActive: false }) as never);
    expect((await request(app).post("/waste").send(lancamentoPrato)).status).toBe(404);
  });

  test("não aceita insumo e prato juntos", async () => {
    const r = await request(app).post("/waste").send({ ...lancamentoPrato, productId: "p1" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/produto ou o prato/i);
  });

  test("a lista identifica o prato e o setor vira Prato pronto", async () => {
    db.wasteEntry.findMany.mockResolvedValue([{
      id: "w9", productId: null, dishId: "d1", quantity: 3.2, unit: "KG", reason: "PRODUCTION_LEFTOVER", occurredOn: new Date(`${hoje}T00:00:00Z`),
      sectorId: null, unitCost: 25, totalCost: 80, costSource: "FICHA_TECNICA", notes: null, registeredById: "u1", createdAt: new Date(), cancelledAt: null, cancelReason: null,
      product: null, dish: { name: "Lasanha", code: "D01" },
    }]);
    const r = await request(app).get("/waste");
    expect(r.body.items[0]).toMatchObject({ kind: "PRATO", dishId: "d1", productName: "Lasanha", productCode: "D01", sectorName: "Prato pronto", totalCost: 80 });
  });

  test("resumo agrupa o prato em Prato pronto, com chave própria", async () => {
    db.wasteEntry.findMany.mockResolvedValue([{ productId: null, dishId: "d1", reason: "PRODUCTION_LEFTOVER", sectorId: null, totalCost: 80, product: null, dish: { name: "Lasanha", code: null } }]);
    const r = await request(app).get("/waste/summary");
    expect(r.body.porSetor[0]).toMatchObject({ chave: "Prato pronto", valor: 80 });
    expect(r.body.porProduto[0]).toMatchObject({ chave: "dish:d1", nome: "Lasanha" });
  });

  test("busca de pratos exige 2 letras e devolve a unidade de rendimento", async () => {
    expect((await request(app).get("/waste/dishes?search=l")).body).toEqual([]);
    expect(db.dish.findMany).not.toHaveBeenCalled();
    db.dish.findMany.mockResolvedValue([{ id: "d1", name: "Lasanha", code: "D01", yieldUnit: "KG", category: { name: "Massas" } }]);
    const r = await request(app).get("/waste/dishes?search=las");
    expect(r.body).toEqual([{ id: "d1", name: "Lasanha", code: "D01", unit: "KG", sectorName: "Massas", conversions: [], embalagemInferida: null }]);
  });
});

describe("aviso por WhatsApp", () => {
  test("lançamento de hoje com valor dispara a checagem do limite, sem atrasar a resposta", async () => {
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    expect(avisarSePassouDoLimite).toHaveBeenCalledWith(hoje, hoje);
  });

  test("falha no aviso não derruba o registro", async () => {
    vi.mocked(avisarSePassouDoLimite).mockRejectedValue(new Error("whatsapp fora"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    await vi.waitFor(() => expect(erro).toHaveBeenCalled());
    erro.mockRestore();
  });

  test("lançamento sem custo ou de outro dia não consulta o limite", async () => {
    db.$queryRaw.mockResolvedValue([{ ultima: null, ultimaData: null, base: null, baseAno: null, baseMes: null }]);
    await request(app).post("/waste").send(lancamento);
    await request(app).post("/waste").send({ ...lancamento, occurredOn: "2000-01-01" });
    expect(avisarSePassouDoLimite).not.toHaveBeenCalled();
  });
});

describe("configuração do aviso", () => {
  test("lê o limite e quantos destinatários estão ativos", async () => {
    db.wasteSettings.findUnique.mockResolvedValue({ dailyAlertValue: 750 });
    vi.mocked(listActivePhones).mockResolvedValue([{ id: "r1", name: "Eli", phone: "5511999999999" }]);
    const r = await request(app).get("/waste/settings");
    expect(r.body).toEqual({ dailyAlertValue: 750, activeRecipients: 1 });
  });

  test("grava o limite aceitando vírgula e audita", async () => {
    db.wasteSettings.findUnique.mockResolvedValue(null);
    db.wasteSettings.upsert.mockResolvedValue({ dailyAlertValue: 750.5 });
    const r = await request(app).put("/waste/settings").send({ dailyAlertValue: "750,50" });
    expect(r.status).toBe(200);
    expect(db.wasteSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { dailyAlertValue: 750.5 } }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE_WASTE_SETTINGS" }));
  });

  test("vazio desliga o aviso", async () => {
    db.wasteSettings.findUnique.mockResolvedValue({ dailyAlertValue: 500 });
    db.wasteSettings.upsert.mockResolvedValue({ dailyAlertValue: null });
    const r = await request(app).put("/waste/settings").send({ dailyAlertValue: "" });
    expect(r.status).toBe(200);
    expect(db.wasteSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { dailyAlertValue: null } }));
  });

  test.each([["0"], ["0,004"], ["-5"], ["abc"], ["2000000"]])("recusa limite %s", async (valor) => {
    const r = await request(app).put("/waste/settings").send({ dailyAlertValue: valor });
    expect(r.status).toBe(400);
    expect(db.wasteSettings.upsert).not.toHaveBeenCalled();
  });
});

describe("robustez do registro", () => {
  test("falha na auditoria não derruba o lançamento (já gravado) nem convida a repetir", async () => {
    vi.mocked(auditLog).mockRejectedValueOnce(new Error("banco de auditoria fora"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("auditoria"), "banco de auditoria fora");
    erro.mockRestore();
  });

  test("quem não vê custo ainda sabe se o lançamento ficou sem custo (sem ver valor)", async () => {
    podeVerCusto = false;
    db.$queryRaw.mockResolvedValue([{ ultima: null, ultimaData: null, base: null, baseAno: null, baseMes: null }]);
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.body.hasCost).toBe(false);
    expect(r.body).not.toHaveProperty("totalCost");
    db.$queryRaw.mockResolvedValue([{ ultima: 40, ultimaData: new Date("2026-10-01"), base: null, baseAno: null, baseMes: null }]);
    expect((await request(app).post("/waste").send(lancamento)).body.hasCost).toBe(true);
  });

  test("custo absurdo de compra vira lançamento sem custo, não erro 500 de overflow", async () => {
    db.$queryRaw.mockResolvedValue([{ ultima: 5_000_000, ultimaData: new Date("2026-10-01"), base: null, baseAno: null, baseMes: null }]);
    const r = await request(app).post("/waste").send(lancamento);
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create.mock.calls[0][0].data.totalCost).toBeNull();
  });

  const linhas = (n: number) => Array.from({ length: n }, (_, i) => entradaGravada({
    id: `w${i}`, productId: "p1", dishId: null, quantity: 1, unit: "KG", reason: "EXPIRED", occurredOn: new Date(`${hoje}T00:00:00Z`),
    sectorId: null, unitCost: null, totalCost: null, costSource: null, notes: null, registeredById: "u1", photo: null,
    product: { name: "Salmão", externalCode: "1" }, dish: null,
  }));

  test("lista com exatamente 500 não é 'cortada'; com mais de 500 mostra 500 e avisa", async () => {
    db.wasteEntry.findMany.mockResolvedValue(linhas(500));
    const exata = await request(app).get("/waste");
    expect(exata.body.items).toHaveLength(500);
    expect(exata.body.truncated).toBe(false);

    db.wasteEntry.findMany.mockResolvedValue(linhas(501));
    const maior = await request(app).get("/waste");
    expect(maior.body.items).toHaveLength(500);
    expect(maior.body.truncated).toBe(true);
    expect(db.wasteEntry.findMany.mock.calls.at(-1)[0].take).toBe(501);
  });
});

describe("lançar em g, ml, kg...: o servidor converte para a unidade do estoque (como a ficha técnica)", () => {
  // Caso da tela: ARROZ BRANCO T1 CAMIL PACOTE 5KG, estocado em UN. O peso 5 KG é lido do nome.
  const arroz = { ...produto, name: "ARROZ BRANCO T1 CAMIL PACOTE 5KG", unit: "UN", unitMeasure: null, conversions: [] };
  const comArroz = () => db.product.findUnique.mockResolvedValue(arroz);
  const compraEmUn = () => db.$queryRaw.mockResolvedValue([{ ultima: 40, ultimaData: new Date("2026-10-01"), base: null, baseAno: null, baseMes: null }]);

  test("500 g viram 0,1 UN, valem 0,1 × o custo da UN e guardam o que foi digitado", async () => {
    comArroz(); compraEmUn();
    const r = await request(app).post("/waste").send({ ...lancamento, quantity: "500", unit: "G" });

    expect(r.status).toBe(201);
    const data = db.wasteEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ quantity: 0.1, unit: "UN", enteredQuantity: 500, enteredUnit: "G", unitCost: 40, totalCost: 4 });
    expect(r.body).toMatchObject({ quantity: 0.1, unit: "UN", enteredQuantity: 500, enteredUnit: "G" });
  });

  test("2 kg do mesmo pacote de 5 kg são 0,4 UN", async () => {
    comArroz(); compraEmUn();
    await request(app).post("/waste").send({ ...lancamento, quantity: "2", unit: "kg" });
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ quantity: 0.4, enteredQuantity: 2, enteredUnit: "KG" });
  });

  test("na unidade do estoque não há conversão nem 'digitado': fica como antes", async () => {
    comArroz(); compraEmUn();
    await request(app).post("/waste").send({ ...lancamento, quantity: "3", unit: "UN" });
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ quantity: 3, unit: "UN", enteredQuantity: null, enteredUnit: null });
  });

  test("conversão cadastrada no produto vale (1 UN = 1200 G)", async () => {
    db.product.findUnique.mockResolvedValue({ ...arroz, name: "FARINHA ESPECIAL", conversions: [{ fromUnit: "UN", toUnit: "G", factor: 1200 }] });
    compraEmUn();
    await request(app).post("/waste").send({ ...lancamento, quantity: "300", unit: "G" });
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ quantity: 0.25, enteredQuantity: 300, enteredUnit: "G" });
  });

  test("g num produto sem peso cadastrado nem no nome é recusado: não grava 500 UN no lugar de 500 g", async () => {
    db.product.findUnique.mockResolvedValue({ ...arroz, name: "ARROZ SEM EMBALAGEM NO NOME" });
    const r = await request(app).post("/waste").send({ ...lancamento, quantity: "500", unit: "G" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/converter G para UN/);
    expect(db.wasteEntry.create).not.toHaveBeenCalled();
  });

  test("o custo continua sendo o da unidade do estoque, não o da unidade digitada", async () => {
    comArroz(); compraEmUn();
    await request(app).post("/waste").send({ ...lancamento, quantity: "500", unit: "G" });
    // A consulta de custo recebe a unidade do ESTOQUE (UN), não G.
    const chamadas = JSON.stringify(db.$queryRaw.mock.calls[0].slice(1));
    expect(chamadas).toContain("UN");
    expect(chamadas).not.toContain('"G"');
  });

  test("a busca devolve as conversões e de onde veio o peso, para a tela oferecer só unidades que convertem", async () => {
    db.product.findMany.mockResolvedValue([{ id: "p9", name: "ARROZ BRANCO T1 CAMIL PACOTE 5KG", externalCode: "364", unit: "UN", unitMeasure: null, inventorySector: { name: "ESTOQUE" }, conversions: [] }]);
    const r = await request(app).get("/waste/products?search=arroz");
    expect(r.body[0].unit).toBe("UN");
    expect(r.body[0].embalagemInferida).toBe("1 UN = 5 KG (lido do nome do produto)");
    expect(r.body[0].conversions).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromUnit: "KG", toUnit: "UN", factor: 0.2 }),
      expect.objectContaining({ fromUnit: "G", toUnit: "UN", factor: 0.0002 }),
    ]));
  });

  test("prato pronto também converte por física (g → kg)", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ id: "d1", isActive: true, yieldUnit: "KG", custoPorcao: 25, custoIncompleto: false } as never);
    const r = await request(app).post("/waste").send({ dishId: "d1", quantity: "800", unit: "G", reason: "PRODUCTION_LEFTOVER", occurredOn: hoje });
    expect(r.status).toBe(201);
    expect(db.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ quantity: 0.8, unit: "KG", enteredQuantity: 800, enteredUnit: "G", totalCost: 20 });
  });
});
