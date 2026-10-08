import { beforeEach, describe, expect, test, vi } from "vitest";

// Importar o extrato com o banco de mentira: reimportar não ressuscita o lançamento que
// alguém excluiu à mão, restaura o excluído legado (sem autor) e não cria lançamento de
// líquido zero.
const textoDoPdf = vi.hoisted(() => ({ atual: "" }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() { return { text: textoDoPdf.atual }; }
  },
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../rh-extract-store.service.js", () => ({
  guardarExtrato: vi.fn(async () => ({ id: "rh1", atualizado: false })),
  preencherAdmissaoCarteira: vi.fn(async () => 0),
  avisosDoExtrato: vi.fn(async () => ["aviso do PDF"]),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  mapaCombinados: vi.fn(async () => new Map()),
  gorjetasDaCompetencia: vi.fn(async () => null),
}));
vi.mock("../../../config/database.js", () => ({
  prisma: {
    company: { findMany: vi.fn(), create: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
    dRECategory: { findFirst: vi.fn(), create: vi.fn() },
    employee: { findMany: vi.fn(), create: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "../../../config/database.js";
import { importExtrato } from "../rh-extract.service.js";
import { gorjetasDaCompetencia, mapaCombinados } from "../salario-combinado.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Mesmo formato de rh-extract-adiantamento.test.ts (nome e CPF fictícios).
function extrato(calculo: "Adiantamento" | "Folha Mensal", liquido = "1.034,00") {
  return `Página: 1/2
Emissão: 08/09/2026
EXTRATO MENSAL
09/2026
Cálculo: ${calculo}
05.520.881/0001-95
PATEO DA LUZ COMERCIO DE ALIMENTOS LTDA
CNPJ:
1133 FULANO DE TAL	Empr.: 01/03/2007	Adm:	111.222.333-44	Trabalhando CPF:	Situação:
Cargo: 513210 COZINHEIRO 2.584,16	Salário:	C.B.O: Filial: 1	513205
980 ADIANTAMENTO SALARIAL P	1.033,66	40,00
ND: 0 Proventos: ${liquido} Líquido:	Descontos: 0,00 Informativa: 0 Informativa Dedutora: 0 ${liquido}
NF: 0 Base INSS: 0,00
`;
}
const importar = () => importExtrato({ buffer: Buffer.from("%PDF"), userId: "u1", fileName: "x.pdf", sha256: "abc" });

beforeEach(() => {
  vi.clearAllMocks();
  textoDoPdf.atual = extrato("Folha Mensal");
  db.company.findMany.mockResolvedValue([{ id: "c1", cnpj: "05520881000195" }]);
  db.payrollSettings.findUnique.mockResolvedValue({ advanceDueDay: 20, salaryDueDay: 5 });
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "111.222.333-44" }]);
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findUnique.mockResolvedValue(null);
  db.payrollItem.update.mockResolvedValue({});
  db.payrollItem.create.mockResolvedValue({});
  db.payrollItem.findMany.mockResolvedValue([]);
  vi.mocked(mapaCombinados).mockResolvedValue(new Map());
  vi.mocked(gorjetasDaCompetencia).mockResolvedValue(null);
});

describe("importExtrato — lançamento excluído", () => {
  test("excluído à mão: não restaura nem altera, conta como pulado e avisa", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: new Date("2026-09-15T15:00:00Z"), deletedById: "u9" });
    const r = await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ titulosGerados: 0, titulosNovos: 0, titulosAtualizados: 0, titulosPulados: 1, excluidosAMao: 1, zerados: 0, desligados: 0 });
    expect(r.avisos[0]).toBe(
      "Lançamento de FULANO DE TAL (Salário 09/2026) foi excluído à mão em 15/09 e não foi recriado; se precisar, restaure pela Folha.",
    );
    expect(r.avisos).toContain("aviso do PDF");
  });

  test("a data do aviso é a de São Paulo (excluído 01h UTC do dia 16 = 22h do dia 15)", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: new Date("2026-09-16T01:00:00Z"), deletedById: "u9" });
    expect((await importar()).avisos[0]).toContain("excluído à mão em 15/09");
  });

  test("excluído legado (sem autor): restaura, e conta como novo", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: new Date("2026-08-01T12:00:00Z"), deletedById: null });
    const r = await importar();
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1" }, data: expect.objectContaining({ amount: 1034, deletedAt: null, deletedById: null, source: "EXTRATO_RH" }),
    }));
    expect(r).toMatchObject({ titulosGerados: 1, titulosNovos: 1, titulosAtualizados: 0, titulosPulados: 0 });
  });

  test("ativo: atualiza; inexistente: cria", async () => {
    db.payrollItem.findUnique.mockResolvedValueOnce({ id: "p1", deletedAt: null, deletedById: null });
    expect(await importar()).toMatchObject({ titulosAtualizados: 1, titulosNovos: 0 });
    db.payrollItem.findUnique.mockResolvedValueOnce(null);
    expect(await importar()).toMatchObject({ titulosAtualizados: 0, titulosNovos: 1 });
    expect(db.payrollItem.create.mock.calls[0][0].data).toMatchObject({
      employeeId: "e1", type: "SALARIO", periodLabel: "Extrato 09/2026", competenceYear: 2026, competenceMonth: 9, amount: 1034,
    });
  });
});

