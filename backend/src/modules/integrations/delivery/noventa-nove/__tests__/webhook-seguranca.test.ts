import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Webhook PUBLICO do 99Food (antes do portao de acesso). Aqui ficam as travas que valem MESMO
// quando a requisicao chega sem assinatura.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    noventaNoveSyncLog: { create: vi.fn() },
    noventaNoveCredential: { findFirst: vi.fn() },
    deliveryStore: { findFirst: vi.fn(), update: vi.fn() },
    noventaNoveSale: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() }
  }
}));
vi.mock("../../../../security/security-utils.js", () => ({ requireRole: vi.fn(), getSessionUser: vi.fn(), auditLog: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import {
  handleWebhook, reiniciarAvisoSemAssinatura, textoSeguro, verifyWebhookSignature, type WebhookEnvelope
} from "../noventa-nove-webhook.service.js";
import { noventaNovePublicRouter } from "../noventa-nove.routes.js";
import * as servico from "../noventa-nove-webhook.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const SEGREDO = "segredo-ficticio-para-teste";
const CANAIS = ["DELIVERY", "DELIVERY_REFUND"];

const envelope = (deliveryType: unknown): WebhookEnvelope => ({
  type: "orderNew",
  app_shop_id: "LOJA-FICTICIA",
  data: {
    order_info: {
      order_id: "900000000000001",
      shop: { shop_id: "111", app_shop_id: "LOJA-FICTICIA" },
      create_time: 1_760_000_000,
      price: { order_price: 5000, real_price: 5000 },
      delivery_type: deliveryType
    }
  }
} as unknown as WebhookEnvelope);

const corpo = (e: WebhookEnvelope) => JSON.stringify(e);
const assinar = (raw: string) => crypto.createHash("md5").update(raw + SEGREDO, "utf8").digest("hex");
const jaExiste = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarAvisoSemAssinatura();
  db.noventaNoveSyncLog.create.mockResolvedValue({});
  db.noventaNoveCredential.findFirst.mockResolvedValue({ clientSecret: SEGREDO, commissionPercent: 0 });
  db.deliveryStore.findFirst.mockResolvedValue({ id: "s1", externalId: "LOJA-FICTICIA", shopIdRemote: "111" });
  // padrao: pedido novo
  db.noventaNoveSale.create.mockImplementation(async ({ data }: { data: { channel: string | null } }) => ({ id: "v1", channel: data.channel }));
  db.noventaNoveSale.updateMany.mockResolvedValue({ count: 1 });
  db.noventaNoveSale.findUnique.mockResolvedValue({ id: "v-existente" });
});

describe("ajuste 1 — o webhook nunca grava um canal de faturamento", () => {
  test.each(["DELIVERY", "DELIVERY_REFUND", "delivery"])("pedido NOVO com delivery_type %j no corpo: canal nao e de receita", async (tipo) => {
    const e = envelope(tipo);
    await handleWebhook(e, corpo(e), null);
    const canal = db.noventaNoveSale.create.mock.calls[0][0].data.channel;
    expect(canal).toBe(`WEBHOOK:${tipo}`);
    expect(CANAIS).not.toContain(canal);
  });

  test.each(["DELIVERY", "DELIVERY_REFUND"])("pedido EXISTENTE com delivery_type %j: o update tambem nao grava canal de receita", async (tipo) => {
    db.noventaNoveSale.create.mockRejectedValueOnce(jaExiste());
    const e = envelope(tipo);
    await handleWebhook(e, corpo(e), null);
    expect(db.noventaNoveSale.updateMany.mock.calls[0][0].data.channel).toBe(`WEBHOOK:${tipo}`);
  });

  test("delivery_type numerico legitimo (como a 99 manda) segue igual", async () => {
    const e = envelope(1);
    await handleWebhook(e, corpo(e), null);
    expect(db.noventaNoveSale.create.mock.calls[0][0].data.channel).toBe("1");
  });

  test("sem delivery_type: canal nulo, como antes", async () => {
    const e = envelope(undefined);
    await handleWebhook(e, corpo(e), null);
    expect(db.noventaNoveSale.create.mock.calls[0][0].data.channel).toBeNull();
  });
});

describe("ajuste 2 — o webhook nao sobrescreve venda ja confirmada pela API financeira (de forma atomica)", () => {
  test("pedido novo: cria e nao tenta atualizar", async () => {
    const e = envelope(1);
    const r = await handleWebhook(e, corpo(e), null);
    expect(r).toMatchObject({ handled: true, saleId: "v1", reason: "Pedido persistido/atualizado" });
    expect(db.noventaNoveSale.updateMany).not.toHaveBeenCalled();
  });

  test("a protecao esta no WHERE do update (canal nulo OU nao faturado), nao numa leitura anterior", async () => {
    db.noventaNoveSale.create.mockRejectedValueOnce(jaExiste());
    const e = envelope(1);
    await handleWebhook(e, corpo(e), null);
    const { where } = db.noventaNoveSale.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      deliveryStoreId: "s1",
      externalOrderId: "900000000000001",
      OR: [{ channel: null }, { channel: { notIn: CANAIS } }]
    });
  });

  test("venda ja confirmada (o update nao casou com nenhuma linha): nada e alterado e o motivo diz isso", async () => {
    db.noventaNoveSale.create.mockRejectedValueOnce(jaExiste());
    db.noventaNoveSale.updateMany.mockResolvedValue({ count: 0 });
    db.noventaNoveSale.findUnique.mockResolvedValue({ id: "v-confirmada" });
    const e = envelope(1);
    const r = await handleWebhook(e, corpo(e), null);
    expect(r.saleId).toBe("v-confirmada");
    expect(r.reason).toMatch(/ja confirmada pela API financeira/);
  });

  test("venda que veio so do webhook segue sendo atualizada", async () => {
    db.noventaNoveSale.create.mockRejectedValueOnce(jaExiste());
    db.noventaNoveSale.updateMany.mockResolvedValue({ count: 1 });
    const e = envelope(2);
    const r = await handleWebhook(e, corpo(e), null);
    expect(r).toMatchObject({ handled: true, saleId: "v-existente", reason: "Pedido persistido/atualizado" });
  });

  test("erro de banco que NAO e 'ja existe' nao e confundido com isso: nada e atualizado", async () => {
    db.noventaNoveSale.create.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "P1001" }));
    const e = envelope(1);
    const r = await handleWebhook(e, corpo(e), null);
    expect(r.handled).toBe(false);
    expect(db.noventaNoveSale.updateMany).not.toHaveBeenCalled();
  });
});

