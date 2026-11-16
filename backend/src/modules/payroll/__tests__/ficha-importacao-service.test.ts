import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FichaRegistro } from "../ficha-registro-parser.js";

// Serviço da importação da ficha com o banco de mentira: grava só o que foi marcado, refaz a
// prévia dentro da transação e trava quem não confere. Pessoa fictícia.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findMany: vi.fn(), update: vi.fn() },
    company: { findMany: vi.fn() },
    employeeDependente: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employeeFerias: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employeeAnotacaoCarteira: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employeeHistorico: { findMany: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog } from "../../security/security-utils.js";
import { aplicarImportacao, preverImportacao } from "../ficha-importacao.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const USUARIO = { id: "u1", nome: "Eli" };

const ficha = (over: Partial<FichaRegistro> = {}): FichaRegistro => ({
  registro: "000020", matriculaEsocial: "20", empregador: { nome: "EMPRESA TESTE LTDA", cnpj: "11.222.333/0001-81" },
  nome: "FULANA DE TAL", beneficiarios: [], endereco: "", cep: null,
  dataNascimento: null, naturalidade: null, nacionalidade: null, estadoCivil: null, pai: null, mae: null,
  rg: null, rgEmissao: null, rgOrgao: null, tituloEleitor: null, tituloZona: null, tituloSecao: null,
  ctpsNumero: "5299822", ctpsSerie: "4725", ctpsEmissao: null, ctpsUf: "SP", cpf: "529.982.247-25",
  racaCor: null, sexo: null, escolaridade: null, possuiDeficiencia: null,
  cargoAdmissao: "COZINHEIRO (A)", cboAdmissao: "513205", dataAdmissao: "2025-03-01", salarioAdmissao: 2000,
  jornada: null, fgtsOpcao: null, pis: null,
  salarios: [{ vigencia: "2026-11-01", valor: 2700, retroativoCompetencia: null }],
  cargos: [], ferias: [], ...over,
});

const VAZIO = {
  nomeCompleto: null, registroNumero: null, matriculaEsocial: null, nomeMae: null, nomePai: null, estadoCivil: null, nacionalidade: null, naturalidade: null,
  racaCor: null, escolaridade: null, possuiDeficiencia: null, rgDataEmissao: null, rgOrgaoEmissor: null,
  tituloEleitor: null, tituloZona: null, tituloSecao: null, ctpsNumero: "5299822", ctpsSerie: "4725", ctpsUf: "SP", ctpsDataEmissao: null,
  cbo: null, jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null, fgtsDataOpcao: null,
  rg: null, pis: null, birthDate: null, gender: "NAO_INFORMADO",
  zipCode: null, address: null, addressNumber: null, addressComplement: null, neighborhood: null, city: null, state: null,
};
const cadastro = (over: Record<string, unknown> = {}) => ({
  ...VAZIO, id: "e1", firstName: "Fulana", lastName: "de Tal", position: "Cozinheiro (a)", baseSalary: "2600",
  admissaoCarteira: d("2025-03-01"), admissionDate: d("2025-03-01"), terminationDate: null, isActive: true, companyId: "c1",
  company: { cnpj: "11.222.333/0001-81", tradeName: "Empresa Teste" }, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.employee.findMany.mockResolvedValue([cadastro()]);
  db.employee.update.mockResolvedValue({});
  db.company.findMany.mockResolvedValue([{ id: "c1", cnpj: "11.222.333/0001-81", tradeName: "Empresa Teste" }]);
  for (const t of ["employeeDependente", "employeeFerias", "employeeAnotacaoCarteira", "employeeHistorico"]) db[t].findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
});