describe("importExtrato — líquido zero", () => {
  beforeEach(() => { textoDoPdf.atual = extrato("Folha Mensal", "0,00"); });

  test("sem lançamento: não cria (fica só no holerite) e avisa sem valores", async () => {
    const r = await importar();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    // Líquido zero não é "excluído à mão": conta no motivo próprio.
    expect(r).toMatchObject({ titulosGerados: 0, titulosPulados: 1, zerados: 1, excluidosAMao: 0 });
    expect(r.avisos).toContain("1 pessoa(s) com líquido zero no extrato: nenhum lançamento novo foi criado (ficam só no holerite guardado).");
  });

  test("excluído legado de zero não volta", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: new Date(), deletedById: null });
    await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("lançamento de zero já ativo fica (é atualizado, não apagado)", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: null, deletedById: null });
    const r = await importar();
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1" } }));
    expect(r).toMatchObject({ titulosAtualizados: 1, titulosPulados: 0 });
  });
});

describe("importExtrato — adiantamento gravado como salário", () => {
  beforeEach(() => { textoDoPdf.atual = extrato("Adiantamento"); });

  test("só converte o SALARIO ativo (a busca exige deletedAt null)", async () => {
    await importar();
    expect(db.payrollItem.findFirst.mock.calls[0][0].where).toMatchObject({
      type: "SALARIO", periodLabel: "Extrato 09/2026", source: "EXTRATO_RH", deletedAt: null,
    });
  });

  test("com a chave do adiantamento excluída à mão: não converte o salário antigo e pula", async () => {
    db.payrollItem.findFirst
      .mockResolvedValueOnce({ id: "sal", amount: 1034 })   // SALARIO "Extrato" ativo, mesmo valor
      .mockResolvedValueOnce({ id: "adi" });                // chave do adiantamento ocupada (excluída)
    db.payrollItem.findUnique.mockResolvedValue({ id: "adi", deletedAt: new Date("2026-09-10T15:00:00Z"), deletedById: "u9" });
    const r = await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.avisos[0]).toContain("(Adiantamento 09/2026) foi excluído à mão em 10/09");
  });
});

