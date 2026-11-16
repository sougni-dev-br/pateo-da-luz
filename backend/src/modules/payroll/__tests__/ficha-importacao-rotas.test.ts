import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas da importação da ficha: validação do pedido e permissão, com serviço, leitor de PDF e
// sessão de mentira.
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn() }));
vi.mock("../ficha-registro-texto.js", () => ({ textoLayoutDoPdf: vi.fn(), PdfInvalidoError: class extends Error {} }));
vi.mock("../ficha-registro-parser.js", () => ({ lerFichasRegistro: vi.fn() }));
vi.mock("../ficha-importacao.service.js", () => ({ preverImportacao: vi.fn(), aplicarImportacao: vi.fn() }));

import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { textoLayoutDoPdf } from "../ficha-registro-texto.js";
import { lerFichasRegistro } from "../ficha-registro-parser.js";
import { aplicarImportacao, preverImportacao } from "../ficha-importacao.service.js";
import { fichaImportacaoRouter } from "../ficha-importacao.routes.js";

const app = express();
app.use(express.json());
app.use("/employees/ficha-registro", fichaImportacaoRouter);

const PDF = Buffer.from("%PDF-1.4 conteúdo de teste");
const FICHAS = [{ registro: "000020", nome: "FULANA DE TAL" }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(textoLayoutDoPdf).mockResolvedValue("texto");
  vi.mocked(lerFichasRegistro).mockReturnValue(FICHAS as never);
  vi.mocked(preverImportacao).mockResolvedValue([{ chave: "e1" }] as never);
  vi.mocked(aplicarImportacao).mockResolvedValue([{ employeeId: "e1", nome: "Fulana", aplicados: ["preenche:cbo"], ignorados: [] }]);
});

describe("POST /previa", () => {
  test("sem permissão de ver dados pessoais: 403 e nada é lido", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).post("/employees/ficha-registro/previa").attach("file", PDF, "ficha.pdf");
    expect(r.status).toBe(403);
    expect(textoLayoutDoPdf).not.toHaveBeenCalled();
  });

  test("sem arquivo: 400", async () => {
    expect((await request(app).post("/employees/ficha-registro/previa").field("desde", "2026-11-01")).status).toBe(400);
  });

  test("arquivo que não é PDF: 400", async () => {
    const r = await request(app).post("/employees/ficha-registro/previa").attach("file", Buffer.from("MZ não é pdf"), "x.pdf");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/não é um PDF/);
  });

  test("data de início inválida: 400", async () => {
    const r = await request(app).post("/employees/ficha-registro/previa").field("desde", "31/12/2026").attach("file", PDF, "f.pdf");
    expect(r.status).toBe(400);
  });

  test("PDF sem ficha legível: 400 com a causa", async () => {
    vi.mocked(lerFichasRegistro).mockImplementation(() => { throw new Error("Ficha sem número de registro."); });
    const r = await request(app).post("/employees/ficha-registro/previa").attach("file", PDF, "f.pdf");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Ficha sem número de registro/);
  });

  test("PDF sem nenhuma ficha: 400", async () => {
    vi.mocked(lerFichasRegistro).mockReturnValue([]);
    expect((await request(app).post("/employees/ficha-registro/previa").attach("file", PDF, "f.pdf")).status).toBe(400);
  });

  test("ok: devolve as pessoas e repassa 'desde'", async () => {
    const r = await request(app).post("/employees/ficha-registro/previa").field("desde", "2026-11-01").attach("file", PDF, "f.pdf");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ desde: "2026-11-01", pessoas: [{ chave: "e1" }] });
    expect(vi.mocked(preverImportacao).mock.calls[0][1]).toBe("2026-11-01");
  });

  test("arquivo acima de 15 MB: 400 com mensagem clara", async () => {
    const grande = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(15 * 1024 * 1024 + 10)]);
    const r = await request(app).post("/employees/ficha-registro/previa").attach("file", grande, "g.pdf");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/grande demais/);
  });
});

describe("POST /aplicar", () => {
  const aplicar = (selecoes: unknown, extra: Record<string, string> = {}) => {
    let req = request(app).post("/employees/ficha-registro/aplicar").attach("file", PDF, "f.pdf");
    if (selecoes !== undefined) req = req.field("selecoes", typeof selecoes === "string" ? selecoes : JSON.stringify(selecoes));
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return req;
  };

  test("seleção que não é JSON válido: 400", async () => {
    expect((await aplicar("{quebrado")).status).toBe(400);
  });

  test("seleção com formato errado: 400", async () => {
    expect((await aplicar({ e1: "preenche:cbo" })).status).toBe(400);
  });

  test("nada marcado: 400 e nada é gravado", async () => {
    const r = await aplicar({ e1: [] });
    expect(r.status).toBe(400);
    expect(aplicarImportacao).not.toHaveBeenCalled();
  });

  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await aplicar({ e1: ["preenche:cbo"] })).status).toBe(401);
    expect(aplicarImportacao).not.toHaveBeenCalled();
  });

  test("sem permissão de ver dados pessoais: 403", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    expect((await aplicar({ e1: ["preenche:cbo"] })).status).toBe(403);
    expect(aplicarImportacao).not.toHaveBeenCalled();
  });

  test("ok: repassa seleção, 'desde', motivo e o usuário da sessão", async () => {
    const r = await aplicar({ e1: ["preenche:cbo", "salario"] }, { desde: "2026-11-01", motivo: "Dissídio 2026" });
    expect(r.status).toBe(200);
    expect(r.body.resultados[0]).toMatchObject({ employeeId: "e1", aplicados: ["preenche:cbo"] });
    const [fichas, selecoes, desde, , motivo, usuario] = vi.mocked(aplicarImportacao).mock.calls[0];
    expect(fichas).toEqual(FICHAS);
    expect(selecoes).toEqual({ e1: ["preenche:cbo", "salario"] });
    expect(desde).toBe("2026-11-01");
    expect(motivo).toBe("Dissídio 2026");
    expect(usuario).toEqual({ id: "u1", nome: "Eli" });
  });
});
