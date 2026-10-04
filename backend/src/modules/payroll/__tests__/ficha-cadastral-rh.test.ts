import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Fichas cadastrais do lado do RH, com o banco de mentira. Pessoas fictícias.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    fichaCadastral: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    fichaCadastralArquivo: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    employeeDependente: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { fichaCadastralRouter } from "../ficha-cadastral.routes.js";
import { hashCodigo } from "../ficha-cadastral-acesso.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/employee-forms", fichaCadastralRouter);
app.use((erro: Error, _q: express.Request, r: express.Response, _n: express.NextFunction) => { r.status(500).json({ message: erro.message }); });

const DADOS = {
  nomeCompleto: "Fulana de Tal Souza", dataNascimento: "1995-04-10", sexo: "FEMININO", cpf: "52998224725", nomeMae: "Beltrana de Tal",
  estadoCivil: "Solteiro(a)", racaCor: "Parda", escolaridade: "Médio completo", rg: "123456789", cep: "01000000", endereco: "Rua das Flores",
  numero: "10", bairro: "Centro", cidade: "Sao Paulo", uf: "SP", telefone: "11912345678", usaVt: true, vtTrajeto: "Ônibus 1234",
  filhos: [{ nome: "Ciclano Souza", dataNascimento: "2015-01-02", cpf: null }],
};
const funcionario = {
  id: "e1", firstName: "Fulana", lastName: "Souza", cpf: "52998224725", birthDate: new Date("1995-04-10T00:00:00Z"), gender: "FEMININO",
  nomeMae: null, city: "São Paulo", companyId: "c1", admissionDate: new Date("2025-03-01T00:00:00Z"), position: "Garçonete",
  baseSalary: 2500, modality: "CLT", jornadaInicio: "10:00", jornadaFim: "18:00", intervaloInicio: null, intervaloFim: null, vtType: "TRANSPORTE_PUBLICO",
  deletedAt: null,
};
let ficha: Record<string, unknown>;
// Versão que o RH viu na tela (o updatedAt da ficha): o concluir só vale para ela.
const VERSAO = "2026-10-04T12:00:00.000Z";
const VERSAO_DATA = new Date(VERSAO);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  ficha = {
    id: "f1", tipo: "ADMISSAO", status: "FINALIZADA", expiraEm: new Date(Date.now() + 86400000), nomeReferencia: "Fulana", updatedAt: VERSAO_DATA,
    employeeId: null, dados: DADOS, dadosEmpresa: { admissao: "2026-10-05", funcao: "Garçonete", salario: 2500, companyId: "c1", entrada: "10:00", saida: "18:00" },
  };
  db.fichaCadastral.findUnique.mockImplementation(async () => ficha);
  db.fichaCadastral.findFirst.mockResolvedValue(null);
  db.fichaCadastral.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "nova", ...data }));
  db.fichaCadastral.update.mockImplementation(async ({ data }: { data: object }) => ({ ...ficha, ...data }));
  db.fichaCadastral.updateMany.mockResolvedValue({ count: 1 });
  db.employee.findFirst.mockResolvedValue(null);
  db.employee.create.mockImplementation(async ({ data }: { data: object }) => data);
  db.employee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...funcionario, ...data }));
  db.employeeDependente.findMany.mockResolvedValue([]);
  db.company.findUnique.mockResolvedValue({ id: "c1" });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("gerar o link", () => {
  test("admissão: devolve o código uma vez e guarda só o hash", async () => {
    const r = await request(app).post("/employee-forms").send({ tipo: "ADMISSAO", nomeReferencia: "  Fulana   Souza " });
    expect(r.status).toBe(201);
    expect(r.body.codigo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = db.fichaCadastral.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tipo: "ADMISSAO", nomeReferencia: "Fulana Souza", tokenHash: hashCodigo(r.body.codigo), createdById: "u1" });
    expect(JSON.stringify(data)).not.toContain(r.body.codigo);
  });

  test("atualização já abre com os dados do funcionário e sem salário nos dados da pessoa", async () => {
    db.employee.findFirst.mockResolvedValue(funcionario);
    const r = await request(app).post("/employee-forms").send({ tipo: "ATUALIZACAO", employeeId: "e1" });
    expect(r.status).toBe(201);
    const data = db.fichaCadastral.create.mock.calls[0][0].data;
    expect(data.dados).toMatchObject({ cpf: "52998224725", dataNascimento: "1995-04-10", sexo: "FEMININO" });
    expect(JSON.stringify(data.dados)).not.toContain("2500");
    expect(data.dadosEmpresa).toMatchObject({ funcao: "Garçonete", salario: 2500, admissao: "2025-03-01" });
  });

  test("atualização com ficha aberta para a mesma pessoa = 409", async () => {
    db.employee.findFirst.mockResolvedValue(funcionario);
    db.fichaCadastral.findFirst.mockResolvedValue({ id: "f0" });
    const r = await request(app).post("/employee-forms").send({ tipo: "ATUALIZACAO", employeeId: "e1" });
    expect(r.status).toBe(409);
    expect(r.body.fichaId).toBe("f0");
  });

  test("tipo inválido e nome vazio são recusados", async () => {
    expect((await request(app).post("/employee-forms").send({ tipo: "X" })).status).toBe(400);
    expect((await request(app).post("/employee-forms").send({ tipo: "ADMISSAO", nomeReferencia: " " })).status).toBe(400);
  });
});