describe("folha do mês sem o extrato do adiantamento", () => {
  const folhaComDesconto = () => extrato("Folha Mensal", "1.500,00")
    .replace("980 ADIANTAMENTO SALARIAL P\t1.033,66\t40,00", "1 HORAS NORMAIS 981 1.033,66 D\tP\t2.533,66\t220,00 DESC.ADIANT.SALARIAL 1.033,66");
  const chave = (args: { where: { employeeId_type_competenceYear_competenceMonth_periodLabel: { type: string } } }) =>
    args.where.employeeId_type_competenceYear_competenceMonth_periodLabel.type;

  test("cria o adiantamento a partir do desconto da folha, vencendo no dia 20", async () => {
    textoDoPdf.atual = folhaComDesconto();
    db.payrollItem.findUnique.mockResolvedValue(null);
    const r = await importar();
    const criados = db.payrollItem.create.mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data);
    const adiant = criados.find((d: Record<string, unknown>) => d.type === "ADIANTAMENTO");
    expect(adiant).toMatchObject({ amount: 1033.66, periodLabel: "Adiantamento 09/2026", source: "EXTRATO_RH" });
    expect((adiant!.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-09-20");
    expect((adiant!.details as { origem: string }).origem).toBe("FOLHA_DO_MES");
    expect(r.adiantamentosDaFolha).toBe(1);
    expect(r.avisos.some((a) => a.includes("a partir do desconto da folha"))).toBe(true);
  });

  test("não cria quando o mês já tem o adiantamento (do extrato do dia 20 ou excluído à mão)", async () => {
    textoDoPdf.atual = folhaComDesconto();
    db.payrollItem.findUnique.mockImplementation(async (args: Parameters<typeof chave>[0]) =>
      chave(args) === "ADIANTAMENTO" ? { id: "ja", deletedAt: null, deletedById: null } : null);
    const r = await importar();
    const tipos = db.payrollItem.create.mock.calls.map((c: [{ data: { type: string } }]) => c[0].data.type);
    expect(tipos).not.toContain("ADIANTAMENTO");
    expect(r.adiantamentosDaFolha).toBe(0);
  });

  test("o extrato do adiantamento não cria nada a partir da folha", async () => {
    textoDoPdf.atual = extrato("Adiantamento");
    db.payrollItem.findUnique.mockResolvedValue(null);
    const r = await importar();
    expect(r.adiantamentosDaFolha).toBe(0);
  });
});

// Travas de duplicidade e de saída também na importação: o extrato não cria o segundo
// pagamento do mês (o gerado pela folha ou lançado à mão, com outro rótulo) nem paga
// competência depois do desligamento.
describe("importExtrato — travas de duplicidade e de saída", () => {
  const salarioGerado = { id: "g1", employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Salário", amount: 1000, status: "PENDING", deletedAt: null, paymentDate: null, details: null, periodStart: null, dueDate: new Date("2026-10-05T00:00:00Z") };

  test("já existe o salário de setembro com outro rótulo: não cria, pula e avisa", async () => {
    db.payrollItem.findMany.mockResolvedValue([salarioGerado]);
    const r = await importar();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ titulosNovos: 0, titulosPulados: 1, comOutroRotulo: 1, excluidosAMao: 0 });
    expect(r.avisos.some((a) => a.includes("FULANO DE TAL") && a.includes('"Salário"') && a.includes("não criou outro"))).toBe(true);
  });

  test("o já existente é um complemento: o extrato cria o dele normalmente", async () => {
    db.payrollItem.findMany.mockResolvedValue([{ ...salarioGerado, details: { complemento: { motivo: "diferença de horas" } } }]);
    const r = await importar();
    expect(db.payrollItem.create).toHaveBeenCalledTimes(1);
    expect(r.titulosNovos).toBe(1);
  });

  test("pessoa que saiu em agosto: extrato de setembro não cria nada e avisa", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "111.222.333-44", terminationDate: new Date("2026-08-20T00:00:00Z") }]);
    const r = await importar();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.titulosPulados).toBe(1);
    expect(r).toMatchObject({ desligados: 1, excluidosAMao: 0 });
    expect(r.avisos.some((a) => a.includes("saiu em 20/08/2026"))).toBe(true);
  });

  test("saiu no próprio mês do extrato: lança normalmente", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e1", cpf: "111.222.333-44", terminationDate: new Date("2026-09-10T00:00:00Z") }]);
    expect((await importar()).titulosNovos).toBe(1);
  });

  test("adiantamento da folha não é criado quando já existe um adiantamento do mês com outro rótulo", async () => {
    textoDoPdf.atual = extrato("Folha Mensal", "1.500,00")
      .replace("980 ADIANTAMENTO SALARIAL P\t1.033,66\t40,00", "1 HORAS NORMAIS 981 1.033,66 D\tP\t2.533,66\t220,00 DESC.ADIANT.SALARIAL 1.033,66");
    db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === "ADIANTAMENTO" ? [{ ...salarioGerado, id: "a1", type: "ADIANTAMENTO", periodLabel: "Adiantamento" }] : []);
    const r = await importar();
    const tipos = db.payrollItem.create.mock.calls.map((c: [{ data: { type: string } }]) => c[0].data.type);
    expect(tipos).not.toContain("ADIANTAMENTO");
    expect(r.adiantamentosDaFolha).toBe(0);
  });
});

