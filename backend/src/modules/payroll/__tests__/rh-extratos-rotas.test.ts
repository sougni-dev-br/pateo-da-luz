import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas de consulta dos extratos guardados: sessão, permissão de dados pessoais (403),
// nenhum CPF na resposta e o PDF devolvido como application/pdf.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    rhExtract: { findMany: vi.fn(), findUnique: vi.fn() },
    rhExtractPessoa: { groupBy: vi.fn() },
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { rhExtratosRouter } from "../rh-extratos.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/payroll/tip", rhExtratosRouter);

const ROTAS = ["/payroll/tip/extratos", "/payroll/tip/extratos/x1", "/payroll/tip/extratos/x1/arquivo"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
});

describe("permissões", () => {
  test.each(ROTAS)("%s sem sessão → 401", async (rota) => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get(rota)).status).toBe(401);
  });

  test.each(ROTAS)("%s sem ver Funcionários → 403 com mensagem clara, sem tocar no banco", async (rota) => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get(rota);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/só quem pode ver Funcionários/);
    expect(db.rhExtract.findMany).not.toHaveBeenCalled();
    expect(db.rhExtract.findUnique).not.toHaveBeenCalled();
  });
});

describe("GET /extratos", () => {
  test("lista sem o arquivo, com contagem de pessoas e se todas foram conferidas", async () => {
    db.rhExtract.findMany
      .mockResolvedValueOnce([{
        id: "x1", competenceYear: 2026, competenceMonth: 8, calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", cnpj: "12.345.678/0001-90",
        emissao: new Date("2026-08-28T00:00:00Z"), fileName: "Extrato.pdf", headcount: 2, totalLiquido: "3940.00",
        totalProventos: "11450.25", totalDescontos: "7510.25", createdAt: new Date("2026-08-29T10:00:00Z"), updatedAt: null,
      }])
      .mockResolvedValueOnce([{ id: "x1" }]);
    db.rhExtractPessoa.groupBy.mockResolvedValue([
      { rhExtractId: "x1", conferido: true, _count: { _all: 2 } },
      { rhExtractId: "x1", conferido: false, _count: { _all: 1 } },
    ]);
    const r = await request(app).get("/payroll/tip/extratos?ano=2026");
    expect(r.status).toBe(200);
    expect(db.rhExtract.findMany.mock.calls[0][0].where).toEqual({ competenceYear: 2026 });
    expect(db.rhExtract.findMany.mock.calls[0][0].select.arquivo).toBeUndefined();
    expect(r.body[0]).toMatchObject({ pessoas: 3, naoConferidas: 1, todasConferidas: false, temArquivo: true, emissao: "2026-08-28", totalLiquido: 3940 });
  });

  test("ano inválido → 400", async () => {
    expect((await request(app).get("/payroll/tip/extratos?ano=abc")).status).toBe(400);
  });
});

describe("GET /extratos/:id", () => {
  test("detalhe por pessoa com rubricas, sem CPF", async () => {
    db.rhExtract.findUnique.mockResolvedValue({
      id: "x1", competenceYear: 2026, competenceMonth: 8, calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", cnpj: null,
      emissao: null, fileName: "Extrato.pdf", totalLiquido: "380.00", totalProventos: null, totalDescontos: null,
      pessoas: [{
        id: "p1", employeeId: "e1", matricula: "48", nome: "CICRANA DA SILVA", situacao: "Trabalhando", vinculo: "Celetista", horasMes: "220.00",
        cargoCodigo: "7", cargo: "BARMAN", cbo: "513420", salarioBase: "2450.00", admissao: new Date("2026-07-21T00:00:00Z"), demissao: null,
        demissaoMotivo: null, proventos: "2450.25", descontos: "2070.25", liquido: "380.00", baseInss: "1470.00", baseFgts: "1470.00",
        baseIrrf: "-117.20", valorFgts: "117.60", liquidoRescisao: null, conferido: true,
        employee: { firstName: "Cicrana", lastName: "da Silva", displayName: null },
        rubricas: [
          { codigo: "998", descricao: "I.N.S.S.", tipo: "D", referencia: "7.50", valor: "110.25" },
          { codigo: "992", descricao: "TROCO DO MES", tipo: "P", referencia: "0.00", valor: "0.25" },
          { codigo: "1", descricao: "HORAS NORMAIS", tipo: "P", referencia: "220.00", valor: "2450.00" },
        ],
      }],
    });
    const r = await request(app).get("/payroll/tip/extratos/x1");
    expect(r.status).toBe(200);
    expect(r.body.pessoas[0]).toMatchObject({ nome: "CICRANA DA SILVA", salarioBase: 2450, admissao: "2026-07-21", employeeName: "Cicrana da Silva" });
    expect(r.body.pessoas[0].rubricas.map((x: { codigo: string }) => x.codigo)).toEqual(["1", "992", "998"]);
    expect(JSON.stringify(r.body)).not.toMatch(/cpf/i);
  });

  test("inexistente → 404", async () => {
    db.rhExtract.findUnique.mockResolvedValue(null);
    expect((await request(app).get("/payroll/tip/extratos/nao")).status).toBe(404);
  });
});

describe("GET /extratos/:id/arquivo", () => {
  test("devolve o PDF guardado", async () => {
    db.rhExtract.findUnique.mockResolvedValue({ arquivo: Buffer.from("%PDF-1.4 teste"), fileName: "Extrato Mensal (1).pdf" });
    const r = await request(app).get("/payroll/tip/extratos/x1/arquivo");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toBe('inline; filename="Extrato Mensal (1).pdf"');
    expect(Buffer.from(r.body).toString()).toBe("%PDF-1.4 teste");
  });

  test("registro antigo sem o PDF → 404 explicando que é preciso reimportar", async () => {
    db.rhExtract.findUnique.mockResolvedValue({ arquivo: null, fileName: "x.pdf" });
    const r = await request(app).get("/payroll/tip/extratos/x1/arquivo");
    expect(r.status).toBe(404);
    expect(r.body.message).toMatch(/Importe o arquivo de novo/);
  });
});
