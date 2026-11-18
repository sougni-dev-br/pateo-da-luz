import { beforeEach, describe, expect, test, vi } from "vitest";

// Fluxo do 13º da diferença do salário combinado no serviço (prévia, geração, acerto da 2ª parcela),
// com o banco de mentira. Dados FICTÍCIOS (repo público).
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    tipPeriod: { findMany: vi.fn() },
    decimoTerceiroVariavel: { findMany: vi.fn() },
    rhExtract: { findMany: vi.fn() },
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
  carregarHistorico: vi.fn(async () => new Map([["e1", [{ campo: "salarioCombinado", valorAnterior: null, valorNovo: "4500.00", vigenteDesde: new Date("2026-03-01T00:00:00Z"), createdAt: new Date("2026-03-01T00:00:00Z") }]]])),
}));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { ROTULO_13_EXTRATO_PARCELA_1 } from "../decimo-terceiro-sr.js";
import { gerarDecimoTerceiroSR, listarDecimoTerceiroSR, p1DoCombinado, primeiraSomadaDoExtrato } from "../decimo-terceiro.service.js";
import { valorComCombinado } from "../decimo-terceiro-combinado.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
// CLT com base 3.000 e combinado 4.500 (diferença 1.528 em outro exemplo: aqui 1.500), desde 01/03/2026 → 10 avos, 9 na 1ª.
const clt = {
  id: "e1", firstName: "Ana", lastName: "Silva", sector: "Gerência", modality: "CLT", baseSalary: 3000, salarioCombinado: 4500,
  admissionDate: new Date("2025-03-01T00:00:00Z"), admissaoCarteira: new Date("2025-03-01T00:00:00Z"), terminationDate: null, cpf: "000.000.001-91",
};
const itemExtrato = (over: Record<string, unknown> = {}) => ({
  id: "x1", employeeId: "e1", periodLabel: ROTULO_13_EXTRATO_PARCELA_1, amount: 2000, paidAmount: null, paymentDate: null, deletedAt: null, deletedById: null,
  details: { liquido: 2000 }, ...over,
});