// Regra do dono: quem tem salário combinado recebe no dia 5 o valor INTEGRAL,
// (combinado − adiantamento) + gorjeta dos pontos — não só o líquido do extrato.
describe("importExtrato — salário combinado", () => {
  // Líquido 3.030,00 e desconto do adiantamento de 1.468,80 (setembro do caso real).
  const folhaDoCombinado = () => extrato("Folha Mensal", "3.030,00")
    .replace("980 ADIANTAMENTO SALARIAL P	1.033,66	40,00", "1 HORAS NORMAIS 981 1.033,66 D	P	3.672,00	220,00 DESC.ADIANT.SALARIAL 1.468,80");
  const salarioCriado = () => db.payrollItem.create.mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data)
    .find((d: Record<string, unknown>) => d.type === "SALARIO");

  beforeEach(() => {
    textoDoPdf.atual = folhaDoCombinado();
    vi.mocked(mapaCombinados).mockResolvedValue(new Map([["e1", 5200]]));
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(new Map([["e1", { noPeriodo: true, gorjetaLiquida: 2223.54 }]]));
  });

  test("com combinado e gorjeta apurada: lança o valor integral e guarda a composição", async () => {
    await importar();
    expect(mapaCombinados).toHaveBeenCalledWith(2026, 9, ["e1"]);
    expect(gorjetasDaCompetencia).toHaveBeenCalledWith(2026, 9);
    const sal = salarioCriado();
    expect(sal.amount).toBe(5954.74);
    expect(sal.details).toMatchObject({
      liquido: 3030, liquidoExtrato: 3030, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54,
      complemento: 2924.74, origemValor: "SALARIO_COMBINADO",
    });
    expect(typeof (sal.details as { composicao: string }).composicao).toBe("string");
  });

  test("sem combinado: o líquido do extrato, como sempre, sem calcular gorjeta", async () => {
    vi.mocked(mapaCombinados).mockResolvedValue(new Map());
    await importar();
    const sal = salarioCriado();
    expect(sal.amount).toBe(3030);
    expect(sal.details).not.toHaveProperty("origemValor");
    expect(sal.details).not.toHaveProperty("pendenteGorjeta");
    expect(gorjetasDaCompetencia).not.toHaveBeenCalled();
  });

  test("sem apuração da gorjeta: lança o líquido, marca pendente e avisa", async () => {
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(null);
    const r = await importar();
    const sal = salarioCriado();
    expect(sal.amount).toBe(3030);
    expect(sal.details).toMatchObject({ pendenteGorjeta: true, combinado: 5200, liquidoExtrato: 3030 });
    expect(r.avisos).toContain("Salário combinado de FULANO DE TAL: gorjeta do mês ainda não apurada; lançado o líquido do extrato. Será atualizado ao fechar a gorjeta.");
  });

  // Auditoria 01/10: fora da apuração existente (em teste, fora do período) ficava pendente
  // para sempre. Igual à folha de líquidos: gorjeta zero, valor = combinado − adiantamento.
  test("pessoa fora da apuração (que existe): gorjeta zero, não fica pendente", async () => {
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(new Map([["outro", { noPeriodo: true, gorjetaLiquida: 1 }]]));
    await importar();
    const sal = salarioCriado();
    expect(sal.amount).toBe(3731.2);
    expect(sal.details).toMatchObject({ origemValor: "SALARIO_COMBINADO", gorjetaIntegral: 0 });
    expect(sal.details).not.toHaveProperty("pendenteGorjeta");
  });

  test("gorjeta paga na rescisão (termo): não soma de novo", async () => {
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(new Map([["e1", { noPeriodo: true, gorjetaLiquida: 2223.54, pagoNaRescisao: true }]]));
    await importar();
    expect(salarioCriado().amount).toBe(3731.2);
  });

  test("erro ao calcular a gorjeta: fica pendente e o erro vira aviso (não some)", async () => {
    vi.mocked(gorjetasDaCompetencia).mockRejectedValue(new Error("faturamento indisponível"));
    const r = await importar();
    expect(salarioCriado().amount).toBe(3030);
    expect(r.avisos.some((a) => a.includes("faturamento indisponível"))).toBe(true);
  });

  test("reimportação: atualiza o lançamento ativo para o valor integral", async () => {
    db.payrollItem.findUnique.mockImplementation(async (args: { where: { employeeId_type_competenceYear_competenceMonth_periodLabel: { type: string } } }) =>
      args.where.employeeId_type_competenceYear_competenceMonth_periodLabel.type === "SALARIO" ? { id: "p1", deletedAt: null, deletedById: null } : { id: "a1", deletedAt: null, deletedById: null });
    const r = await importar();
    const upd = db.payrollItem.update.mock.calls.find((c: [{ where: { id: string } }]) => c[0].where.id === "p1")[0];
    expect(upd.data.amount).toBe(5954.74);
    expect(upd.data.details).toMatchObject({ origemValor: "SALARIO_COMBINADO" });
    expect(r.titulosAtualizados).toBe(1);
  });

  test("reimportação não ressuscita o salário excluído à mão", async () => {
    db.payrollItem.findUnique.mockImplementation(async (args: { where: { employeeId_type_competenceYear_competenceMonth_periodLabel: { type: string } } }) =>
      args.where.employeeId_type_competenceYear_competenceMonth_periodLabel.type === "SALARIO"
        ? { id: "p1", deletedAt: new Date("2026-09-15T15:00:00Z"), deletedById: "u9" } : { id: "a1", deletedAt: null, deletedById: null });
    const r = await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(salarioCriado()).toBeUndefined();
    expect(r.titulosPulados).toBe(1);
  });

  test("extrato do adiantamento: não olha salário combinado", async () => {
    textoDoPdf.atual = extrato("Adiantamento");
    await importar();
    expect(mapaCombinados).not.toHaveBeenCalled();
  });
});

