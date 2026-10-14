import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Resumo, demanda e perdas do salao. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileSale: { findMany: vi.fn() },
    agileSaleItem: { findMany: vi.fn(), aggregate: vi.fn() },
    $queryRaw: vi.fn()
  };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { getSessionUser } from "../../../security/security-utils.js";
import { userHasPermission } from "../../../security/menu-permissions.js";
import { agileAnaliseRouter } from "../agile-analise.routes.js";
import { obterCardapio, obterDemanda, obterPerdas, obterResumo, obterVendasPorPessoa } from "../agile-analise.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/analise", agileAnaliseRouter);

const dec = (n: number | null) => (n === null ? null : { toString: () => String(n) });
const linha = (over: Record<string, unknown> = {}) => ({
  saleId: "1", movementDate: new Date("2026-10-05T12:00:00Z"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: 2,
  totalAmount: dec(200), subtotalAmount: dec(null), discountAmount: dec(null), discountLabel: null, cancelledBy: null, cancelReason: null, ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.agileSale.findMany.mockResolvedValue([linha()]);
  db.agileSaleItem.findMany.mockResolvedValue([]);
  db.agileSaleItem.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
  db.$queryRaw.mockResolvedValue([]);
});

const URLS = ["/analise/resumo", "/analise/demanda", "/analise/perdas", "/analise/cardapio"];
const QS = "?inicio=2026-10-01&fim=2026-10-07";

describe.each(URLS)("%s — acesso e periodo", (url) => {
  test("sem sessao: 401 e nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get(url + QS)).status).toBe(401);
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
  });

  test("sem a permissao analise-salao: 403 e nada consultado", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).get(url + QS);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "view");
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test.each([
    ["sem parametros", ""],
    ["formato errado", "?inicio=01/10/2026&fim=07/10/2026"],
    ["fim antes do inicio", "?inicio=2026-10-07&fim=2026-10-01"],
    ["mais de 366 dias", "?inicio=2025-01-01&fim=2026-10-07"],
    ["dia inexistente", "?inicio=2026-02-30&fim=2026-03-05"]
  ])("periodo invalido (%s): 400 com mensagem", async (_n, qs) => {
    const r = await request(app).get(url + qs);
    expect(r.status).toBe(400);
    expect(typeof r.body.message).toBe("string");
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
  });

  test("erro do banco: 500 com mensagem generica, sem vazar o erro interno", async () => {
    db.agileSale.findMany.mockRejectedValue(new Error("connection refused dpg-x:5432"));
    db.$queryRaw.mockRejectedValue(new Error("connection refused dpg-x:5432"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get(url + QS);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/dpg-|5432|connection/i);
  });
});

describe("/resumo", () => {
  test("le o periodo atual E o anterior numa unica consulta de vendas", async () => {
    await request(app).get("/analise/resumo" + QS);
    expect(db.agileSale.findMany).toHaveBeenCalledTimes(1);
    const { gte, lt } = db.agileSale.findMany.mock.calls[0][0].where.movementDate;
    expect(gte.toISOString()).toBe("2026-09-24T00:00:00.000Z"); // 7 dias antes de 01/10
    expect(lt.toISOString()).toBe("2026-10-08T00:00:00.000Z"); // dia seguinte ao fim
  });

  test("separa as linhas pela data: as de setembro sao o periodo anterior", async () => {
    db.agileSale.findMany.mockResolvedValue([
      linha({ saleId: "a", movementDate: new Date("2026-10-03T12:00:00Z"), totalAmount: dec(300), people: 3 }),
      linha({ saleId: "b", movementDate: new Date("2026-09-28T12:00:00Z"), totalAmount: dec(100), people: 1 })
    ]);
    const r = await request(app).get("/analise/resumo" + QS);
    expect(r.status).toBe(200);
    expect(r.body.atual).toMatchObject({ faturamento: 300, pessoas: 3 });
    expect(r.body.anterior).toMatchObject({ faturamento: 100, pessoas: 1 });
    expect(r.body.periodoAnterior).toEqual({ inicio: "2026-09-24", fim: "2026-09-30" });
  });

  test("itens cancelados: uma consulta com as duas janelas e soma por janela", async () => {
    db.$queryRaw.mockResolvedValue([{ atual: true, valor: "120.5" }, { atual: false, valor: 30 }]);
    const r = await request(app).get("/analise/resumo" + QS);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(r.body.atual.itensCanceladosValor).toBe(120.5);
    // sem venda no anterior, o objeto anterior e nulo mesmo havendo item cancelado nele
    expect(r.body.anterior).toBeNull();
  });

  test("desconto sem dado (null) continua null ate o calculo e e contado como 'sem dado'", async () => {
    const r = await request(app).get("/analise/resumo" + QS);
    expect(r.body.atual.descontoSemDado).toBe(1);
    expect(r.body.atual.descontoValor).toBe(0);
  });

  test("devolve serie diaria, cobertura e avisos", async () => {
    const r = await request(app).get("/analise/resumo" + QS);
    expect(r.body.serie).toHaveLength(7);
    expect(r.body.cobertura).toMatchObject({ diasNoPeriodo: 7, diasComMovimento: 1 });
    expect(Array.isArray(r.body.insights)).toBe(true);
  });
});

