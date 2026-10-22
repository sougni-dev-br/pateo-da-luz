import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O portao global de acesso (requireMenuAccess) decide o modulo pelo CAMINHO. Com "//" no meio
// (ex.: /integrations/agile//analise/...), o portao nao reconhecia o prefixo e deixava passar,
// enquanto o Express roteava normalmente para o handler. Aqui o portao e REAL; so a sessao e o
// banco sao de mentira.
vi.mock("../../../config/database.js", () => ({ prisma: {} }));
vi.mock("../../../modules/security/security-utils.js", () => ({ getSessionUser: vi.fn() }));

import { getSessionUser } from "../../../modules/security/security-utils.js";
import { requireMenuAccess } from "../../../modules/security/menu-permissions.js";
import { colapsarBarras, normalizarBarrasDuplas } from "../normalizar-barras.js";

const SEM_SESSAO = "Sessao obrigatoria."; // mensagem do PORTAO (sem acento)

function montarApp({ comNormalizador }: { comNormalizador: boolean }) {
  const app = express();
  if (comNormalizador) app.use(normalizarBarrasDuplas);
  // Rotas publicas/sem mapeamento ficam ANTES do portao, como no app real.
  const publico = Router();
  publico.post("/sync", (_req, res) => res.json({ por: "handler-publico" }));
  app.use("/integrations/agile", publico);
  app.use(requireMenuAccess);
  // Rotas protegidas SO pelo portao (o handler nao checa nada): o pior caso.
  const analise = Router();
  analise.get("/analise/cancelamentos", (req, res) => res.json({ por: "handler", caminho: req.path, consulta: req.query }));
  app.use("/integrations/agile", analise);
  const funcionarios = Router();
  funcionarios.get("/lista", (req, res) => res.json({ por: "handler", caminho: req.path }));
  app.use("/employees", funcionarios);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue(null as never);
});

describe("colapsarBarras", () => {
  test.each([
    ["/a/b", "/a/b"],
    ["/a//b", "/a/b"],
    ["/a///b////c", "/a/b/c"],
    ["//a/b", "/a/b"],
    ["/a/b//", "/a/b/"],
    ["/", "/"],
    ["//", "/"],
    ["", ""]
  ])("%j vira %j", (entrada, esperado) => {
    expect(colapsarBarras(entrada)).toBe(esperado);
  });

  test("so mexe no CAMINHO: barras duplas na consulta e no fragmento ficam intactas", () => {
    expect(colapsarBarras("/a//b?url=https://x.com//y")).toBe("/a/b?url=https://x.com//y");
    expect(colapsarBarras("/a//b?x=1#//f")).toBe("/a/b?x=1#//f");
    expect(colapsarBarras("/a/b?//")).toBe("/a/b?//");
  });

  test("forma absoluta (http://host//x) preserva o protocolo e colapsa so o caminho", () => {
    expect(colapsarBarras("http://exemplo.com//a//b?q=//")).toBe("http://exemplo.com/a/b?q=//");
    expect(colapsarBarras("https://exemplo.com:8443/a//b")).toBe("https://exemplo.com:8443/a/b");
  });

  test("devolve a MESMA string quando nao ha o que corrigir", () => {
    const url = "/integrations/agile/analise/cancelamentos?inicio=2026-10-01";
    expect(colapsarBarras(url)).toBe(url);
  });
});

describe("normalizarBarrasDuplas protege o portao global", () => {
  const VARIACOES = [
    "/integrations/agile/analise/cancelamentos",
    "/integrations/agile//analise/cancelamentos",
    "/integrations/agile///analise/cancelamentos",
    "/integrations/agile/analise//cancelamentos",
    "//integrations/agile/analise/cancelamentos",
    "/integrations//agile//analise//cancelamentos",
    "/INTEGRATIONS/AGILE//ANALISE/CANCELAMENTOS",
    "/integrations/agile//analise/cancelamentos/",
    "/integrations/agile//analise/cancelamentos//"
  ];

  test.each(VARIACOES)("%s -> barrado PELO PORTAO (401 sem sessao)", async (caminho) => {
    const r = await request(montarApp({ comNormalizador: true })).get(caminho);
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(SEM_SESSAO);
  });

  test.each(["/employees/lista", "/employees//lista", "//employees/lista", "/EMPLOYEES//lista", "/employees///lista"])(
    "outro modulo (%s) tambem: 401 pelo portao",
    async (caminho) => {
      const r = await request(montarApp({ comNormalizador: true })).get(caminho);
      expect(r.status).toBe(401);
      expect(r.body.message).toBe(SEM_SESSAO);
    }
  );

  test("com sessao de ADMIN o caminho com // chega ao handler, JA normalizado (200 e /lista)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "ADMIN", mustChangePassword: false } as never);
    for (const caminho of ["/employees/lista", "/employees//lista", "//employees///lista"]) {
      const r = await request(montarApp({ comNormalizador: true })).get(caminho);
      expect(r.status, caminho).toBe(200);
      expect(r.body).toEqual({ por: "handler", caminho: "/lista" });
    }
  });

  test.each(["post", "head", "put", "delete"] as const)("%s com // tambem e barrado pelo portao (a acao depende do metodo)", async (metodo) => {
    const r = await request(montarApp({ comNormalizador: true }))[metodo]("/integrations/agile//analise/cancelamentos");
    expect(r.status).toBe(401);
  });

  test("a consulta e preservada, inclusive com // dentro do valor", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const app = express();
    app.use(normalizarBarrasDuplas);
    app.get("/eco", (req, res) => res.json({ caminho: req.path, consulta: req.query }));
    const r = await request(app).get("/eco//?url=https://x.com//y&a=1");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ caminho: "/eco/", consulta: { url: "https://x.com//y", a: "1" } });
  });

  test("rota sem mapeamento (sync do agente) segue funcionando, com ou sem barra dupla", async () => {
    const app = montarApp({ comNormalizador: true });
    expect((await request(app).post("/integrations/agile/sync")).body.por).toBe("handler-publico");
    expect((await request(app).post("/integrations/agile//sync")).body.por).toBe("handler-publico");
  });

  test("URL normal nao e alterada (sem custo para o caso comum)", async () => {
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { antes: string }).antes = req.url; next(); });
    app.use(normalizarBarrasDuplas);
    app.get("/ok/:id", (req, res) => res.json({ url: req.url, antes: (req as unknown as { antes: string }).antes }));
    const r = await request(app).get("/ok/123?x=1");
    expect(r.body).toEqual({ url: "/ok/123?x=1", antes: "/ok/123?x=1" });
  });
});