// Auditoria 01/10: reimportar o extrato atualizava valor e detalhes do salário/adiantamento
// já PAGO. Pago não muda: pula e avisa com o valor que o extrato traz.
describe("importExtrato — lançamento já pago", () => {
  test("salário pago: não atualiza, conta como pulado e avisa com o valor do extrato", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: null, deletedById: null, paymentDate: new Date("2026-10-05T12:00:00Z"), amount: 1000 });
    const r = await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ titulosAtualizados: 0, titulosNovos: 0, titulosPulados: 1 });
    expect(r.avisos.map((a) => a.replace(/\s/g, " "))).toContain("FULANO DE TAL: salário de 09/2026 já pago: não atualizado (extrato traz R$ 1.034,00).");
  });

  test("adiantamento pago: idem", async () => {
    textoDoPdf.atual = extrato("Adiantamento");
    db.payrollItem.findUnique.mockResolvedValue({ id: "a1", deletedAt: null, deletedById: null, paymentDate: new Date("2026-09-20T12:00:00Z"), amount: 1000 });
    const r = await importar();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.avisos.map((a) => a.replace(/\s/g, " "))).toContain("FULANO DE TAL: adiantamento de 09/2026 já pago: não atualizado (extrato traz R$ 1.034,00).");
  });

  test("em aberto continua sendo atualizado", async () => {
    db.payrollItem.findUnique.mockResolvedValue({ id: "p1", deletedAt: null, deletedById: null, paymentDate: null, amount: 1000 });
    const r = await importar();
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1" } }));
    expect(r.titulosAtualizados).toBe(1);
  });
});
