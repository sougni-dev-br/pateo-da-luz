import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Link público da ficha cadastral, com o banco de mentira. Pessoa fictícia.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    fichaCadastral: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    fichaCadastralArquivo: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

process.env.JWT_SECRET = "segredo-de-teste-com-mais-de-16";

import { prisma } from "../../../config/database.js";
import { auditLog } from "../../security/security-utils.js";
import { fichaCadastralPublicoRouter } from "../ficha-cadastral-publico.routes.js";
import { gerarCodigo } from "../ficha-cadastral-acesso.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/public/ficha-cadastral", fichaCadastralPublicoRouter);

const { codigo, hash } = gerarCodigo();
const url = (resto = "") => `/public/ficha-cadastral/${codigo}${resto}`;
const amanha = () => new Date(Date.now() + 24 * 3600 * 1000);
let ficha: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  ficha = {
    id: "f1", tipo: "ADMISSAO", status: "ENVIADA", tokenHash: hash, expiraEm: amanha(), nomeReferencia: "Fulana Souza",
    dados: {}, tentativasErradas: 0, bloqueadoAte: null, primeiroAcessoEm: null, motivoDevolucao: null,
  };
  db.fichaCadastral.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => (where.tokenHash === hash ? ficha : null));
  db.fichaCadastral.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (typeof data.tentativasErradas === "number") ficha.tentativasErradas = data.tentativasErradas;
    return { ...ficha, ...data, tentativasErradas: ficha.tentativasErradas };
  });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.$queryRaw.mockImplementation(async () => [{ status: ficha.status, bloqueadoAte: ficha.bloqueadoAte, tentativasErradas: ficha.tentativasErradas }]);
  db.fichaCadastral.updateMany.mockResolvedValue({ count: 1 });
  db.fichaCadastralArquivo.findMany.mockResolvedValue([]);
  db.fichaCadastralArquivo.aggregate.mockResolvedValue({ _count: 0, _sum: { tamanho: 0 } });
});

describe("abrir o link", () => {
  test("código malformado não consulta o banco", async () => {
    const r = await request(app).get("/public/ficha-cadastral/abc");
    expect(r.status).toBe(404);
    expect(db.fichaCadastral.findUnique).not.toHaveBeenCalled();
  });

  test("código bem formado mas desconhecido = 404", async () => {
    const r = await request(app).get(`/public/ficha-cadastral/${"A".repeat(43)}`);
    expect(r.status).toBe(404);
  });

  test("ficha nova abre direto, marca o primeiro acesso e devolve a chave de acesso", async () => {
    const r = await request(app).get(url());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ENVIADA", primeiroNome: "Fulana", dados: {} });
    expect(r.body.acesso).toEqual(expect.any(String));
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(db.fichaCadastral.update).toHaveBeenCalledWith(expect.objectContaining({ data: { primeiroAcessoEm: expect.any(Date) } }));
  });

  test("link vencido e cancelado não abrem", async () => {
    ficha.expiraEm = new Date(Date.now() - 1000);
    expect((await request(app).get(url())).status).toBe(410);
    ficha.status = "CANCELADA";
    expect((await request(app).get(url())).status).toBe(410);
  });

  test("com data de nascimento salva, os dados só aparecem depois de confirmar", async () => {
    ficha.dados = { dataNascimento: "1995-04-10", cpf: "52998224725", nomeMae: "Beltrana" };
    const r = await request(app).get(url());
    // Nem o primeiro nome: quem achou o link não descobre de quem é.
    expect(r.body).toEqual({ status: "ENVIADA", tipo: "ADMISSAO", verificacao: "NASCIMENTO" });
  });

  test("depois de finalizada, o link só diz que recebeu", async () => {
    ficha.status = "FINALIZADA";
    ficha.dados = { cpf: "52998224725" };
    const r = await request(app).get(url());
    expect(r.body).toEqual({ status: "FINALIZADA", tipo: "ADMISSAO" });
  });

  test("chave de acesso do link antigo não vale depois de gerar outro link", async () => {
    ficha.dados = { dataNascimento: "1995-04-10" };
    const { acesso } = (await request(app).post(url("/verificar")).send({ resposta: "1995-04-10" })).body;
    expect((await request(app).get(url()).set("X-Ficha-Acesso", acesso)).body.dados).toBeDefined();
    ficha.tokenHash = "outro-hash-de-link-novo-0000000000";
    db.fichaCadastral.findUnique.mockImplementation(async () => ficha);
    expect((await request(app).get(url()).set("X-Ficha-Acesso", acesso)).body.dados).toBeUndefined();
  });
});

