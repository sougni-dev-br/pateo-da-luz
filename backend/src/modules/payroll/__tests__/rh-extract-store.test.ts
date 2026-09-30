import { beforeEach, describe, expect, test, vi } from "vitest";

// Armazenamento do extrato com o banco de mentira: dedupe por sha256 (e pelos registros
// antigos, sem sha256), regravação das pessoas e avisos de rescisão/cadastro divergente.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    rhExtract: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    rhExtractPessoa: { deleteMany: vi.fn(), create: vi.fn() },
    employee: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { prisma } from "../../../config/database.js";
import { avisosDoExtrato, guardarExtrato } from "../rh-extract-store.service.js";
import type { DetalhesExtrato, PessoaExtrato } from "../rh-extract-detalhes.js";
import type { ExtratoParsed } from "../rh-extract.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function pessoa(over: Partial<PessoaExtrato> = {}): PessoaExtrato {
  return {
    matricula: "900", nome: "FULANO DE TAL", cpfNorm: "11122233344", situacao: "Trabalhando", vinculo: "Celetista", horasMes: 220,
    cargoCodigo: "7", cargo: "BARMAN", cbo: "513420", salarioBase: 2450, admissao: "2026-07-21", demissao: null, demissaoMotivo: null,
    proventos: 2450, descontos: 0, liquido: 2450, baseInss: 2450, baseFgts: 2450, baseIrrf: 2000, valorFgts: 196,
    liquidoRescisao: null, rubricas: [{ codigo: "1", descricao: "HORAS NORMAIS", tipo: "P", valor: 2450, referencia: 220 }],
    somaProventos: 2450, somaDescontos: 0, conferido: true, naoLidas: [], texto: "900 FULANO DE TAL ***.***.***-**",
    ...over,
  };
}
const detalhes = (pessoas: PessoaExtrato[]): DetalhesExtrato => ({ emissao: "2026-08-28", totalProventos: 2450, totalDescontos: 0, totalLiquido: 2450, pessoas });
const parsed: ExtratoParsed = {
  calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", cnpj: "12.345.678/0001-90", competenceYear: 2026, competenceMonth: 8,
  funcionarios: [{ nome: "FULANO DE TAL", cpf: "111.222.333-44", cpfNorm: "11122233344", liquido: 2450, gorjeta: null, adiantamento: null, situacao: "Trabalhando" }],
};
const guardar = () => guardarExtrato({
  parsed, detalhes: detalhes([pessoa()]), buffer: Buffer.from("%PDF-1.4 teste"), texto: "texto", sha256: "abc123",
  fileName: "Extrato.pdf", companyId: "c1", userId: "u1", totalLiquido: 2450, employeePorCpf: new Map([["11122233344", "e1"]]),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.rhExtract.create.mockResolvedValue({ id: "novo" });
  db.rhExtract.update.mockResolvedValue({});
  db.rhExtract.deleteMany.mockResolvedValue({ count: 0 });
  db.rhExtractPessoa.deleteMany.mockResolvedValue({ count: 1 });
  db.rhExtractPessoa.create.mockResolvedValue({});
  db.employee.findMany.mockResolvedValue([]);
  db.payrollItem.findMany.mockResolvedValue([]);
});