describe("assinatura (politica atual preservada, sem vazar o valor esperado)", () => {
  test("assinatura correta e aceita; errada e rejeitada e nada e gravado", async () => {
    const e = envelope(1);
    const raw = corpo(e);
    expect((await handleWebhook(e, raw, assinar(raw))).handled).toBe(true);
    db.noventaNoveSale.create.mockClear();
    const r = await handleWebhook(e, raw, "0".repeat(32));
    expect(r.handled).toBe(false);
    expect(db.noventaNoveSale.create).not.toHaveBeenCalled();
    expect(db.noventaNoveSale.updateMany).not.toHaveBeenCalled();
  });

  test("o MOTIVO da rejeicao nao contem nenhum pedaco da assinatura esperada", () => {
    const raw = "{\"a\":1}";
    const esperado = assinar(raw);
    const r = verifyWebhookSignature("f".repeat(32), raw, SEGREDO);
    expect(r.valid).toBe(false);
    expect(r.reason.toLowerCase()).not.toContain(esperado.slice(0, 6));
    expect(r.reason).not.toMatch(/[0-9a-f]{8,}/i);
  });

  test("sem cabecalho de assinatura: segue aceito (decisao de politica pendente, documentada)", () => {
    expect(verifyWebhookSignature(null, "{}", SEGREDO).valid).toBe(true);
  });
});