describe("/demanda", () => {
  test("le so o periodo pedido", async () => {
    await request(app).get("/analise/demanda" + QS);
    const { gte, lt } = db.agileSale.findMany.mock.calls[0][0].where.movementDate;
    expect(gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  test("devolve os sete dias da semana, o mapa e os turnos", async () => {
    const r = await request(app).get("/analise/demanda" + QS);
    expect(r.status).toBe(200);
    expect(r.body.diasDaSemana).toHaveLength(7);
    expect(r.body.mapa.horas).toEqual(["13"]);
    expect(r.body.turnos[0]).toMatchObject({ turno: "ALMOCO", pessoas: 2, faturamento: 200 });
    expect(r.body.capacidade.hipotese).toBe(true);
  });
});

describe("/perdas", () => {
  test("monta o funil a partir das vendas e anexa os relatorios detalhados", async () => {
    db.agileSale.findMany.mockResolvedValue([
      linha({ saleId: "r1", totalAmount: dec(1000), people: 5 }),
      linha({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: dec(300), people: 4, saleHour: "20:00", cancelledBy: "Ana" })
    ]);
    const r = await request(app).get("/analise/perdas" + QS);
    expect(r.status).toBe(200);
    expect(r.body.funil).toMatchObject({ faturado: 1000, cancelado: 300, refeito: 0, semRefacao: 300 });
    expect(r.body.porPessoa[0]).toMatchObject({ pessoa: "Ana", canceladas: 1, valorCancelado: 300 });
    expect(r.body.cancelamentos.resumo.canceladas).toBe(1);
    expect(r.body.descontos.resumo).toBeDefined();
    expect(r.body.itens.resumo).toBeDefined();
  });

  test("desconto: usa o tipo e quem registrou das proprias vendas, sem segunda leitura de AgileSale", async () => {
    db.agileSale.findMany.mockResolvedValue([
      linha({ saleId: "d1", totalAmount: dec(180), subtotalAmount: dec(200), discountAmount: dec(20), discountLabel: "DESCONTO 10%", cancelledBy: "Bia" })
    ]);
    const r = await request(app).get("/analise/perdas" + QS);
    expect(r.body.funil.descontos).toBe(20);
    expect(r.body.descontos.porTipo[0]).toMatchObject({ tipo: "DESCONTO 10%" });
    expect(r.body.descontos.porPessoa[0]).toMatchObject({ pessoa: "Bia" });
    // 1 leitura das vendas do periodo (itens cancelados nao tem item, entao nao consulta venda de novo)
    expect(db.agileSale.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("o dia em andamento fica de fora", () => {
  const pedido = { inicio: "2026-10-01", fim: "2026-10-13" };

  test("resumo: a consulta termina ONTEM e a resposta avisa que hoje ficou de fora", async () => {
    const r = await obterResumo(pedido, "2026-10-13");
    const { lt } = db.agileSale.findMany.mock.calls[0][0].where.movementDate;
    expect(lt.toISOString()).toBe("2026-10-13T00:00:00.000Z"); // exclusivo: o dia 13 nao entra
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.periodo).toEqual({ inicio: "2026-10-01", fim: "2026-10-12" });
  });

  test("periodo que ja terminou: nada e cortado e nao ha aviso", async () => {
    const r = await obterResumo({ inicio: "2026-10-01", fim: "2026-10-07" }, "2026-10-13");
    expect(r.hojeFicouDeFora).toBe(false);
    expect(r.periodo.fim).toBe("2026-10-07");
  });

  test("so hoje: nao consulta o banco e devolve relatorio vazio com o aviso", async () => {
    const r = await obterResumo({ inicio: "2026-10-13", fim: "2026-10-13" }, "2026-10-13");
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.cobertura.vendasComDetalhe).toBe(0);
  });

  test("demanda e perdas seguem a mesma regra", async () => {
    const d = await obterDemanda(pedido, "2026-10-13");
    expect(d.hojeFicouDeFora).toBe(true);
    expect(db.agileSale.findMany.mock.calls[0][0].where.movementDate.lt.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    vi.clearAllMocks();
    db.agileSale.findMany.mockResolvedValue([]);
    db.agileSaleItem.findMany.mockResolvedValue([]);
    db.agileSaleItem.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
    const p = await obterPerdas({ inicio: "2026-10-13", fim: "2026-10-13" }, "2026-10-13");
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
    expect(p.hojeFicouDeFora).toBe(true);
    expect(p.funil.perdaTotal).toBe(0);
  });
});

describe("o corte do dia vale tambem para os itens cancelados", () => {
  const pedido = { inicio: "2026-10-01", fim: "2026-10-13" };

  test("perdas: os itens cancelados (cruzados com a venda) tambem terminam ONTEM", async () => {
    db.agileSaleItem.findMany.mockResolvedValue([]);
    await obterPerdas(pedido, "2026-10-13");
    for (const chamada of [db.agileSaleItem.findMany.mock.calls[0][0], db.agileSaleItem.aggregate.mock.calls[0][0]]) {
      expect(chamada.where.movementDate.lt.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    }
  });

  test("resumo: o SQL de itens cancelados recebe as datas do periodo EFETIVO (anterior, inicio e fim exclusivo)", async () => {
    await obterResumo(pedido, "2026-10-13");
    const [, deAnterior, de, ate] = db.$queryRaw.mock.calls[0].slice(0, 5).map((p: unknown) => (p instanceof Date ? p.toISOString() : p));
    // template tag: [strings, de(>=), SITUACAO_RECEBIDA, SITUACAO_CANCELADA, deAnterior, ate]
    const datas = db.$queryRaw.mock.calls[0].slice(1).filter((p: unknown) => p instanceof Date).map((d: Date) => d.toISOString());
    expect(datas).toEqual(["2026-10-01T00:00:00.000Z", "2026-09-19T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
    expect([deAnterior, de, ate].length).toBe(3);
  });

  test("equipe (vendas por pessoa): hoje fica de fora e a resposta avisa", async () => {
    const r = await obterVendasPorPessoa(pedido, "2026-10-13");
    expect(db.agileSaleItem.findMany.mock.calls[0][0].where.movementDate.lt.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(r.hojeFicouDeFora).toBe(true);
    const so = await obterVendasPorPessoa({ inicio: "2026-10-13", fim: "2026-10-13" }, "2026-10-13");
    expect(so.hojeFicouDeFora).toBe(true);
    expect(db.agileSaleItem.findMany).toHaveBeenCalledTimes(1); // so hoje: nao consulta
  });
});

describe("resumo e perdas contam a mesma perda para os mesmos dados", () => {
  test("perda, teto, cancelado, refeito e descontos coincidem entre as duas telas", async () => {
    db.agileSale.findMany.mockResolvedValue([
      linha({ saleId: "r1", totalAmount: dec(1000), people: 5 }),
      linha({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: dec(200), people: 2, saleHour: "12:00", cancelledBy: "Ana" }),
      linha({ saleId: "r2", totalAmount: dec(201), people: 2, saleHour: "12:03" }),
      linha({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: dec(300), people: 4, saleHour: "20:00" }),
      linha({ saleId: "d1", totalAmount: dec(180), subtotalAmount: dec(200), discountAmount: dec(20), people: 2, saleHour: "21:00" })
    ]);
    db.$queryRaw.mockResolvedValue([{ atual: true, valor: 40 }]);
    db.agileSaleItem.findMany.mockResolvedValue([
      { saleId: "r1", movementDate: new Date("2026-10-05T12:00:00Z"), productName: "Prato", productGroup: "G", quantity: dec(1), totalAmount: dec(40), launchedBy: "Lia", cancelledBy: "Ana", cancelReason: null }
    ]);
    const periodo = { inicio: "2026-10-01", fim: "2026-10-07" };
    const r = await obterResumo(periodo, "2026-10-20");
    const p = await obterPerdas(periodo, "2026-10-20");
    expect(r.atual.perdaValor).toBeCloseTo(p.funil.perdaTotal, 2);
    expect(r.atual.perdaTetoValor).toBeCloseTo(p.funil.perdaTeto, 2);
    expect(r.atual.canceladoValor).toBeCloseTo(p.funil.cancelado, 2);
    expect(r.atual.refeitoValor).toBeCloseTo(p.funil.refeito, 2);
    expect(r.atual.descontoValor).toBeCloseTo(p.funil.descontos, 2);
    expect(r.atual.itensCanceladosValor).toBeCloseTo(p.funil.itensCancelados, 2);
    expect(r.atual.faturamento).toBeCloseTo(p.funil.faturado, 2);
  });
});

describe("/cardapio", () => {
  const produtoSql = (over: Record<string, unknown> = {}) => ({ atual: true, produto: "PRATO", grupo: "G", categoria: "ALIMENTOS", quantidade: "10", valor: "500", comandas: BigInt(8), ...over });
  const attachSql = (over: Record<string, unknown> = {}) => ({
    atual: true, turno: "Almoço", comandas: BigInt(1000), pessoas: BigInt(2000), com_beb: BigInt(800), com_alc: BigInt(100), com_cafe: BigInt(200), com_sob: BigInt(30),
    qtd_beb: "1600", val_beb: "16000", qtd_alc: "120", val_alc: "3000", qtd_cafe: "250", val_cafe: "2500", qtd_sob: "30", val_sob: "750", ...over
  });

  test("faz duas consultas agregadas (produtos e comandas), cobrindo o periodo atual e o anterior", async () => {
    await request(app).get("/analise/cardapio" + QS);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    for (const chamada of db.$queryRaw.mock.calls) {
      const datas = chamada.slice(1).filter((p: unknown) => p instanceof Date).map((d: Date) => d.toISOString());
      expect(datas).toContain("2026-09-24T00:00:00.000Z"); // inicio do periodo anterior
      expect(datas).toContain("2026-10-08T00:00:00.000Z"); // fim exclusivo
    }
  });

  test("a consulta de comandas recebe as listas de categorias EXATAS (nao regex) de bebida e alcool", async () => {
    await request(app).get("/analise/cardapio" + QS);
    const parametros = db.$queryRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1));
    const listas = parametros.filter((p: unknown) => Array.isArray(p));
    expect(listas).toContainEqual(["BEBIDAS", "BEBIDAS NÃO ALCOOLICAS", "BEBIDAS ALCOOLICAS", "VINHOS"]);
    expect(listas).toContainEqual(["BEBIDAS ALCOOLICAS", "VINHOS"]);
  });

  test("converte as linhas do banco (bigint e texto) e monta o relatorio", async () => {
    db.$queryRaw.mockResolvedValueOnce([produtoSql(), produtoSql({ atual: false, produto: "PRATO", valor: "250" })]).mockResolvedValueOnce([attachSql()]);
    const r = await request(app).get("/analise/cardapio?inicio=2026-09-01&fim=2026-09-20"); // 14+ dias: compara com o anterior
    expect(r.status).toBe(200);
    expect(r.body.resumo).toMatchObject({ faturamentoItens: 500, produtosVendidos: 1 });
    expect(r.body.categorias[0]).toMatchObject({ nome: "ALIMENTOS", participacao: 1, participacaoAnterior: 1 });
    expect(r.body.attach.geral).toMatchObject({ comandas: 1000, pessoas: 2000 });
    expect(r.body.attach.geral.itens.bebida.pctComandas).toBe(0.8);
    expect(r.body.simulacoes).toHaveLength(4);
  });

  test("hoje fica de fora: as duas consultas terminam ONTEM e a resposta avisa", async () => {
    const r = await obterCardapio({ inicio: "2026-10-01", fim: "2026-10-13" }, "2026-10-13");
    for (const chamada of db.$queryRaw.mock.calls) {
      const datas = chamada.slice(1).filter((p: unknown) => p instanceof Date).map((d: Date) => d.toISOString());
      expect(datas).toContain("2026-10-13T00:00:00.000Z");
      expect(datas).not.toContain("2026-10-14T00:00:00.000Z");
    }
    expect(r.hojeFicouDeFora).toBe(true);
  });

  test("so hoje: nao consulta o banco", async () => {
    const r = await obterCardapio({ inicio: "2026-10-13", fim: "2026-10-13" }, "2026-10-13");
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.resumo.produtosVendidos).toBe(0);
  });

  test("sem nenhum dado: relatorio vazio com 200", async () => {
    const r = await request(app).get("/analise/cardapio" + QS);
    expect(r.status).toBe(200);
    expect(r.body.abc.itens).toEqual([]);
    expect(r.body.insights).toEqual([]);
  });
});