describe("concluir admissão", () => {
  test("cria o funcionário com dados pessoais, empresa e filhos", async () => {
    const r = await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO });
    expect(r.status).toBe(200);
    const data = db.employee.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      firstName: "Fulana", lastName: "de Tal Souza", cpf: "52998224725", birthDate: new Date("1995-04-10T00:00:00Z"),
      gender: "FEMININO", city: "São Paulo", nomeMae: "Beltrana de Tal", position: "Garçonete", baseSalary: 2500,
      admissionDate: new Date("2026-10-05T00:00:00Z"), companyId: "c1", jornadaInicio: "10:00", shiftStart: "10:00",
      vtType: "TRANSPORTE_PUBLICO", notes: "Trajeto do VT informado na ficha: Ônibus 1234", createdById: "u1",
    });
    expect(db.employeeDependente.createMany.mock.calls[0][0].data[0]).toMatchObject({ nome: "Ciclano Souza", origem: "FICHA_CADASTRAL", employeeId: data.id });
    expect(db.fichaCadastral.updateMany).toHaveBeenCalledWith({
      where: { id: "f1", status: "FINALIZADA", updatedAt: VERSAO_DATA },
      data: expect.objectContaining({ status: "CONCLUIDA", employeeId: data.id, concluidaPorId: "u1" }),
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_EMPLOYEE" }));
    // A ficha só aponta para o funcionário depois de ele existir (chave estrangeira).
    expect(db.employee.create.mock.invocationCallOrder[0]).toBeLessThan(db.fichaCadastral.updateMany.mock.invocationCallOrder[0]);
  });

  test("telefone e CEP vão com máscara; VT segue a decisão do RH", async () => {
    ficha.dadosEmpresa = { ...(ficha.dadosEmpresa as object), valeTransporte: false };
    await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO });
    const data = db.employee.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ phone: "(11) 91234-5678", zipCode: "01000-000", vtType: "NENHUM", notes: null });
  });

  test("CPF único no banco (funcionário excluído) vira mensagem, não erro 500", async () => {
    const { Prisma } = await import("@prisma/client");
    db.employee.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("único", { code: "P2002", clientVersion: "5" }));
    const r = await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("CPF");
  });

  test("CPF já cadastrado não cria outro funcionário", async () => {
    db.employee.findFirst.mockResolvedValue({ id: "e9" });
    const r = await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO });
    expect(r.status).toBe(400);
    expect(db.employee.create).not.toHaveBeenCalled();
  });

  test("sem admissão ou função não conclui", async () => {
    ficha.dadosEmpresa = { funcao: "Garçonete" };
    expect((await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO })).body.message).toContain("admissão");
  });

  test("sem permissão de criar Funcionários = 403", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO })).status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "employees", "create");
  });

  test("ficha que não está finalizada não conclui; conclusão concorrente é barrada", async () => {
    ficha.status = "PREENCHENDO";
    expect((await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO })).status).toBe(409);
    ficha.status = "FINALIZADA";
    db.fichaCadastral.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO })).status).toBe(409);
  });

  test("só conclui a versão que o RH viu: devolvida e reenviada no meio = 409, nada gravado", async () => {
    const r = await request(app).post("/employee-forms/f1/concluir").send({ versao: "2026-10-04T11:00:00.000Z" });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("mudou depois que você a abriu");
    expect((await request(app).post("/employee-forms/f1/concluir").send({})).status).toBe(409);
    expect(db.employee.create).not.toHaveBeenCalled();
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
  });

  test("gravou mas a auditoria falhou: responde que concluiu (não 'nada foi gravado')", async () => {
    vi.mocked(auditLog).mockRejectedValueOnce(new Error("sem conexão"));
    const r = await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("concluir atualização", () => {
  beforeEach(() => {
    ficha.tipo = "ATUALIZACAO";
    ficha.employeeId = "e1";
    db.employee.findFirst.mockImplementation(async ({ where }: { where: { id?: unknown } }) => (where.id === "e1" ? funcionario : null));
  });

  test("sem a lista do que gravar, não grava nada", async () => {
    expect((await request(app).post("/employee-forms/f1/concluir").send({ versao: VERSAO })).status).toBe(400);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("grava só os dados pessoais que mudaram — nunca salário nem cargo", async () => {
    ficha.dadosEmpresa = { salario: 9999, funcao: "Gerente" };
    const r = await request(app).post("/employee-forms/f1/concluir").send({ campos: ["nomeMae", "rg", "cpf", "baseSalary", "position"], versao: VERSAO });
    expect(r.status).toBe(200);
    const data = db.employee.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ nomeMae: "Beltrana de Tal", rg: "123456789", updatedById: "u1" });
    expect(data).not.toHaveProperty("cpf");
    expect(data).not.toHaveProperty("baseSalary");
    expect(data).not.toHaveProperty("position");
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "employees", "edit");
  });

  test("campos escolhidos: aplica só eles e não inclui filhos se não marcados", async () => {
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["nomeMae"], versao: VERSAO });
    expect(db.employee.update.mock.calls[0][0].data).toEqual({ nomeMae: "Beltrana de Tal", updatedById: "u1" });
    expect(db.employeeDependente.createMany).not.toHaveBeenCalled();
  });

  test("chave PIX nova vai com o tipo certo", async () => {
    ficha.dados = { ...DADOS, pixChave: "fulana@exemplo.com" };
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["pixChave"], versao: VERSAO });
    expect(db.employee.update.mock.calls[0][0].data).toEqual({ pixKey: "fulana@exemplo.com", pixKeyType: "EMAIL", updatedById: "u1" });
  });

  test("filho já cadastrado com nascimento corrigido: atualiza o dependente, não duplica", async () => {
    db.employeeDependente.findMany.mockResolvedValue([{ id: "d1", nome: "CICLANO SOUZA", dataNascimento: new Date("2015-01-20T00:00:00Z"), cpf: null }]);
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["filhos"], versao: VERSAO });
    expect(db.employeeDependente.createMany).not.toHaveBeenCalled();
    expect(db.employeeDependente.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { dataNascimento: new Date("2015-01-02T00:00:00Z") } });
  });

  test("nome completo corrigido também corrige nome e sobrenome (o que o sistema mostra)", async () => {
    ficha.dados = { ...DADOS, nomeCompleto: "Fulana de Tal Sousa" };
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["nomeCompleto"], versao: VERSAO });
    expect(db.employee.update.mock.calls[0][0].data).toMatchObject({ nomeCompleto: "Fulana de Tal Sousa", firstName: "Fulana", lastName: "de Tal Sousa" });
  });

  test("filho do cadastro com nome corrigido: corrige o dependente; incluir e corrigir são escolhas separadas", async () => {
    db.employeeDependente.findMany.mockResolvedValue([{ id: "d1", nome: "Ciclano Sosa", dataNascimento: null, cpf: null, parentesco: null }]);
    ficha.dados = { ...DADOS, filhos: [{ nome: "Ciclano Souza", dataNascimento: null, cpf: null, ref: "d1" }, { nome: "Beltrano Souza", dataNascimento: null, cpf: null, ref: null }] };
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["filhosAlterados"], versao: VERSAO });
    expect(db.employeeDependente.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { nome: "Ciclano Souza" } });
    expect(db.employeeDependente.createMany).not.toHaveBeenCalled();
  });

  test("cônjuge cadastrado como dependente não entra como filho", async () => {
    db.employeeDependente.findMany.mockResolvedValue([{ id: "d9", nome: "Beltrana Souza", dataNascimento: null, cpf: null, parentesco: "Cônjuge" }]);
    ficha.dados = { ...DADOS, filhos: [] };
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["filhos"], versao: VERSAO });
    expect(db.employeeDependente.update).not.toHaveBeenCalled();
  });

  test("ficha alterada depois de lida (correção, devolução): não conclui com dado velho", async () => {
    db.fichaCadastral.updateMany.mockResolvedValue({ count: 0 });
    const r = await request(app).post("/employee-forms/f1/concluir").send({ campos: ["nomeMae"], versao: VERSAO });
    expect(r.status).toBe(409);
    expect(db.fichaCadastral.updateMany.mock.calls[0][0].where).toHaveProperty("updatedAt");
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("filho que já é dependente não é duplicado", async () => {
    db.employeeDependente.findMany.mockResolvedValue([{ nome: "CICLANO SOUZA" }]);
    await request(app).post("/employee-forms/f1/concluir").send({ campos: ["filhos"], versao: VERSAO });
    expect(db.employeeDependente.createMany).not.toHaveBeenCalled();
  });
});