// Express 4.22 passou a tratar "//" no roteamento: o portao ja barra sem o normalizador. Antes
// disso (4.21 e anteriores) a brecha existia. O normalizador continua valendo nas duas versoes
// (defesa em profundidade, testada acima); este teste so garante que a premissa documentada
// acima bate com a versao instalada, e avisa se alguem trocar a versao do Express.
const versaoDoExpress = (createRequire(import.meta.url)("express/package.json") as { version: string }).version;
const [maiorExpress = 0, menorExpress = 0] = versaoDoExpress.split(".").map(Number);
const expressTrataBarraDupla = maiorExpress > 4 || (maiorExpress === 4 && menorExpress >= 22);

describe("premissa do Express sobre // (sem o normalizador)", () => {
  test(`/integrations/agile//analise/... com Express ${versaoDoExpress}: ${expressTrataBarraDupla ? "o portao ja barra" : "passa pelo portao e chega ao handler"}`, async () => {
    const r = await request(montarApp({ comNormalizador: false })).get("/integrations/agile//analise/cancelamentos");
    if (expressTrataBarraDupla) {
      expect(r.status).toBe(401);
    } else {
      expect(r.status).toBe(200);
      expect(r.body.por).toBe("handler");
    }
  });

  test("o caminho normal e barrado pelo portao mesmo sem o normalizador (o portao funciona)", async () => {
    const r = await request(montarApp({ comNormalizador: false })).get("/integrations/agile/analise/cancelamentos");
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(SEM_SESSAO);
  });
});

describe("app.ts de verdade", () => {
  // O teste acima usa um app em miniatura; esta guarda garante que o app REAL registra o
  // normalizador antes de tudo que le o caminho. Mover essa linha reabre a brecha.
  const fonte = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../app.ts"), "utf-8");
  const posicao = (trecho: string) => fonte.indexOf(trecho);

  test("o normalizador e o PRIMEIRO app.use, antes do CORS, do parser e dos roteadores", () => {
    const norm = posicao("app.use(normalizarBarrasDuplas)");
    expect(norm).toBeGreaterThan(0);
    for (const depois of ["app.use(cors(", "app.use(express.json(", 'app.use("/auth"', 'app.use("/public/', "app.use(requireMenuAccess)"]) {
      const onde = posicao(depois);
      expect(onde, `${depois} nao encontrado`).toBeGreaterThan(0);
      expect(norm, `normalizador deve vir antes de ${depois}`).toBeLessThan(onde);
    }
  });

  test("so existe UM app.use do normalizador (nao ha segunda cadeia sem ele)", () => {
    expect(fonte.match(/app\.use\(normalizarBarrasDuplas\)/g)).toHaveLength(1);
    expect(fonte.match(/express\(\)/g)).toHaveLength(1);
  });
});

describe("variacoes de caminho que NAO podem virar acesso ao handler", () => {
  // O Express casa o caminho CRU: nada abaixo e tratado como "/analise". Travamos que continua assim,
  // para que uma atualizacao do Express (ou um novo middleware de decodificacao) nao reabra a brecha.
  test.each([
    "/integrations/agile%2fanalise/cancelamentos",
    "/integrations/agile/%2fanalise/cancelamentos",
    "/integrations/agile%252fanalise/cancelamentos",
    "/integrations/agile/./analise/cancelamentos",
    "/integrations/agile/x/../analise/cancelamentos",
    "/integrations/agile/analise\\cancelamentos",
    "/integrations/agile/;/analise/cancelamentos",
    "/integrations/agile/%61nalise/cancelamentos"
  ])("%s nunca chega ao handler", async (caminho) => {
    const r = await request(montarApp({ comNormalizador: true })).get(caminho);
    expect([401, 404]).toContain(r.status);
    expect(r.body.por).not.toBe("handler");
  });

  test("req.originalUrl segue INTACTO (documenta a premissa: so req.url e reescrito e ninguem decide por originalUrl)", async () => {
    const app = express();
    app.use(normalizarBarrasDuplas);
    app.get("/eco/x", (req, res) => res.json({ url: req.url, originalUrl: req.originalUrl }));
    const r = await request(app).get("/eco//x?a=1");
    expect(r.body).toEqual({ url: "/eco/x?a=1", originalUrl: "/eco//x?a=1" });
  });
});