describe("preverImportacao", () => {
  test("pessoa sem cadastro e CPF duplicado ficam marcados, sem itens", async () => {
    db.employee.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([cadastro(), cadastro({ id: "e2" })]);
    const pessoas = await preverImportacao([ficha(), ficha()], null, "2026-11-13");
    expect(pessoas.map((p) => p.situacao)).toEqual(["SEM_CADASTRO", "CPF_DUPLICADO"]);
    expect(pessoas.every((p) => p.itens.length === 0 && p.employeeId === null)).toBe(true);
  });

  test("primeiro nome diferente (CPF igual): NOME_DIFERENTE e todos os itens bloqueados", async () => {
    db.employee.findMany.mockResolvedValue([cadastro({ firstName: "Outra" })]);
    const [p] = await preverImportacao([ficha()], null, "2026-11-13");
    expect(p.situacao).toBe("NOME_DIFERENTE");
    expect(p.itens.length).toBeGreaterThan(0);
    expect(p.itens.every((i) => i.bloqueio?.includes("primeiro nome"))).toBe(true);
  });

  test("cadastro com itens: COM_ITENS, usando o id do cadastro como chave", async () => {
    const [p] = await preverImportacao([ficha()], "2026-11-01", "2026-11-13");
    expect(p).toMatchObject({ chave: "e1", employeeId: "e1", situacao: "COM_ITENS" });
    expect(p.itens.map((i) => i.id)).toContain("salario");
  });
});