describe("outras ações", () => {
  test("devolver exige motivo e reabre", async () => {
    expect((await request(app).post("/employee-forms/f1/devolver").send({ motivo: "" })).status).toBe(400);
    const r = await request(app).post("/employee-forms/f1/devolver").send({ motivo: "Foto do RG ilegível" });
    expect(r.status).toBe(200);
    expect(db.fichaCadastral.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "f1", status: "FINALIZADA" }, data: { status: "PREENCHENDO", motivoDevolucao: "Foto do RG ilegível", finalizadaEm: null },
    });
  });

  test("devolver ou cancelar ficha que outra pessoa já concluiu: 409, nada muda", async () => {
    db.fichaCadastral.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post("/employee-forms/f1/devolver").send({ motivo: "Foto do RG ilegível" })).status).toBe(409);
    expect((await request(app).post("/employee-forms/f1/cancelar")).status).toBe(409);
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("novo link troca o hash e desbloqueia; ficha finalizada não troca", async () => {
    expect((await request(app).post("/employee-forms/f1/novo-link")).status).toBe(409);
    ficha.status = "PREENCHENDO";
    const r = await request(app).post("/employee-forms/f1/novo-link");
    expect(db.fichaCadastral.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: { in: ["ENVIADA", "PREENCHENDO"] } }, data: { tokenHash: hashCodigo(r.body.codigo), tentativasErradas: 0, bloqueadoAte: null },
    });
  });

  test("cancelar ficha concluída não pode", async () => {
    ficha.status = "CONCLUIDA";
    expect((await request(app).post("/employee-forms/f1/cancelar")).status).toBe(409);
  });

  test("salário na parte da empresa exige ver Funcionários", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).put("/employee-forms/f1/empresa").send({ salario: 2000 })).status).toBe(403);
    expect((await request(app).put("/employee-forms/f1/empresa").send({ funcao: "Garçonete" })).status).toBe(200);
  });

  test("sem ver Funcionários: nem o CPF/PIX novo aparece na lista do que muda", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    db.fichaCadastral.findUnique.mockResolvedValue({
      ...ficha, tipo: "ATUALIZACAO", employeeId: "e1", dados: { ...DADOS, cpf: "11144477735", pixChave: "x@y.com" }, arquivos: [],
      employee: { ...funcionario, isActive: true, pixKey: "a@b.com", dependentes: [] },
    });
    db.company.findMany.mockResolvedValue([]);
    const r = await request(app).get("/employee-forms/f1");
    const cpf = r.body.diferencas.find((d: { campo: string }) => d.campo === "cpf");
    const pix = r.body.diferencas.find((d: { campo: string }) => d.campo === "pixChave");
    expect(cpf).toMatchObject({ atual: "•••", novo: "•••" });
    expect(pix).toMatchObject({ atual: "•••", novo: "•••" });
    expect(JSON.stringify(r.body)).not.toContain("11144477735");
  });

  test("atualização: empresa, função e salário vêm do cadastro de hoje, não do dia do link", async () => {
    db.fichaCadastral.findUnique.mockResolvedValue({
      ...ficha, tipo: "ATUALIZACAO", employeeId: "e1", arquivos: [],
      dadosEmpresa: { salario: 1800, funcao: "Copeira", folga: "segunda" },
      employee: { ...funcionario, isActive: true, dependentes: [] },
    });
    db.company.findMany.mockResolvedValue([]);
    const r = await request(app).get("/employee-forms/f1");
    expect(r.body.dadosEmpresa).toMatchObject({ salario: 2500, funcao: "Garçonete", folga: "segunda" });
  });

  test("não existe mais rota para o RH reescrever os dados da pessoa", async () => {
    expect((await request(app).put("/employee-forms/f1/dados").send({ dataNascimento: null })).status).toBe(404);
  });

  test("sem ver Funcionários: salário, CPF e PIX ocultos no detalhe", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    db.fichaCadastral.findUnique.mockResolvedValue({ ...ficha, dados: { ...DADOS, pixChave: "x@y.com" }, arquivos: [], employee: null });
    db.company.findMany.mockResolvedValue([]);
    const r = await request(app).get("/employee-forms/f1");
    expect(r.body.dadosEmpresa.salario).toBeNull();
    expect(r.body.dados.cpf).toBe("•••");
    expect(r.body.dados.pixChave).toBe("•••");
    expect(r.body.salarioOculto).toBe(true);
  });

  test("sem ver Funcionários, salvar a parte da empresa mantém o salário gravado", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    await request(app).put("/employee-forms/f1/empresa").send({ funcao: "Copeira" });
    expect(db.fichaCadastral.updateMany.mock.calls[0][0].data.dadosEmpresa).toMatchObject({ funcao: "Copeira", salario: 2500 });
  });

  test("parte da empresa não muda depois de concluída", async () => {
    ficha.status = "CONCLUIDA";
    expect((await request(app).put("/employee-forms/f1/empresa").send({ funcao: "Copeira" })).status).toBe(409);
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
  });

  test("situação inválida no filtro = 400", async () => {
    expect((await request(app).get("/employee-forms?status=XYZ")).status).toBe(400);
  });

  test("sem ver Funcionários, números de documento também ficam ocultos", async () => {
    db.fichaCadastral.findUnique.mockResolvedValue({ ...ficha, dados: { ...DADOS, pis: "12012345672" }, arquivos: [], employee: null });
    db.company.findMany.mockResolvedValue([]);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).get("/employee-forms/f1");
    expect(r.body.dados).toMatchObject({ cpf: "•••", rg: "•••", pis: "•••", nomeMae: "Beltrana de Tal" });
    expect(JSON.stringify(r.body)).not.toContain("123456789");
  });

  test("detalhe não devolve o hash do link", async () => {
    db.fichaCadastral.findUnique.mockResolvedValue({ ...ficha, tokenHash: "segredo", arquivos: [], employee: null });
    db.company.findMany.mockResolvedValue([]);
    const r = await request(app).get("/employee-forms/f1");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});