describe("aviso (com limite) de evento aceito SEM assinatura", () => {
  test("avisa uma vez por janela, e so quando nao veio assinatura", async () => {
    vi.useFakeTimers();
    try {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      const e = envelope(1);
      const raw = corpo(e);
      await handleWebhook(e, raw, null);
      await handleWebhook(e, raw, null);
      await handleWebhook(e, raw, null);
      const semAssinatura = () => aviso.mock.calls.filter((c) => String(c[0]).includes("SEM assinatura")).length;
      expect(semAssinatura()).toBe(1);
      vi.setSystemTime(new Date("2030-01-01T01:00:00Z"));
      await handleWebhook(e, raw, null);
      expect(semAssinatura()).toBe(2);
      await handleWebhook(e, raw, assinar(raw));
      expect(semAssinatura()).toBe(2);
      aviso.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ajuste 3 — a resposta publica nao devolve detalhe interno", () => {
  const app = express();
  app.use(express.json());
  app.use("/public/delivery/noventa-nove", noventaNovePublicRouter);
  const enviar = (corpoEnvio: unknown = envelope(1)) => request(app).post("/public/delivery/noventa-nove/webhook").send(corpoEnvio as object);

  test("assinatura invalida: 200 (a 99 nao reentrega), sem 'reason', sem saleId e sem trecho da assinatura", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await request(app).post("/public/delivery/noventa-nove/webhook").set("didi-header-sign", "f".repeat(32)).send(envelope(1));
    aviso.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", event: "orderNew", handled: false });
    expect(JSON.stringify(r.body)).not.toMatch(/esperado|assinatura|[0-9a-f]{12}/i);
  });

  test("sucesso: 200 com so status, event e handled (sem saleId nem motivo)", async () => {
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", event: "orderNew", handled: true });
  });

  test("erro interno: 200 generico, sem a mensagem do erro, e o detalhe vai para o log", async () => {
    vi.spyOn(servico, "handleWebhook").mockRejectedValueOnce(new Error("Can't reach database server at dpg-x:5432"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviar();
    log.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("error");
    expect(JSON.stringify(r.body)).not.toMatch(/dpg-|5432|database/i);
  });

  test("falha ao gravar o pedido: o motivo interno nao aparece na resposta", async () => {
    db.noventaNoveSale.create.mockRejectedValueOnce(new Error("Invalid `prisma.noventaNoveSale.create()` invocation: externalOrderId"));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await enviar();
    aviso.mockRestore();
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|invocation|externalOrderId/i);
  });

  test("texto do atacante nao vai cru para o log nem para o eco: sem quebra de linha e com tamanho limitado", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const malicioso = { ...envelope(1), type: `orderNew\n[ERRO FALSO] ${"x".repeat(5000)}`, app_shop_id: "LOJA-INEXISTENTE\nINJECAO" };
    db.deliveryStore.findFirst.mockResolvedValue(null);
    const r = await enviar(malicioso);
    const linhas = aviso.mock.calls.map((c) => String(c[0]));
    aviso.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.event.length).toBeLessThanOrEqual(60);
    expect(r.body.event).not.toMatch(/[\r\n]/);
    for (const l of linhas) {
      expect(l).not.toMatch(/[\r\n]/);
      expect(l.length).toBeLessThan(400);
    }
  });
});

describe("textoSeguro", () => {
  test.each([
    ["a\nb\rc", "a b c"],
    ["tab\tfim", "tab fim"],
    ["nul\u0000fim", "nul fim"],
    ["linha nova", "linha nova"],
    [null, ""],
    [undefined, ""],
    [123, "123"]
  ])("%j -> %j", (entrada, esperado) => {
    expect(textoSeguro(entrada)).toBe(esperado);
  });

  test("respeita o limite", () => {
    expect(textoSeguro("x".repeat(500), 30)).toHaveLength(30);
    expect(textoSeguro("x".repeat(500))).toHaveLength(60);
  });
});

describe("ajuste — o envelope publico nao vira filtro do Prisma", () => {
  const externalIds = () => db.deliveryStore.findFirst.mock.calls.map((c: Array<{ where: { externalId?: unknown } }>) => c[0].where.externalId).filter((v: unknown) => v !== undefined);

  test("app_shop_id como OBJETO ({ startsWith: '' }) nunca chega ao banco como filtro", async () => {
    const e = { type: "orderNew", app_shop_id: { startsWith: "" }, data: { order_info: { order_id: "900000000000009", shop: { shop_id: undefined, app_shop_id: { contains: "" } }, create_time: 1_760_000_000, price: { order_price: 100, real_price: 100 } } } } as unknown as WebhookEnvelope;
    db.deliveryStore.findFirst.mockResolvedValue(null);
    await handleWebhook(e, corpo(e), null);
    expect(externalIds().every((v: unknown) => typeof v === "string")).toBe(true);
    expect(externalIds()).toEqual([]); // sem id de texto valido, nem consulta por externalId
  });

  test("shop_id como objeto tambem nao vira candidato", () => {
    expect(servico.shopIdCandidates({ in: ["x"] } as unknown as string, "{}")).toEqual([]);
    expect(servico.shopIdCandidates(true as unknown as string, "{}")).toEqual([]);
  });

  test("id de loja gigante e descartado; id normal segue valendo", async () => {
    expect(servico.shopIdCandidates("x".repeat(500), "{}")).toEqual([]);
    expect(servico.shopIdCandidates("123", "{}")).toEqual(["123"]);
    const gigante = { ...envelope("DELIVERY"), app_shop_id: "L".repeat(500) } as unknown as WebhookEnvelope;
    (gigante as unknown as { data: { order_info: { shop: { app_shop_id: string } } } }).data.order_info.shop.app_shop_id = "M".repeat(500);
    db.deliveryStore.findFirst.mockResolvedValue(null);
    await handleWebhook(gigante, corpo(gigante), null);
    expect(externalIds()).toEqual([]);
  });

  test("app_shop_id texto normal continua achando a loja pelo externalId", async () => {
    const e = envelope("DELIVERY");
    (e as unknown as { data: { order_info: { shop: { shop_id?: string } } } }).data.order_info.shop.shop_id = undefined;
    db.deliveryStore.findFirst.mockResolvedValue({ id: "s1", externalId: "LOJA-FICTICIA", shopIdRemote: "111" });
    await handleWebhook(e, corpo(e), null);
    expect(externalIds()).toContain("LOJA-FICTICIA");
  });
});

describe("corpo do webhook publico (mesma ordem de parsers do app.ts)", () => {
  // Reproduz a ordem: parser pequeno e especifico do webhook ANTES do parser geral grande.
  const montar = () => {
    const a = express();
    a.use("/public/delivery/noventa-nove", express.json({ limit: "256kb", verify: (req, _res, buf) => { (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8"); } }));
    a.use(express.json({ limit: "25mb" }));
    a.post("/public/delivery/noventa-nove/webhook", (req, res) => res.json({ raw: (req as express.Request & { rawBody?: string }).rawBody ?? null, tipo: req.body?.type }));
    a.post("/outra-rota", (req, res) => res.json({ tamanho: JSON.stringify(req.body).length }));
    a.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status ?? 500).json({ erro: true }));
    return a;
  };

  test("corpo acima de 256 KB no webhook: 413 (nao entra no banco nem na memoria)", async () => {
    const r = await request(montar()).post("/public/delivery/noventa-nove/webhook").set("Content-Type", "application/json").send(JSON.stringify({ type: "orderNew", lixo: "x".repeat(300_000) }));
    expect(r.status).toBe(413);
  });

  test("corpo normal: passa e o rawBody original fica guardado (a assinatura depende dele)", async () => {
    const bruto = '{"type":"orderNew",  "data":{}}';
    const r = await request(montar()).post("/public/delivery/noventa-nove/webhook").set("Content-Type", "application/json").send(bruto);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ raw: bruto, tipo: "orderNew" });
  });

  test("as outras rotas seguem com o limite grande (o agente do PDV manda megabytes)", async () => {
    const r = await request(montar()).post("/outra-rota").set("Content-Type", "application/json").send(JSON.stringify({ itens: "y".repeat(2_000_000) }));
    expect(r.status).toBe(200);
  });
});