describe("guardarExtrato — dedupe por sha256", () => {
  test("arquivo novo cria o registro com o PDF, o texto e as pessoas (sem CPF)", async () => {
    db.rhExtract.findFirst.mockResolvedValue(null);
    const r = await guardar();
    expect(r).toEqual({ id: "novo", atualizado: false });
    const data = db.rhExtract.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ sha256: "abc123", calculo: "MENSAL", texto: "texto", totalProventos: 2450 });
    expect(Buffer.isBuffer(data.arquivo)).toBe(true);
    const pessoaGravada = db.rhExtractPessoa.create.mock.calls[0][0].data;
    expect(pessoaGravada).toMatchObject({ rhExtractId: "novo", employeeId: "e1", conferido: true });
    expect(JSON.stringify(pessoaGravada)).not.toMatch(/11122233344|111\.222\.333-44/);
    expect(pessoaGravada.rubricas.create).toHaveLength(1);
  });

  test("mesmo arquivo de novo atualiza o registro e regrava as pessoas, sem duplicar", async () => {
    db.rhExtract.findFirst.mockResolvedValueOnce({ id: "antigo" });
    const r = await guardar();
    expect(r).toEqual({ id: "antigo", atualizado: true });
    expect(db.rhExtract.create).not.toHaveBeenCalled();
    expect(db.rhExtract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "antigo" } }));
    expect(db.rhExtractPessoa.deleteMany).toHaveBeenCalledWith({ where: { rhExtractId: "antigo" } });
    expect(db.rhExtractPessoa.create.mock.calls[0][0].data.rhExtractId).toBe("antigo");
    // Cópias do mesmo arquivo importadas antes viram um registro só.
    expect(db.rhExtract.deleteMany).toHaveBeenCalledWith({ where: { sha256: "abc123", id: { not: "antigo" } } });
  });

  test("registro antigo sem sha256 é completado quando o conteúdo é o mesmo", async () => {
    db.rhExtract.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "legado" });
    const r = await guardar();
    expect(r).toEqual({ id: "legado", atualizado: true });
    expect(db.rhExtract.findFirst.mock.calls[1][0].where).toMatchObject({
      sha256: null, competenceYear: 2026, competenceMonth: 8, cnpj: "12.345.678/0001-90", headcount: 1, totalLiquido: 2450,
    });
    expect(db.rhExtract.update.mock.calls[0][0].data.sha256).toBe("abc123");
  });
});

describe("avisosDoExtrato", () => {
  const base = { calculo: "MENSAL" as const, competenceYear: 2026, competenceMonth: 8, incluirDadosPessoais: true };
  const demitido = pessoa({ demissao: "2026-08-01", liquidoRescisao: 5000, situacao: "Demitido" });

  test("rescisão no extrato sem título RESCISAO lançado → avisa", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "111.222.333-44", baseSalary: 2450, position: "BARMAN", admissionDate: new Date("2026-07-21T00:00:00Z") }]);
    const avisos = await avisosDoExtrato({ ...base, detalhes: detalhes([demitido]) });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/^Rescisão de FULANO DE TAL no extrato \(líquido R\$\s?5\.000,00, demitido em 01\/08\): confira se está lançada em Contas a Pagar\.$/);
  });

  test("rescisão já lançada em Contas a Pagar → não avisa", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "11122233344", baseSalary: 2450, position: "Barman", admissionDate: new Date("2026-07-21T00:00:00Z") }]);
    db.payrollItem.findMany.mockResolvedValue([{ competenceYear: 2026, competenceMonth: 8 }]);
    expect(await avisosDoExtrato({ ...base, detalhes: detalhes([demitido]) })).toEqual([]);
    expect(db.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({ employeeId: "e1", type: "RESCISAO", deletedAt: null });
  });

  test("pessoa sem cadastro vinculado com rescisão também avisa", async () => {
    const avisos = await avisosDoExtrato({ ...base, detalhes: detalhes([demitido]) });
    expect(avisos[0]).toMatch(/^Rescisão de FULANO DE TAL/);
  });

  test("salário, cargo e admissão diferentes do cadastro → avisos, sem valores para quem não vê dados pessoais", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "11122233344", baseSalary: 2300, position: "Garçom", admissionDate: new Date("2025-01-01T00:00:00Z") }]);
    const com = await avisosDoExtrato({ ...base, detalhes: detalhes([pessoa()]) });
    expect(com).toHaveLength(3);
    expect(com[0]).toMatch(/salário base no extrato de 08\/2026 é R\$\s?2\.450,00, no cadastro R\$\s?2\.300,00/);
    expect(com[1]).toContain('cargo no extrato de 08/2026 é "BARMAN", no cadastro "Garçom"');
    expect(com[2]).toContain("admissão no extrato é 21/07/2026, no cadastro 01/01/2025");
    const sem = await avisosDoExtrato({ ...base, incluirDadosPessoais: false, detalhes: detalhes([pessoa()]) });
    expect(sem[0]).toBe("FULANO DE TAL: salário base no extrato de 08/2026 difere do cadastro. O cadastro não foi alterado.");
  });

  test("leitura que não fechou vira aviso para conferir no PDF", async () => {
    const avisos = await avisosDoExtrato({ ...base, detalhes: detalhes([pessoa({ conferido: false, somaDescontos: 10, descontos: 20 })]) });
    expect(avisos[0]).toMatch(/^Leitura de FULANO DE TAL não fechou/);
  });
});