describe("atualização em lote", () => {
  test("gera link só para quem não tem ficha aberta e devolve os códigos uma vez", async () => {
    db.employee.findMany.mockResolvedValue([
      { ...funcionario, id: "e1", phone: "(11) 91234-5678" },
      { ...funcionario, id: "e2", firstName: "Bia", lastName: "Exemplo", phone: null },
    ]);
    db.fichaCadastral.findMany.mockResolvedValue([{ id: "f9", employeeId: "e2" }]);
    db.employeeDependente.findMany.mockResolvedValue([]);
    db.fichaCadastral.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "nova-" + String(data.employeeId), expiraEm: new Date(), ...data }));
    const r = await request(app).post("/employee-forms/lote");
    expect(r.status).toBe(201);
    expect(r.body.criadas).toHaveLength(1);
    expect(r.body.criadas[0]).toMatchObject({ employeeId: "e1", nome: "Fulana Souza", celular: "(11) 91234-5678" });
    expect(r.body.criadas[0].codigo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.jaAbertas).toEqual([{ fichaId: "f9", employeeId: "e2", nome: "Bia Exemplo" }]);
    const data = db.fichaCadastral.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tipo: "ATUALIZACAO", employeeId: "e1", tokenHash: hashCodigo(r.body.criadas[0].codigo) });
    expect(db.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, isActive: true } }));
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  test("gerar link (lote, ficha nova, novo link) exige também ver Funcionários", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).post("/employee-forms/lote")).status).toBe(403);
    expect((await request(app).post("/employee-forms").send({ tipo: "ADMISSAO", nomeReferencia: "Joana Exemplo" })).status).toBe(403);
    ficha.status = "PREENCHENDO";
    expect((await request(app).post("/employee-forms/f1/novo-link")).status).toBe(403);
    expect(db.fichaCadastral.create).not.toHaveBeenCalled();
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("falha no meio do lote não devolve links (a transação desfaz tudo)", async () => {
    db.employee.findMany.mockResolvedValue([{ ...funcionario, id: "e1" }, { ...funcionario, id: "e2" }]);
    db.fichaCadastral.findMany.mockResolvedValue([]);
    db.fichaCadastral.create.mockResolvedValueOnce({ id: "nova", expiraEm: new Date() }).mockRejectedValueOnce(new Error("timeout"));
    const r = await request(app).post("/employee-forms/lote");
    expect(r.status).toBe(500);
    expect(r.body.criadas).toBeUndefined();
  });
});