describe("aplicarImportacao", () => {
  test("grava só os ids marcados: um campo vazio e nada mais", async () => {
    const r = await aplicarImportacao([ficha()], { e1: ["preenche:cbo"] }, "2026-11-01", "2026-11-13", null, USUARIO);
    expect(r).toEqual([{ employeeId: "e1", nome: "Fulana de Tal", aplicados: ["preenche:cbo"], ignorados: [] }]);
    expect(db.employee.update).toHaveBeenCalledTimes(1);
    expect(db.employee.update.mock.calls[0][0]).toEqual({ where: { id: "e1" }, data: { cbo: "513205" } });
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
    expect(db.employeeDependente.deleteMany).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  test("salário marcado: histórico com a vigência da ficha, motivo e usuário; cadastro recebe o último degrau", async () => {
    await aplicarImportacao([ficha()], { e1: ["salario"] }, "2026-11-01", "2026-11-13", "Dissídio 2026", USUARIO);
    const linha = db.employeeHistorico.createMany.mock.calls[0][0].data[0];
    expect(linha).toMatchObject({
      employeeId: "e1", campo: "baseSalary", valorAnterior: "2600.00", valorNovo: "2700.00", motivo: "Dissídio 2026",
      origem: "FICHA_REGISTRO", criadoPorId: "u1", criadoPorNome: "Eli",
    });
    expect(linha.vigenteDesde).toEqual(d("2026-11-01"));
    expect(db.employee.update.mock.calls[0][0].data).toEqual({ baseSalary: 2700 });
  });

  test("cargo marcado: grava no histórico do cadastro (vale desde a data da ficha) e troca o cargo", async () => {
    const f = ficha({ salarios: [], cargos: [{ data: "2026-05-01", deCbo: "513205", deCargo: "COZINHEIRO (A)", paraCbo: "513210", paraCargo: "LIDER DE PRACA" }] });
    await aplicarImportacao([f], { e1: ["cargo"] }, null, "2026-11-13", null, USUARIO);
    const linha = db.employeeHistorico.createMany.mock.calls[0][0].data[0];
    expect(linha).toMatchObject({ campo: "position", valorAnterior: "Cozinheiro (a)", valorNovo: "Lider de Praca", origem: "FICHA_REGISTRO", motivo: "Ficha de registro da contabilidade" });
    expect(linha.vigenteDesde).toEqual(d("2026-05-01"));
    expect(db.employee.update.mock.calls[0][0].data).toEqual({ position: "Lider de Praca" });
  });

  test("id que não existe mais ou bloqueado é ignorado com o motivo; o resto é gravado", async () => {
    db.employee.findMany.mockResolvedValue([cadastro({ terminationDate: d("2026-10-01") })]);
    const r = await aplicarImportacao([ficha()], { e1: ["salario", "preenche:cbo", "diverge:racaCor"] }, "2026-11-01", "2026-11-13", null, USUARIO);
    expect(r[0].aplicados).toEqual(["preenche:cbo"]);
    expect(r[0].ignorados).toEqual([
      { id: "salario", motivo: expect.stringMatching(/desligado/) },
      { id: "diverge:racaCor", motivo: expect.stringMatching(/já não vale/) },
    ]);
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("nome diferente: nada é gravado, tudo volta como ignorado", async () => {
    db.employee.findMany.mockResolvedValue([cadastro({ firstName: "Outra" })]);
    const r = await aplicarImportacao([ficha()], { e1: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO);
    expect(r[0].aplicados).toEqual([]);
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("seleção de quem não está no PDF ou sem itens marcados é ignorada sem abrir transação", async () => {
    expect(await aplicarImportacao([ficha()], { outro: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO)).toEqual([]);
    expect(await aplicarImportacao([ficha()], { e1: [] }, null, "2026-11-13", null, USUARIO)).toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("listas marcadas: regrava dependentes, férias e carteira da ficha", async () => {
    const f = ficha({ salarios: [], beneficiarios: ["CICLANO DE TAL"] });
    await aplicarImportacao([f], { e1: ["listas"] }, null, "2026-11-13", null, USUARIO);
    expect(db.employeeDependente.deleteMany).toHaveBeenCalledWith({ where: { employeeId: "e1", origem: "FICHA_REGISTRO" } });
    expect(db.employeeDependente.createMany.mock.calls[0][0].data).toEqual([{ employeeId: "e1", origem: "FICHA_REGISTRO", nome: "Ciclano de Tal" }]);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("falha de auditoria não desfaz nem derruba o que já foi gravado", async () => {
    vi.mocked(auditLog).mockRejectedValue(new Error("fora do ar"));
    const r = await aplicarImportacao([ficha()], { e1: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO);
    expect(r[0].aplicados).toEqual(["preenche:cbo"]);
  });

  test("cadastro que passou a ter dois com o mesmo CPF depois da prévia: nada é gravado e o motivo é dito", async () => {
    db.employee.findMany
      .mockResolvedValueOnce([cadastro()])
      .mockResolvedValueOnce([cadastro(), cadastro({ id: "e2" })]);
    const r = await aplicarImportacao([ficha()], { e1: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO);
    expect(r[0].aplicados).toEqual([]);
    expect(r[0].ignorados[0].motivo).toMatch(/cadastro mudou/);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("a mesma pessoa em duas fichas do PDF: a prévia bloqueia a segunda e a gravação faz só uma", async () => {
    const pessoas = await preverImportacao([ficha(), ficha()], null, "2026-11-13");
    expect(pessoas.map((p) => p.situacao)).toEqual(["COM_ITENS", "CPF_DUPLICADO"]);
    expect(new Set(pessoas.map((p) => p.chave)).size).toBe(2);
    await aplicarImportacao([ficha(), ficha()], { e1: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO);
    expect(db.employee.update).toHaveBeenCalledTimes(1);
  });

  test("erro numa pessoa não derruba as outras e a mensagem não traz o texto do erro", async () => {
    const outra = ficha({ cpf: "111.444.777-35", nome: "OUTRA PESSOA", registro: "000021" });
    db.employee.findMany.mockImplementation(async (args: { where: { cpf: { in: string[] } } }) =>
      args.where.cpf.in.includes("52998224725") ? [cadastro()] : [cadastro({ id: "e2", firstName: "Outra", lastName: "Pessoa" })]);
    let chamadas = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      chamadas += 1;
      if (chamadas === 1) throw new Error("falha com CPF 529.982.247-25 no banco");
      return fn(prisma);
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await aplicarImportacao([ficha(), outra], { e1: ["preenche:cbo"], e2: ["preenche:cbo"] }, null, "2026-11-13", null, USUARIO);
    expect(r[0].aplicados).toEqual([]);
    expect(r[0].ignorados[0].motivo).not.toMatch(/CPF|529/);
    expect(r[1].aplicados).toEqual(["preenche:cbo"]);
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/529/);
    erro.mockRestore();
  });
});
