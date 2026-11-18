import { beforeEach, describe, expect, test, vi } from "vitest";

// 13º de quem entrou ANTES do registro: o período sem registro vai SOMADO ao título do extrato da contabilidade
// (um título só, com a explicação), no serviço, com banco de mentira e estado. Dados FICTÍCIOS (repo público).
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    tipPeriod: { findMany: vi.fn() },
    decimoTerceiroVariavel: { findMany: vi.fn() },
    rhExtract: { findMany: vi.fn(async () => []) },
    dRECategory: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn(async () => ({ status: "CLOSED", participants: [] })) }));
vi.mock("../folha-trava.js", () => ({ travarFolhaDaPessoa: vi.fn(async () => undefined) }));
vi.mock("../payroll.service.js", () => ({ FOLHA_CATEGORY: "Folha", computeStatus: vi.fn(() => "PENDING") }));
vi.mock("../cadastro-historico.service.js", () => ({
  cadastrosVigentes: vi.fn(async (emps: Array<{ id: string }>) => new Map(emps.map((e) => [e.id, e]))),
  carregarHistorico: vi.fn(async () => new Map()),
}));

import { prisma } from "../../../config/database.js";
import { ROTULO_13_EXTRATO_PARCELA_1, ROTULO_13_PARCELA_1 } from "../decimo-terceiro-sr.js";
import { gerarDecimoTerceiroSR, listarDecimoTerceiroSR } from "../decimo-terceiro.service.js";
import { montarListaDecimo13 } from "../decimo-terceiro-lista.js";
import { composicaoParaTela } from "../salario-combinado-folha.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Entrou em 01/01/2026 sem registro e foi registrada em 01/07/2026: o período sem registro vai de janeiro a junho (6 avos).
const pessoa = {
  id: "e1", firstName: "Bia", lastName: "Souza", sector: "Cozinha", modality: "CLT", baseSalary: 2400, salarioCombinado: null,
  admissionDate: new Date("2026-01-01T00:00:00Z"), admissaoCarteira: new Date("2026-07-01T00:00:00Z"), decimoTerceiroInicio: null, terminationDate: null,
};
const itemExtrato = (over: Record<string, unknown> = {}) => ({
  id: "x1", employeeId: "e1", periodLabel: ROTULO_13_EXTRATO_PARCELA_1, amount: 500, paidAmount: null, paymentDate: null, deletedAt: null, deletedById: null,
  status: "PENDING", details: { liquido: 500 }, employee: { firstName: "Bia", lastName: "Souza" }, ...over,
});

// Novembro fechado (a 2ª parcela exige a gorjeta de novembro fechada): períodos de jan a nov já encerrados e sem gente na apuração.
const fechaNovembro = () => db.tipPeriod.findMany.mockResolvedValue(
  Array.from({ length: 11 }, (_, i) => ({ competenceMonth: i + 1, periodEnd: new Date(Date.UTC(2026, i + 1, 0)) })),
);