function monta(itens: unknown[]) {
  db.employee.findMany.mockResolvedValue([clt]);
  db.payrollItem.findMany.mockImplementation(async (q: { select?: { periodLabel?: boolean }; where?: { periodLabel?: unknown } }) => {
    // listar: todos os rótulos do 13º; gerar/soma: os do extrato em aberto ou os de uma pessoa
    return itens;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.tipPeriod.findMany.mockResolvedValue([]);
  db.decimoTerceiroVariavel.findMany.mockResolvedValue([]);
  db.rhExtract.findMany.mockResolvedValue([]);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.payrollItem.createMany.mockResolvedValue({ count: 1 });
  db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

const comb = async () => (await listarDecimoTerceiroSR(2026)).linhas.find((l) => l.origem === "COMBINADO")!;

describe("prévia da diferença do combinado", () => {
  test("calcula pela diferença desde o início do combinado (10 avos; 1ª com 9)", async () => {
    monta([itemExtrato()]);
    const l = await comb();
    expect(l.calculo).toMatchObject({ salario: 1500, avos: 10, avosParcela1: 9, desde: "2026-03-01" });
    expect(l.calculo!.parcela1).toBe(562.5);
  });

  test("com o título do extrato em aberto e sem soma: falta somar (via extrato)", async () => {
    monta([itemExtrato()]);
    const l = await comb();
    expect(l.viaExtrato).toBe(true);
    expect(l.p1).toMatchObject({ existe: false, gerar: true, devido: 562.5 });
  });

  test("sem título do extrato: aguarda o extrato e não gera nada", async () => {
    monta([]);
    const l = await comb();
    expect(l.viaExtrato).toBe(false);
    expect(l.p1).toMatchObject({ aguardaExtrato: true, gerar: false });
  });
});

describe("p1DoCombinado e primeiraSomadaDoExtrato", () => {
  const propria = { existe: false, paga: false, lancado: null, devido: 500, gerar: true };
  const item = (over: Record<string, unknown>) => itemExtrato(over) as never;
  const somado = (c: number) => ({ liquido: 2000, ...valorComCombinado(2000, c).detalhes });

  test("somado e em dia: existe, não gera e marca que já está no título", () => {
    const r = p1DoCombinado(item({ amount: 2500, details: somado(500) }), propria, 500);
    expect(r.viaExtrato).toBe(true);
    expect(r.p1).toMatchObject({ existe: true, gerar: false, somadaAoExtrato: true, lancado: 500 });
  });
  test("somado com outro valor (o cálculo mudou): o título carrega o antigo e gerar atualiza", () => {
    const r = p1DoCombinado(item({ amount: 2500, details: somado(500) }), propria, 550);
    expect(r.viaExtrato).toBe(true);
    expect(r.p1).toMatchObject({ existe: true, lancado: 500, devido: 550, gerar: true, somadaAoExtrato: true });
  });
  test("pago COM a soma: nada a gerar e já faz parte do título", () => {
    const r = p1DoCombinado(item({ amount: 2500, paymentDate: new Date(), details: somado(500) }), propria, 500);
    expect(r.p1).toMatchObject({ paga: true, gerar: false, somadaAoExtrato: true });
    expect(r.viaExtrato).toBe(false);
  });
  test("pago SEM a soma: a diferença vira lançamento próprio (nunca soma em título pago)", () => {
    const r = p1DoCombinado(item({ paymentDate: new Date() }), propria, 500);
    expect(r.viaExtrato).toBe(false);
    expect(r.p1.gerar).toBe(true);
  });
  test("já lançada à parte (legado): não soma de novo", () => {
    const r = p1DoCombinado(item({ details: somado(500) }), { ...propria, existe: true, lancado: 500, gerar: false }, 500);
    expect(r.viaExtrato).toBe(false);
    expect(r.p1.existe).toBe(true);
  });
  test("título excluído é como se não existisse: aguarda", () => {
    expect(p1DoCombinado(item({ deletedAt: new Date() }), propria, 500).p1.aguardaExtrato).toBe(true);
  });

  test("o que a 1ª carregou: em aberto = o somado; pago = o que saiu acima do líquido; sem soma = null", () => {
    expect(primeiraSomadaDoExtrato(item({ amount: 2500, details: somado(500) }))).toBe(500);
    expect(primeiraSomadaDoExtrato(item({ amount: 2500, paymentDate: new Date(), paidAmount: 2480, details: somado(500) }))).toBe(480);
    // Pago abaixo do líquido: não declara a diferença como paga (a 2ª a cobraria).
    expect(primeiraSomadaDoExtrato(item({ amount: 2500, paymentDate: new Date(), paidAmount: 1900, details: somado(500) }))).toBe(0);
    expect(primeiraSomadaDoExtrato(item({}))).toBeNull();
    expect(primeiraSomadaDoExtrato(undefined)).toBeNull();
    expect(primeiraSomadaDoExtrato(item({ deletedAt: new Date(), details: somado(500) }))).toBeNull();
  });
});

describe("acerto da 2ª parcela da diferença", () => {
  test("com a 1ª somada e paga, a 2ª fecha o total com o que a 1ª PAGOU (não com o recalculado)", async () => {
    // 1ª somada e paga com 500 de diferença; o cálculo de hoje dá 562,50 (10 avos de 1.500): total 1.250.
    monta([itemExtrato({ amount: 2500, paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 2500, details: { liquido: 2000, ...valorComCombinado(2000, 500).detalhes } })]);
    const l = await comb();
    expect(l.calculo!.total).toBe(1250);
    expect(l.p2.devido).toBe(750); // 1.250 − 500 pagos
    expect(l.primeiraSomada).toBe(500);
  });

  test("sem soma, a 2ª usa o cálculo de hoje da 1ª", async () => {
    monta([itemExtrato()]);
    const l = await comb();
    expect(l.p2.devido).toBe(l.calculo!.total - l.calculo!.parcela1);
  });
});

describe("gerar", () => {
  test("1ª parcela: não cria lançamento próprio para a diferença; soma ao título do extrato", async () => {
    // 1ª chamada de findMany: prévia (todos os rótulos); depois a soma lê os do extrato em aberto.
    db.employee.findMany.mockResolvedValue([clt]);
    db.payrollItem.findMany.mockImplementation(async (q: { where: { periodLabel?: unknown; paymentDate?: unknown } }) => {
      const soExtratoEmAberto = q.where.paymentDate === null;
      return soExtratoEmAberto ? [{ ...itemExtrato(), employee: { firstName: "Ana", lastName: "Silva" } }] : [itemExtrato()];
    });
    const r = await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
    expect(r.somadas).toBe(1);
    const gravado = db.payrollItem.updateMany.mock.calls.find((c: [{ where: { id: string } }]) => c[0].where.id === "x1")![0].data;
    expect(gravado.amount).toBe(2562.5);
    expect(gravado.details).toMatchObject({ liquido: 2000, liquidoExtrato: 2000, complemento: 562.5, origemValor: "DECIMO_COMBINADO" });
  });

  test("erro ao somar não derruba a geração: vira aviso", async () => {
    db.employee.findMany.mockResolvedValue([clt]);
    let chamadas = 0;
    db.payrollItem.findMany.mockImplementation(async (q: { where: { paymentDate?: unknown } }) => {
      if (q.where.paymentDate === null) { chamadas += 1; throw new Error("banco indisponível"); }
      return [itemExtrato()];
    });
    const r = await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(chamadas).toBe(1);
    expect(r.avisos.join(" ")).toContain("Não foi possível somar");
  });
});

// Banco de mentira COM estado: a soma grava e a prévia seguinte já enxerga o que foi gravado.
function montaComEstado(inicial: Record<string, unknown>) {
  const estado = { ...inicial };
  db.employee.findMany.mockResolvedValue([clt]);
  db.tipPeriod.findMany.mockResolvedValue([{ competenceMonth: 11, periodEnd: new Date("2026-11-30T00:00:00Z") }]);
  db.payrollItem.findMany.mockImplementation(async (q: { where: { paymentDate?: unknown } }) => {
    const pago = estado.paymentDate != null;
    if (q.where.paymentDate === null) return pago ? [] : [{ ...estado, employee: { firstName: "Ana", lastName: "Silva" } }];
    return [{ ...estado }];
  });
  db.payrollItem.updateMany.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    if (where.id !== estado.id) return { count: 0 };
    Object.assign(estado, data);
    return { count: 1 };
  });
  return estado;
}

describe("2ª parcela: a soma da 1ª vem ANTES (reauditoria)", () => {
  test("1ª somada com valor antigo e cálculo mudado: sincroniza a 1ª e só então gera a 2ª, fechando o total", async () => {
    // 1ª carrega 100 de diferença; o cálculo de hoje dá 562,50 (total 1.250).
    const estado = montaComEstado(itemExtrato({ amount: 2100, details: { liquido: 2000, ...valorComCombinado(2000, 100).detalhes } }));
    const r = await gerarDecimoTerceiroSR(2026, "u1", 2);
    expect(estado.amount).toBe(2562.5); // a 1ª foi atualizada para o cálculo de hoje
    expect(r.somadas).toBe(1);
    const criada = db.payrollItem.createMany.mock.calls[0][0].data[0];
    expect(criada.periodLabel).toBe("13º Salário - 2ª parcela (combinado)");
    // 1ª (562,50) + 2ª (687,50) = 1.250: nem a mais, nem a menos.
    expect(criada.amount).toBe(687.5);
  });

  test("título ajustado à mão: a soma avisa e a 2ª NÃO é gerada (a 1ª diferença ficaria sem pagar)", async () => {
    montaComEstado(itemExtrato({ amount: 1950, details: { liquido: 2000 } }));
    const r = await gerarDecimoTerceiroSR(2026, "u1", 2);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
    expect(r.avisos.join(" ")).toContain("ajustado à mão");
    expect(r.avisos.join(" ")).toContain("a 2ª só é gerada depois");
  });

  test("1ª somada e paga: a 2ª usa o que a 1ª pagou", async () => {
    montaComEstado(itemExtrato({ amount: 2500, paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 2500, details: { liquido: 2000, ...valorComCombinado(2000, 500).detalhes } }));
    await gerarDecimoTerceiroSR(2026, "u1", 2);
    expect(db.payrollItem.createMany.mock.calls[0][0].data[0].amount).toBe(750);
  });
});

describe("título do extrato pago sem a soma, com valor diferente do líquido (reauditoria)", () => {
  test("não gera a diferença à parte: pode ter sido paga junto; avisa para conferir", async () => {
    montaComEstado(itemExtrato({ amount: 2562.5, paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 2562.5, details: { liquido: 2000 } }));
    const previa = await listarDecimoTerceiroSR(2026);
    const l = previa.linhas.find((x) => x.origem === "COMBINADO")!;
    expect(l.p1).toMatchObject({ conferir: true, gerar: false });
    expect(previa.avisos.join(" ")).toContain("já foi paga antes");
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("pago com o valor do líquido (sem a diferença): a diferença vira lançamento próprio", async () => {
    montaComEstado(itemExtrato({ amount: 2000, paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 2000, details: { liquido: 2000 } }));
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(db.payrollItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ periodLabel: "13º Salário - 1ª parcela (combinado)", amount: 562.5 });
  });
});

describe("título cancelado (reauditoria)", () => {
  test("cancelado não conta como título do extrato: a diferença aguarda o extrato", async () => {
    monta([itemExtrato({ status: "CANCELED" })]);
    const l = await comb();
    expect(l.p1.aguardaExtrato).toBe(true);
  });
});

describe("soma órfã e CANCELED na lista CLT (terceira auditoria)", () => {
  const semCombinado = { ...clt, salarioCombinado: null };
  const somado = (c: number) => ({ liquido: 2000, ...valorComCombinado(2000, c).detalhes });

  test("o combinado acabou mas o título ainda carrega a diferença: avisa, conta como órfã e lançar desfaz", async () => {
    const estado = montaComEstado(itemExtrato({ amount: 2562.5, details: somado(562.5) }));
    db.employee.findMany.mockResolvedValue([semCombinado]);
    const previa = await listarDecimoTerceiroSR(2026);
    expect(previa.linhas.some((l) => l.origem === "COMBINADO")).toBe(false);
    expect(previa.somasOrfas).toBe(1);
    expect(previa.avisos.join(" ")).toContain("não vale mais");
    await gerarDecimoTerceiroSR(2026, "u1", 1);
    expect(estado.amount).toBe(2000); // voltou ao líquido do extrato
  });

  test("sem soma órfã: contagem zero", async () => {
    monta([itemExtrato()]);
    expect((await listarDecimoTerceiroSR(2026)).somasOrfas).toBe(0);
  });

  test("a lista CLT não enxerga título cancelado", async () => {
    const { listarDecimoTerceiroClt } = await import("../decimo-terceiro.service.js");
    db.employee.findMany.mockResolvedValue([clt]);
    db.payrollItem.findMany.mockResolvedValue([]);
    await listarDecimoTerceiroClt(2026);
    expect(db.payrollItem.findMany.mock.calls.at(-1)[0].where).toMatchObject({ deletedAt: null, status: { not: "CANCELED" } });
  });

  test("pago com centavos de juros sobre o líquido não vira 'conferir'", async () => {
    montaComEstado(itemExtrato({ amount: 2000, paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 2000.4, details: { liquido: 2000 } }));
    const l = (await listarDecimoTerceiroSR(2026)).linhas.find((x) => x.origem === "COMBINADO")!;
    expect(l.p1.conferir).toBeUndefined();
    expect(l.p1.gerar).toBe(true); // diferença à parte
  });
});

// ── Diferença da gorjeta integral no 13º (decisão do Eli, 18/11/2026) ──────────────────────────────────────────
// Extrato do 13º FICTÍCIO: a rubrica "MEDIA VALOR" paga 100,00 na 1ª parcela (12 avos) → gorjeta declarada de 200,00 por mês.
const textoExtrato = (mediaValor: string | null) => [
  "Página: 1/1", "Emissão: 12/11/2026", "EXTRATO MENSAL", "11/2026", "Cálculo: 13o Adiantamento", "00.000.000/0001-00", "EMPRESA EXEMPLO COMERCIO LTDA",
  "20 ANA SILVA	Empr.: 01/03/2025	Adm:	000.000.001-91	Trabalhando CPF:	Situação:",
  "13 13 SALARIO ADIANTADO P	1.500,00	12,00", ...(mediaValor ? [`834 MEDIA VALOR 13o ADIANTADO P	${mediaValor}	12,00`] : []),
  "ND: 1 Proventos: 1.600,00 Líquido:	Descontos: 0,00 Informativa: 1 Informativa Dedutora: 0 1.600,00", "NF: 1 Base INSS: 0,00",
].join("\n");

// Gorjeta integral (netCommission) de ago, set e out: 1.000 / 1.200 / 800 → média 1.000.
function apuracao(porMes: Record<number, number | null>) {
  db.tipPeriod.findMany.mockResolvedValue(Object.keys(porMes).map((m) => ({ competenceMonth: Number(m), periodEnd: new Date("2026-01-01T00:00:00Z") })));
  vi.mocked(computeTipCommission).mockImplementation((async (_ano: number, mes: number) => ({
    status: "CLOSED",
    participants: porMes[mes] == null ? [] : [{ employeeId: "e1", netCommission: porMes[mes], tipoCalculo: "NORMAL", pagoNaRescisao: false, rateioAmount: 0 }],
  })) as never);
}

describe("diferença da gorjeta integral no 13º do combinado", () => {
  test("soma (integral − declarada) à diferença do combinado: (1.500 + 800) ÷ 12 × 9 ÷ 2 = 862,50", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    const l = await comb();
    expect(l.calculo!.mediaParcela1).toBe(800); // média 1.000 − declarada 200
    expect(l.calculo!.parcela1).toBe(862.5);
    expect(l.complementoDescricao).toContain("gorjeta integral");
  });

  test("mês apurado sem gorjeta da pessoa conta como zero na média", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: null }); // out: ele não aparece → 0 − 200
    const l = await comb();
    expect(l.calculo!.mediaParcela1).toBe(533.33); // (800 + 1.000 − 200) ÷ 3
    expect(l.calculo!.parcela1).toBe(762.5); // (1.500 + 533,33) ÷ 12 × 9 ÷ 2
  });

  test("gorjeta integral abaixo da declarada: nada a somar (nunca desconta do extrato) e a descrição é a antiga", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }]);
    apuracao({ 8: 100, 9: 100, 10: 100 });
    const l = await comb();
    expect(l.calculo!.mediaParcela1).toBe(0);
    expect(l.calculo!.parcela1).toBe(562.5);
    expect(l.complementoDescricao).toBe("diferença do salário combinado");
  });

  test("extrato sem a rubrica de média: não soma gorjeta e avisa (não dá para descontar a declarada)", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato(null) }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    const previa = await listarDecimoTerceiroSR(2026);
    const l = previa.linhas.find((x) => x.origem === "COMBINADO")!;
    expect(l.calculo!.parcela1).toBe(562.5);
    expect(previa.avisos.join(" ")).toContain("gorjeta integral");
  });

  test("sem extrato importado: segue a regra antiga, sem aviso extra", async () => {
    monta([]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    const previa = await listarDecimoTerceiroSR(2026);
    expect(previa.linhas.find((x) => x.origem === "COMBINADO")!.calculo!.parcela1).toBe(562.5);
    expect(previa.avisos.join(" ")).not.toContain("média de valores");
  });

  test("valor informado à mão para o mês substitui a gorjeta da apuração", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    db.decimoTerceiroVariavel.findMany.mockResolvedValue([{ employeeId: "e1", mes: 8, valor: 1900, motivo: "gorjeta integral paga por fora" }]);
    const l = await comb();
    expect(l.calculo!.mediaParcela1).toBe(1100); // (1.700 + 1.000 + 600) ÷ 3
  });
});

describe("diferença da gorjeta — salvaguardas", () => {
  test("sem rubrica e sem gorjeta integral (fora da gorjeta): não avisa para reimportar", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato(null) }]);
    apuracao({ 8: null, 9: null, 10: null });
    expect((await listarDecimoTerceiroSR(2026)).avisos.join(" ")).not.toContain("Reimporte");
  });

  test("a mesma pessoa em dois extratos: vale a maior declarada (nunca paga a mais)", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }, { texto: textoExtrato("50,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    expect((await comb()).calculo!.mediaParcela1).toBe(800); // declarada 200, não 100
  });

  test("extrato guardado ilegível não derruba a prévia", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: "Cálculo: 13o Salário\nlixo" }, { texto: textoExtrato("100,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    expect((await comb()).calculo!.parcela1).toBe(862.5);
  });

  test("avisa o limite: a 2ª parcela assume a mesma média declarada", async () => {
    monta([itemExtrato()]);
    db.rhExtract.findMany.mockResolvedValue([{ texto: textoExtrato("100,00") }]);
    apuracao({ 8: 1000, 9: 1200, 10: 800 });
    expect((await listarDecimoTerceiroSR(2026)).avisos.join(" ")).toContain("2ª parcela assume a mesma média declarada");
  });
});