describe("verificar", () => {
  beforeEach(() => { ficha.dados = { dataNascimento: "1995-04-10" }; });

  test("data certa libera os dados e zera as tentativas", async () => {
    const r = await request(app).post(url("/verificar")).send({ resposta: "1995-04-10" });
    expect(r.status).toBe(200);
    expect(r.body.dados).toEqual({ dataNascimento: "1995-04-10" });
    expect(db.fichaCadastral.update).toHaveBeenCalledWith(expect.objectContaining({ data: { tentativasErradas: 0, bloqueadoAte: null } }));
  });

  test("data errada conta a tentativa com a linha travada; a quinta bloqueia", async () => {
    const r = await request(app).post(url("/verificar")).send({ resposta: "1995-04-11" });
    expect(r.status).toBe(401);
    expect(r.body.message).toContain("Restam 4 tentativas");
    expect(String(db.$queryRaw.mock.calls[0][0].join(""))).toContain("FOR UPDATE");
    expect(db.fichaCadastral.update).toHaveBeenCalledWith(expect.objectContaining({ data: { tentativasErradas: 1 } }));
    ficha.tentativasErradas = 3;
    expect((await request(app).post(url("/verificar")).send({ resposta: "1995-04-11" })).body.message).toContain("Resta 1 tentativa.");
    const r5 = await request(app).post(url("/verificar")).send({ resposta: "1995-04-11" });
    expect(r5.status).toBe(429);
    expect(db.fichaCadastral.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { tentativasErradas: 5, bloqueadoAte: expect.any(Date) } }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "FICHA_CADASTRAL_BLOQUEADA" }));
  });

  test("cancelada entre a leitura e a trava: não libera os dados nem conta tentativa", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ status: "CANCELADA", bloqueadoAte: null, tentativasErradas: 0 }]);
    const r = await request(app).post(url("/verificar")).send({ resposta: "1995-04-10" });
    expect(r.status).toBe(409);
    expect(r.body.dados).toBeUndefined();
    expect(db.fichaCadastral.update).not.toHaveBeenCalled();
  });

  test("bloqueada recusa até a data certa", async () => {
    ficha.bloqueadoAte = amanha();
    const r = await request(app).post(url("/verificar")).send({ resposta: "1995-04-10" });
    expect(r.status).toBe(429);
  });
});

describe("salvar e finalizar", () => {
  test("salvar sem a chave quando a ficha já tem data de nascimento = 401", async () => {
    ficha.dados = { dataNascimento: "1995-04-10" };
    const r = await request(app).put(url("/dados")).send({ nomeMae: "Beltrana" });
    expect(r.status).toBe(401);
    expect(db.fichaCadastral.update).not.toHaveBeenCalled();
  });

  test("salvar junta com o que já havia, só em ficha editável, e passa a PREENCHENDO", async () => {
    ficha.dados = { nomeMae: "Beltrana" };
    const r = await request(app).put(url("/dados")).send({ nomePai: "Ciclano", dataNascimento: "1995-04-10" });
    expect(r.status).toBe(200);
    expect(db.fichaCadastral.updateMany).toHaveBeenCalledWith({
      where: { id: "f1", status: { in: ["ENVIADA", "PREENCHENDO"] } },
      data: { dados: { nomeMae: "Beltrana", nomePai: "Ciclano", dataNascimento: "1995-04-10" }, status: "PREENCHENDO" },
    });
  });

  test("ficha que saiu das mãos da pessoa no meio do salvamento não é alterada", async () => {
    db.fichaCadastral.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).put(url("/dados")).send({ nomePai: "X" })).status).toBe(409);
  });

  test("data de nascimento e CPF já salvos podem ser corrigidos, não apagados", async () => {
    ficha.dados = { cpf: "52998224725" };
    const { acesso } = (await request(app).post(url("/verificar")).send({ resposta: "52998224725" })).body;
    const r = await request(app).put(url("/dados")).set("X-Ficha-Acesso", acesso).send({ cpf: "" });
    expect(r.status).toBe(400);
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
  });

  test("valor inválido não grava", async () => {
    const r = await request(app).put(url("/dados")).send({ cpf: "12345678900" });
    expect(r.status).toBe(400);
    expect(db.fichaCadastral.update).not.toHaveBeenCalled();
  });

  test("finalizar com coisa faltando devolve a lista", async () => {
    const r = await request(app).post(url("/finalizar"));
    expect(r.status).toBe(400);
    expect(r.body.falta).toContain("Nome completo");
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
  });

  test("ficha finalizada não aceita mais alteração", async () => {
    ficha.status = "FINALIZADA";
    expect((await request(app).put(url("/dados")).send({ nomePai: "X" })).status).toBe(409);
  });
});

describe("arquivos", () => {
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

  test("aceita JPEG pelo conteúdo e grava com hash", async () => {
    const r = await request(app).post(url("/arquivos")).field("tipo", "DOC_FOTO").attach("arquivo", JPEG, "rg frente.jpg");
    expect(r.status).toBe(201);
    const data = db.fichaCadastralArquivo.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ fichaId: "f1", tipo: "DOC_FOTO", mimeType: "image/jpeg", nomeOriginal: "rg frente.jpg", tamanho: 104 });
    expect(data.sha256).toHaveLength(64);
  });

  test("recusa arquivo que não é imagem nem PDF, mesmo com nome .jpg", async () => {
    const r = await request(app).post(url("/arquivos")).field("tipo", "DOC_FOTO").attach("arquivo", Buffer.from("<script>alert(1)</script>"), "foto.jpg");
    expect(r.status).toBe(415);
    expect(db.fichaCadastralArquivo.create).not.toHaveBeenCalled();
  });

  test("recusa tipo de documento desconhecido e ficha cheia", async () => {
    expect((await request(app).post(url("/arquivos")).field("tipo", "XYZ").attach("arquivo", JPEG, "a.jpg")).status).toBe(400);
    db.fichaCadastralArquivo.aggregate.mockResolvedValue({ _count: 20, _sum: { tamanho: 1000 } });
    expect((await request(app).post(url("/arquivos")).field("tipo", "CPF").attach("arquivo", JPEG, "a.jpg")).status).toBe(409);
  });

  test("baixar e apagar só arquivo da própria ficha", async () => {
    db.fichaCadastralArquivo.findFirst.mockResolvedValue(null);
    expect((await request(app).get(url("/arquivos/outro"))).status).toBe(404);
    expect(db.fichaCadastralArquivo.findFirst).toHaveBeenCalledWith({ where: { id: "outro", fichaId: "f1" } });
    db.fichaCadastralArquivo.deleteMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete(url("/arquivos/outro"))).status).toBe(404);
  });
});