// Banco de mentira com estado: o updateMany do título do extrato grava de verdade no objeto em memória.
let itens: Array<Record<string, unknown>>;
function monta(iniciais: Array<Record<string, unknown>>, emp: Record<string, unknown> = pessoa) {
  itens = iniciais.map((i) => ({ ...i }));
  db.employee.findMany.mockResolvedValue([emp]);
  // Respeita os filtros simples do banco real (paymentDate/deletedAt nulos): sem isso o sync mexeria em título pago.
  db.payrollItem.findMany.mockImplementation(async (q: { where?: { paymentDate?: unknown; deletedAt?: unknown } }) => itens.filter((i) =>
    (q?.where?.paymentDate !== null || i.paymentDate == null) && (q?.where?.deletedAt !== null || i.deletedAt == null)));
  db.payrollItem.updateMany.mockImplementation(async (q: { where: { id: string }; data: Record<string, unknown> }) => {
    const it = itens.find((x) => x.id === q.where.id);
    if (!it) return { count: 0 };
    Object.assign(it, q.data);
    return { count: 1 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.tipPeriod.findMany.mockResolvedValue([]);
  db.decimoTerceiroVariavel.findMany.mockResolvedValue([]);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.payrollItem.createMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

const linhaPre = async () => (await listarDecimoTerceiroSR(2026)).linhas.find((l) => l.preRegistro)!;

describe("prévia de quem entrou antes do registro", () => {
  test("6 avos de janeiro a junho; a 1ª parcela vai somada ao título do extrato (via extrato)", async () => {
    monta([itemExtrato()]);
    const l = await linhaPre();
    expect(l.calculo).toMatchObject({ avos: 6, salario: 2400 });
    expect(l.somaNoExtrato).toBe(true);
    expect(l.viaExtrato).toBe(true);
    expect(l.p1).toMatchObject({ existe: false, gerar: true, devido: l.calculo!.parcela1 });
    expect(l.complementoDescricao).toContain("13º do período sem registro, 1ª parcela");
    expect(l.complementoDescricao).toContain("01/01/2026 a 30/06/2026");
  });

  test("sem o título do extrato ainda: aguarda o extrato e não gera lançamento próprio", async () => {
    monta([]);
    const l = await linhaPre();
    expect(l.p1).toMatchObject({ aguardaExtrato: true, gerar: false });
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("quem tem salário combinado não soma o período sem registro junto (evita duas somas no mesmo título)", async () => {
    monta([itemExtrato()], { ...pessoa, salarioCombinado: 3000 });
    const l = await linhaPre();
    expect(l.somaNoExtrato).toBe(false);
    expect(l.viaExtrato).toBe(false);
  });
});

describe("gerar a 1ª parcela: um título só, com a explicação", () => {
  test("soma ao título do extrato (líquido + período sem registro) e NÃO cria lançamento próprio", async () => {
    monta([itemExtrato()]);
    const antes = await linhaPre();
    const p1 = antes.calculo!.parcela1;
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
    const titulo = itens[0];
    expect(Number(titulo.amount)).toBe(Math.round((500 + p1) * 100) / 100);
    const det = titulo.details as Record<string, unknown>;
    expect(det.liquidoExtrato).toBe(500);
    expect(det.complemento).toBe(p1);
    expect(String(det.complementoDescricao)).toContain("13º do período sem registro");
    expect(String(det.composicao)).toContain("líquido do extrato");
    expect(String(det.composicao)).toContain("13º do período sem registro");
  });

  test("gerar de novo não soma outra vez (idempotente)", async () => {
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    const depois = Number(itens[0].amount);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(Number(itens[0].amount)).toBe(depois);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("título do extrato já PAGO sem a soma: o período sem registro vira lançamento próprio (nunca soma em título pago)", async () => {
    monta([itemExtrato({ paymentDate: new Date("2026-11-30T00:00:00Z"), paidAmount: 500 })]);
    const l = await linhaPre();
    expect(l.viaExtrato).toBe(false);
    expect(l.p1.gerar).toBe(true);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).toHaveBeenCalledTimes(1);
    expect(Number(itens[0].amount)).toBe(500); // o título pago não mudou
  });

  test("título do extrato pago com valor diferente do líquido: manda conferir e não gera", async () => {
    monta([itemExtrato({ paymentDate: new Date("2026-11-30T00:00:00Z"), paidAmount: 900 })]);
    const previa = await listarDecimoTerceiroSR(2026);
    const l = previa.linhas.find((x) => x.preRegistro)!;
    expect(l.p1).toMatchObject({ conferir: true, gerar: false });
    expect(previa.avisos.join(" ")).toContain("já foi pago antes");
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("lançamento próprio antigo (gerado antes desta regra): continua separado, sem soma", async () => {
    const proprio = { id: "p1", employeeId: "e1", periodLabel: ROTULO_13_PARCELA_1, amount: 400, paidAmount: null, paymentDate: null, deletedAt: null, deletedById: null, status: "PENDING", details: { semRegistro: true, valorCalculado: 400 } };
    monta([itemExtrato(), proprio]);
    const l = await linhaPre();
    expect(l.viaExtrato).toBe(false);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(Number(itens.find((x) => x.id === "x1")!.amount)).toBe(500); // o título do extrato não foi somado
  });
});

describe("2ª parcela", () => {
  test("gerar a 2ª soma antes a 1ª ao título do extrato; a 2ª sai como o total menos a 1ª (nada a mais)", async () => {
    fechaNovembro();
    monta([itemExtrato()]);
    const antes = await linhaPre();
    expect(antes.viaExtrato).toBe(true);
    const p1 = antes.calculo!.parcela1;
    const total = antes.calculo!.total;
    await gerarDecimoTerceiroSR(2026, "u1", 2);
    // 1ª somada ao título do extrato (um título só)…
    expect(Number(itens[0].amount)).toBe(Math.round((500 + p1) * 100) / 100);
    // …e a 2ª criada à parte pelo resto: 1ª + 2ª = o 13º completo do período sem registro.
    expect(db.payrollItem.createMany).toHaveBeenCalledTimes(1);
    const criada = db.payrollItem.createMany.mock.calls[0][0].data[0];
    expect(criada.periodLabel).toBe("13º Salário - 2ª parcela");
    expect(Math.round((p1 + Number(criada.amount)) * 100) / 100).toBe(total);
  });

  test("sem o título do extrato (aguarda), a 2ª também não é gerada", async () => {
    fechaNovembro();
    monta([]);
    await gerarDecimoTerceiroSR(2026, "u1", 2);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("com a 1ª somada e paga, a 2ª é o 13º completo menos o que a 1ª carregou", async () => {
    fechaNovembro();
    monta([itemExtrato()]);
    const antes = await linhaPre();
    const p1 = antes.calculo!.parcela1;
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    const titulo = itens[0];
    titulo.paymentDate = new Date("2026-11-30T00:00:00Z");
    titulo.paidAmount = titulo.amount;
    const l = await linhaPre();
    expect(l.primeiraSomada).toBe(p1);
    expect(l.p2.devido).toBe(Math.round((l.calculo!.total - p1) * 100) / 100);
  });
});

describe("lista de pagamento (PDF): sem linha duplicada", () => {
  const pessoas = new Map([["e1", { nome: "Bia Souza", empresa: "Pateo Frei", pix: null, pixTipo: null, contaBancaria: null }]]);

  test("antes de lançar: UMA linha com extrato + período sem registro; o período sem registro não aparece de novo como 'a lançar'", async () => {
    monta([itemExtrato()]);
    const previa = await listarDecimoTerceiroSR(2026);
    const p1 = previa.linhas.find((x) => x.preRegistro)!.calculo!.parcela1;
    const lista = montarListaDecimo13(
      2026, 1,
      [{ employeeId: "e1", periodLabel: ROTULO_13_EXTRATO_PARCELA_1, amount: 500, paidAmount: null, paymentDate: null, dueDate: new Date("2026-11-30T00:00:00Z"), details: { liquido: 500 }, id: "x1" }] as never,
      previa.linhas.map((l) => ({ employeeId: l.employeeId, origem: l.origem, viaExtrato: l.viaExtrato, somaNoExtrato: l.somaNoExtrato, calculo: l.calculo, p1: l.p1, p: l.p1 })),
      pessoas as never,
    );
    expect(lista.linhas).toHaveLength(1);
    expect(lista.linhas[0].valor).toBe(Math.round((500 + p1) * 100) / 100);
    expect(lista.total).toBe(Math.round((500 + p1) * 100) / 100);
  });

  test("depois de lançar (somado): continua UMA linha, com o valor do título", async () => {
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    const previa = await listarDecimoTerceiroSR(2026);
    const t = itens[0];
    const lista = montarListaDecimo13(
      2026, 1,
      [{ employeeId: "e1", periodLabel: ROTULO_13_EXTRATO_PARCELA_1, amount: Number(t.amount), paidAmount: null, paymentDate: null, dueDate: new Date("2026-11-30T00:00:00Z"), details: t.details, id: "x1" }] as never,
      previa.linhas.map((l) => ({ employeeId: l.employeeId, origem: l.origem, viaExtrato: l.viaExtrato, somaNoExtrato: l.somaNoExtrato, calculo: l.calculo, p1: l.p1, p: l.p1 })),
      pessoas as never,
    );
    expect(lista.linhas).toHaveLength(1);
    expect(lista.linhas[0].valor).toBe(Number(t.amount));
  });
});

describe("explicação do título no Contas a Pagar", () => {
  test("título somado mostra líquido + o que foi somado = total", async () => {
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    const t = itens[0];
    const c = composicaoParaTela(t.details, Number(t.amount))!;
    expect(c.tipo).toBe("DECIMO_SOMADO");
    expect(c.liquidoExtrato).toBe(500);
    expect(c.total).toBe(Number(t.amount));
    expect(c.descricao).toContain("13º do período sem registro");
  });

  test("título do 13º do combinado antigo (sem descrição) segue mostrando 'diferença do salário combinado'", () => {
    const c = composicaoParaTela({ liquidoExtrato: 2000, complemento: 500, origemValor: "DECIMO_COMBINADO" }, 2500)!;
    expect(c.tipo).toBe("DECIMO_SOMADO");
    expect(c.descricao).toBe("diferença do salário combinado");
  });
});

describe("auditoria de valores: nunca pagar duas vezes", () => {
  const pessoas = new Map([["e1", { nome: "Bia Souza", empresa: "Pateo Frei", pix: null, pixTipo: null, contaBancaria: null }]]);

  test("depois de PAGAR o título somado, gerar a 1ª de novo não cria lançamento próprio (a 1ª já saiu dentro do título)", async () => {
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    itens[0].paymentDate = new Date("2026-11-30T00:00:00Z");
    itens[0].paidAmount = itens[0].amount;
    db.payrollItem.createMany.mockClear();
    const r = await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
    expect(r.criadas).toBe(0);
    expect(itens).toHaveLength(1);
  });

  test("pessoa que sai do cálculo (ex.: 'recebe 13º' desligado) com o título somado em aberto: avisa e gerar desfaz a soma", async () => {
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(Number(itens[0].amount)).toBeGreaterThan(500);
    db.employee.findMany.mockResolvedValue([]); // saiu do painel
    const previa = await listarDecimoTerceiroSR(2026);
    expect(previa.somasOrfas).toBe(1);
    expect(previa.avisos.join(" ")).toContain("não vale mais");
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(Number(itens[0].amount)).toBe(500);
  });

  test("lista da 2ª parcela: depois de a 1ª ser paga dentro do título, sai UMA linha 'a lançar' com o resto do 13º", async () => {
    fechaNovembro();
    monta([itemExtrato()]);
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    itens[0].paymentDate = new Date("2026-11-30T00:00:00Z");
    itens[0].paidAmount = itens[0].amount;
    const previa = await listarDecimoTerceiroSR(2026);
    const l = previa.linhas.find((x) => x.preRegistro)!;
    const lista = montarListaDecimo13(
      2026, 2,
      itens.map((t) => ({ id: String(t.id), employeeId: "e1", periodLabel: String(t.periodLabel), amount: Number(t.amount), paidAmount: t.paidAmount == null ? null : Number(t.paidAmount), paymentDate: (t.paymentDate as Date | null) ?? null, dueDate: new Date("2026-11-30T00:00:00Z"), details: t.details })) as never,
      previa.linhas.map((x) => ({ employeeId: x.employeeId, origem: x.origem, viaExtrato: x.viaExtrato, somaNoExtrato: x.somaNoExtrato, calculo: x.calculo, p1: x.p1, p: x.p2 })),
      pessoas as never,
    );
    expect(lista.linhas).toHaveLength(1);
    expect(lista.linhas[0].situacao).toBe("A_LANCAR");
    expect(lista.linhas[0].valor).toBe(l.p2.devido);
    expect(Math.round((l.primeiraSomada! + lista.linhas[0].valor) * 100) / 100).toBe(l.calculo!.total);
  });

  test("título do extrato ajustado à mão: a lista mostra o valor REAL do título e manda conferir (não inventa soma)", async () => {
    monta([itemExtrato({ amount: 650, details: { liquido: 500 } })]);
    const previa = await listarDecimoTerceiroSR(2026);
    const lista = montarListaDecimo13(
      2026, 1,
      [{ id: "x1", employeeId: "e1", periodLabel: ROTULO_13_EXTRATO_PARCELA_1, amount: 650, paidAmount: null, paymentDate: null, dueDate: new Date("2026-11-30T00:00:00Z"), details: { liquido: 500 } }] as never,
      previa.linhas.map((x) => ({ employeeId: x.employeeId, origem: x.origem, viaExtrato: x.viaExtrato, somaNoExtrato: x.somaNoExtrato, calculo: x.calculo, p1: x.p1, p: x.p1 })),
      pessoas as never,
    );
    expect(lista.linhas).toHaveLength(1);
    expect(lista.linhas[0].valor).toBe(650);
    expect(lista.linhas[0].aviso).toContain("ajustado à mão");
  });
});