describe("fotos e documentos", () => {
  test("abrir exige também ver Funcionários; sem ela, nem consulta o arquivo", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).get("/employee-forms/f1/arquivos/a1");
    expect(r.status).toBe(403);
    expect(db.fichaCadastralArquivo.findFirst).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "employees", "view");
  });
});

describe("correções pela leitura dos documentos", () => {
  test("troca o digitado pelo valor do documento, com nome no padrão do cadastro", async () => {
    const r = await request(app).put("/employee-forms/f1/correcoes").send({ valores: { cpf: "111.444.777-35", nomeMae: "BELTRANA DE TAL SOUZA" } });
    expect(r.status).toBe(200);
    const dados = db.fichaCadastral.updateMany.mock.calls[0][0].data.dados;
    expect(dados).toMatchObject({ cpf: "11144477735", nomeMae: "Beltrana de Tal Souza", nomeCompleto: "Fulana de Tal Souza" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "FICHA_CADASTRAL_CORRIGIDA_PELO_DOCUMENTO" }));
  });

  test("não apaga campo, não aceita campo fora da lista nem valor inválido", async () => {
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { dataNascimento: "" } })).status).toBe(400);
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { pixChave: "x@y.com" } })).status).toBe(400);
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { cpf: "123.456.789-00" } })).status).toBe(400);
    expect(db.fichaCadastral.updateMany).not.toHaveBeenCalled();
  });

  test("ficha alterada no meio da conferência: não sobrescreve", async () => {
    db.fichaCadastral.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { rg: "1234567" } })).status).toBe(409);
  });

  test("só em ficha enviada e só para quem vê Funcionários", async () => {
    ficha.status = "PREENCHENDO";
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { rg: "1234567" } })).status).toBe(409);
    ficha.status = "FINALIZADA";
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).put("/employee-forms/f1/correcoes").send({ valores: { rg: "1234567" } })).status).toBe(403);
  });
});
