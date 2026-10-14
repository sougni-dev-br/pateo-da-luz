import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Custo e permissao propria ("inventory-costs"), nao so a da Analise do Salao: quem ve a analise mas nao ve custos nao
// pode ler nem gravar nada da margem. Banco de mentira: o que importa e o portao, que roda antes de qualquer consulta.
const consulta = vi.hoisted(() => vi.fn());
vi.mock("../../../../config/database.js", () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => consulta }) })
}));
vi.mock("../../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { getSessionUser } from "../../../security/security-utils.js";
import { userHasPermission } from "../../../security/menu-permissions.js";
import { agileAnaliseRouter } from "../agile-analise.routes.js";

const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const QS = "?inicio=2026-09-01&fim=2026-09-30";
const LEITURAS_COM_CUSTO = ["/analise/margem", "/analise/margem-bebidas", "/analise/margem-buffet"];
const GRAVACOES_COM_CUSTO: Array<[string, object]> = [
  ["/analise/margem/vinculo", { codigo: "X1", nome: "PRATO", pratoId: null }],
  ["/analise/margem-bebidas/vinculo", { codigo: "B1", nome: "BEBIDA", insumoId: null }],
  ["/analise/margem-buffet/custo", { ano: 2026, mes: 9, valor: 30 }]
];

// Quem pode a analise (ver e editar) mas so tem as permissoes listadas em `extras`.
const comPermissoes = (...modulos: string[]) =>
  vi.mocked(userHasPermission).mockImplementation(async (_u, modulo) => modulo === "analise-salao" || modulos.includes(modulo));

beforeEach(() => {
  vi.resetAllMocks();
  consulta.mockResolvedValue([]);
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
});

describe("margem exige a permissao de custos", () => {
  test.each(LEITURAS_COM_CUSTO)("GET %s sem custos: 403 e nada consultado", async (caminho) => {
    comPermissoes();
    const r = await request(app).get(caminho + QS);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/custos/);
    expect(consulta).not.toHaveBeenCalled();
  });

  test.each(GRAVACOES_COM_CUSTO)("PUT %s sem custos: 403 e nada gravado", async (caminho, corpo) => {
    comPermissoes();
    const r = await request(app).put(caminho).send(corpo);
    expect(r.status).toBe(403);
    expect(consulta).not.toHaveBeenCalled();
  });

  test.each(LEITURAS_COM_CUSTO)("GET %s com custos: passa do portao", async (caminho) => {
    comPermissoes("inventory-costs");
    const r = await request(app).get(caminho + QS);
    expect(r.status).not.toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "inventory-costs", "view");
  });

  test.each(GRAVACOES_COM_CUSTO)("PUT %s com custos mas sem editar a analise: continua 403", async (caminho, corpo) => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, modulo, acao) => modulo === "inventory-costs" || (modulo === "analise-salao" && acao === "view"));
    const r = await request(app).put(caminho).send(corpo);
    expect(r.status).toBe(403);
    expect(consulta).not.toHaveBeenCalled();
  });

  test.each(GRAVACOES_COM_CUSTO)("PUT %s sem sessao: 401", async (caminho, corpo) => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).put(caminho).send(corpo)).status).toBe(401);
  });

  test.each(["/analise/resumo", "/analise/demanda", "/analise/cardapio", "/analise/perdas"])("GET %s nao pede custos (nao mostra custo)", async (caminho) => {
    comPermissoes();
    const r = await request(app).get(caminho + QS);
    expect(r.status).not.toBe(403);
  });
});
