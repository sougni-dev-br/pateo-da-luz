import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fake = await vi.hoisted(async () => (await import("./fake-prisma.js")).criarFakePrisma());
vi.mock("../../../config/database.js", () => ({ prisma: fake.db }));

import {
  cancelReceivable,
  createReceivable,
  derivarSituacao,
  getReceivable,
  listReceivables,
  markReceived,
  ReceivableError,
  reverseReceipt,
  statusIndicaPago,
  summarizeReceivables,
  upsertReceivableFromIfoodSettlement,
  upsertReceivableFromNoventaNoveSettlement
} from "../receivable.service.js";
import { listQuerySchema } from "../receivable.types.js";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const baixa = (paidAmount: number, extra: object = {}) => ({
  receivedDate: "2026-10-23", paidAmount, paymentMethod: null, bankAccountId: null, notes: null, differenceReason: null, ...extra
});
const erroDe = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as ReceivableError | null;

beforeEach(() => {
  fake.contas.clear();
  fake.recebimentos.clear();
  vi.clearAllMocks();
  // 23/10/2026 12:00 em São Paulo
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T15:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("registrar recebimento", () => {
  test("recebimento total deixa a conta recebida e guarda quem registrou", async () => {
    const id = fake.semear();
    const { view } = await markReceived(id, baixa(1000, { paymentMethod: "PIX" }), "u1");

    expect(view).toMatchObject({ status: "RECEIVED", paidAmount: 1000, receivedDate: "2026-10-23", remainingAmount: 0, paymentMethod: "PIX" });
    const [lancamento] = fake.recebimentosDe(id);
    expect(lancamento).toMatchObject({ amount: 1000, createdByUserId: "u1", reversedAt: null });
  });

  test("recebimentos parciais se acumulam até quitar", async () => {
    const id = fake.semear();

    const primeiro = await markReceived(id, baixa(400, { receivedDate: "2026-10-20" }), "u1");
    expect(primeiro.view).toMatchObject({ status: "PARTIALLY_RECEIVED", paidAmount: 400, remainingAmount: 600, receivedDate: "2026-10-20" });

    const segundo = await markReceived(id, baixa(600), "u2");
    expect(segundo.view).toMatchObject({ status: "RECEIVED", paidAmount: 1000, remainingAmount: 0, receivedDate: "2026-10-23" });
    expect(fake.recebimentosDe(id)).toHaveLength(2);
  });

  test("não aceita novo recebimento em conta já recebida nem cancelada", async () => {
    const recebida = fake.semear({ status: "RECEIVED", paidAmount: 1000, receivedDate: dia("2026-10-01") });
    const cancelada = fake.semear({ status: "CANCELLED" });

    const a = await erroDe(markReceived(recebida, baixa(10), "u1"));
    const b = await erroDe(markReceived(cancelada, baixa(10), "u1"));

    expect(a).toMatchObject({ status: 409, message: expect.stringMatching(/já foi recebida/) });
    expect(b).toMatchObject({ status: 409, message: expect.stringMatching(/cancelada/) });
    expect(fake.recebimentos.size).toBe(0);
  });

  test("valor acima do saldo exige o motivo da diferença", async () => {
    const id = fake.semear();

    const sem = await erroDe(markReceived(id, baixa(1000.5), "u1"));
    expect(sem).toMatchObject({ status: 400, message: expect.stringMatching(/saldo a receber \(R\$ 1000,00\).*motivo/) });

    const com = await markReceived(id, baixa(1000.5, { differenceReason: "plataforma pagou a mais" }), "u1");
    expect(com.view.status).toBe("RECEIVED");
    expect(fake.recebimentosDe(id)[0].notes).toContain("Diferença: plataforma pagou a mais");
  });

  test("o saldo considera o que já foi recebido", async () => {
    const id = fake.semear();
    await markReceived(id, baixa(700), "u1");

    const erro = await erroDe(markReceived(id, baixa(400), "u1"));

    expect(erro?.message).toMatch(/R\$ 300,00/);
  });

  test("conta inexistente devolve 404", async () => {
    expect(await erroDe(markReceived("nao-existe", baixa(10), "u1"))).toMatchObject({ status: 404 });
  });

  test("conta com recebimento anterior ao controle soma ao que já entrou", async () => {
    const id = fake.semear({ status: "PARTIALLY_RECEIVED", paidAmount: 250, receivedDate: dia("2026-10-10") });

    const { view } = await markReceived(id, baixa(750), "u1");

    expect(view).toMatchObject({ status: "RECEIVED", paidAmount: 1000 });
    expect(fake.recebimentosDe(id).map((r) => r.amount)).toEqual([250, 750]);
  });

  test("a trava de linha é pedida dentro da transação", async () => {
    const id = fake.semear();
    await markReceived(id, baixa(10), "u1");
    expect(fake.db.$transaction).toHaveBeenCalledTimes(1);
    expect(fake.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("estornar recebimento", () => {
  test("estorno devolve a conta para em aberto e preserva o lançamento", async () => {
    const id = fake.semear();
    const { receiptId } = await markReceived(id, baixa(1000), "u1");

    const { view } = await reverseReceipt(id, receiptId!, "valor digitado errado", "u2");

    expect(view).toMatchObject({ status: "OPEN", paidAmount: null, receivedDate: null, remainingAmount: 1000 });
    expect(fake.recebimentos.get(receiptId!)).toMatchObject({ reversedByUserId: "u2", reversalReason: "valor digitado errado" });
    expect(fake.recebimentos.get(receiptId!)!.reversedAt).toBeInstanceOf(Date);
  });

  test("estornar só o segundo recebimento volta para parcial", async () => {
    const id = fake.semear();
    await markReceived(id, baixa(400, { receivedDate: "2026-10-20" }), "u1");
    const segundo = await markReceived(id, baixa(600), "u1");

    const { view } = await reverseReceipt(id, segundo.receiptId!, "estorno", "u1");

    expect(view).toMatchObject({ status: "PARTIALLY_RECEIVED", paidAmount: 400, receivedDate: "2026-10-20" });
  });

  test("estornar de novo, ou um recebimento de outra conta, é recusado", async () => {
    const a = fake.semear();
    const b = fake.semear();
    const { receiptId } = await markReceived(a, baixa(1000), "u1");
    await reverseReceipt(a, receiptId!, "motivo", "u1");

    expect(await erroDe(reverseReceipt(a, receiptId!, "de novo", "u1"))).toMatchObject({ status: 409 });
    expect(await erroDe(reverseReceipt(b, receiptId!, "outra conta", "u1"))).toMatchObject({ status: 404 });
  });

  test("recebimento anterior ao controle pode ser estornado pelo id legacy", async () => {
    const id = fake.semear({ status: "RECEIVED", paidAmount: 1000, receivedDate: dia("2026-10-05"), paymentMethod: "KEETA_REPASSE" });

    const detalhe = await getReceivable(id);
    expect(detalhe.receipts).toEqual([expect.objectContaining({ id: "legacy", legacy: true, amount: 1000, receivedDate: "2026-10-05" })]);

    const { view } = await reverseReceipt(id, "legacy", "repasse veio errado", "u1");

    expect(view).toMatchObject({ status: "OPEN", paidAmount: null });
    expect(fake.recebimentosDe(id)).toHaveLength(1);
    expect(fake.recebimentosDe(id)[0].reversedAt).toBeInstanceOf(Date);
  });

  test("conta sem recebimento não tem o que estornar", async () => {
    const id = fake.semear();
    expect(await erroDe(reverseReceipt(id, "legacy", "x", "u1"))).toMatchObject({ status: 404 });
  });
});

describe("cancelar", () => {
  test("cancela conta em aberto guardando motivo, data e quem cancelou", async () => {
    const id = fake.semear();

    const { view } = await cancelReceivable(id, "evento desmarcado", "u1");

    expect(view).toMatchObject({ status: "CANCELLED", cancellationReason: "evento desmarcado", remainingAmount: 0 });
    expect(view.cancelledAt).toEqual(expect.any(String));
    expect(fake.contas.get(id)).toMatchObject({ cancelledByUserId: "u1" });
  });

  test.each([
    ["parcial", { status: "PARTIALLY_RECEIVED", paidAmount: 100 }],
    ["recebida", { status: "RECEIVED", paidAmount: 1000 }]
  ])("conta %s não pode ser cancelada: estorne antes", async (_nome, dados) => {
    const id = fake.semear(dados);
    expect(await erroDe(cancelReceivable(id, "motivo", "u1"))).toMatchObject({ status: 409, message: expect.stringMatching(/Estorne/) });
    expect(fake.contas.get(id)!.status).toBe(dados.status);
  });

  test("cancelar duas vezes e id inexistente", async () => {
    const id = fake.semear();
    await cancelReceivable(id, "motivo", "u1");
    expect(await erroDe(cancelReceivable(id, "motivo", "u1"))).toMatchObject({ status: 409 });
    expect(await erroDe(cancelReceivable("nao-existe", "motivo", "u1"))).toMatchObject({ status: 404 });
  });
});

describe("situação derivada e atraso", () => {
  test("derivarSituacao ignora estornados e usa centavos exatos", () => {
    const r = (amount: number, d: string, reversedAt: Date | null = null) => ({ amount, receivedDate: dia(d), reversedAt });
    expect(derivarSituacao(100, [])).toEqual({ status: "OPEN", paidAmount: null, receivedDate: null });
    expect(derivarSituacao(100, [r(100, "2026-10-01", new Date())])).toMatchObject({ status: "OPEN" });
    expect(derivarSituacao(0.3, [r(0.1, "2026-10-01"), r(0.2, "2026-10-02")])).toMatchObject({ status: "RECEIVED", paidAmount: 0.3, receivedDate: dia("2026-10-02") });
    expect(derivarSituacao(100, [r(99.99, "2026-10-01")])).toMatchObject({ status: "PARTIALLY_RECEIVED" });
  });

  test("atrasada é a pendente (aberta ou parcial) com previsão antes de hoje, no dia de São Paulo", async () => {
    // 24/10 01:00 UTC ainda é 23/10 em São Paulo
    vi.setSystemTime(new Date("2026-10-24T01:00:00.000Z"));
    const hoje = fake.semear({ expectedDate: dia("2026-10-23") });
    const ontem = fake.semear({ expectedDate: dia("2026-10-22") });
    const parcialVencida = fake.semear({ expectedDate: dia("2026-10-01"), status: "PARTIALLY_RECEIVED", paidAmount: 300 });
    const recebidaVencida = fake.semear({ expectedDate: dia("2026-10-01"), status: "RECEIVED", paidAmount: 1000 });

    const por = async (id: string) => (await getReceivable(id));

    expect(await por(hoje)).toMatchObject({ isLate: false, daysUntilExpected: 0 });
    expect(await por(ontem)).toMatchObject({ isLate: true, daysUntilExpected: -1 });
    expect(await por(parcialVencida)).toMatchObject({ isLate: true, remainingAmount: 700 });
    expect(await por(recebidaVencida)).toMatchObject({ isLate: false, remainingAmount: 0 });
  });
});

describe("listagem", () => {
  const filtrar = async (query: Record<string, unknown>) => {
    fake.db.receivable.findMany.mockClear();
    await listReceivables(listQuerySchema.parse(query));
    return fake.db.receivable.findMany.mock.calls[0][0];
  };

  test("padrão: sem filtro, mais recentes primeiro, limite de 500", async () => {
    const args = await filtrar({});
    expect(args).toMatchObject({ where: {}, take: 500, skip: 0, orderBy: [{ expectedDate: "desc" }, { createdAt: "desc" }] });
  });

  test("PENDING traz aberta e parcial, por vencimento", async () => {
    const args = await filtrar({ status: "PENDING" });
    expect(args.where).toEqual({ AND: [{ status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } }] });
    expect(args.orderBy[0]).toEqual({ expectedDate: "asc" });
  });

  test("LATE é derivado: pendente com previsão antes de hoje (São Paulo)", async () => {
    const args = await filtrar({ status: "LATE" });
    expect(args.where.AND[0]).toEqual({ status: { in: ["OPEN", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: dia("2026-10-23") } });
  });

  test("período inclui o dia final e pode filtrar pela data do recebimento", async () => {
    const prevista = await filtrar({ startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(prevista.where.AND[0]).toEqual({ expectedDate: { gte: dia("2026-10-01"), lt: dia("2026-11-01") } });

    const recebida = await filtrar({ startDate: "2026-10-01", dateField: "received" });
    expect(recebida.where.AND[0]).toEqual({ receivedDate: { gte: dia("2026-10-01") } });
  });

  test("busca procura em descrição, cliente e referência sem diferenciar maiúsculas", async () => {
    const args = await filtrar({ search: "keeta", sourceType: "KEETA_SETTLEMENT" });
    expect(args.where.AND).toEqual([
      { sourceType: "KEETA_SETTLEMENT" },
      { OR: [{ description: { contains: "keeta", mode: "insensitive" } }, { customerName: { contains: "keeta", mode: "insensitive" } }, { sourceRef: { contains: "keeta", mode: "insensitive" } }] }
    ]);
  });

  test("parâmetros inválidos são recusados antes de chegar ao banco", () => {
    expect(listQuerySchema.safeParse({ startDate: "lixo" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ status: "XYZ" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ startDate: "2026-02-31" }).success).toBe(false);
  });
});

describe("resumo", () => {
  test("separa vencido, hoje e janelas de 7/30 dias pelo saldo, e soma o recebido no mês", async () => {
    fake.semear({ expectedDate: dia("2026-10-20"), netAmount: 100 }); // vencida
    fake.semear({ expectedDate: dia("2026-10-23"), netAmount: 200 }); // hoje
    fake.semear({ expectedDate: dia("2026-10-28"), netAmount: 300 }); // 5 dias
    fake.semear({ expectedDate: dia("2026-11-10"), netAmount: 400, status: "PARTIALLY_RECEIVED", paidAmount: 150 }); // 18 dias, saldo 250
    fake.semear({ expectedDate: dia("2026-12-30"), netAmount: 999 }); // além de 30 dias
    fake.semear({ expectedDate: dia("2026-10-01"), netAmount: 5000, status: "CANCELLED" });
    const recebida = fake.semear({ netAmount: 800 });
    await markReceived(recebida, baixa(800, { receivedDate: "2026-10-10" }), "u1");
    fake.semear({ status: "RECEIVED", paidAmount: 50, receivedDate: dia("2026-10-02"), netAmount: 50 }); // legada no mês
    fake.semear({ status: "RECEIVED", paidAmount: 70, receivedDate: dia("2026-09-30"), netAmount: 70 }); // mês anterior

    const r = await summarizeReceivables();

    expect(r.today).toBe("2026-10-23");
    expect(r.overdue).toEqual({ count: 1, amount: 100 });
    expect(r.dueToday).toEqual({ count: 1, amount: 200 });
    expect(r.next7).toEqual({ count: 2, amount: 500 });
    expect(r.next30).toEqual({ count: 3, amount: 750 });
    expect(r.pending).toEqual({ count: 5, amount: 1849 });
    expect(r.receivedThisMonth).toEqual({ count: 2, amount: 850 });
  });
});

describe("criar", () => {
  test("a competência vem do dia informado, sem deslocar pelo fuso", async () => {
    const v = await createReceivable({
      sourceType: "EVENT", companyId: null, sourceRef: null, customerName: "Cliente Exemplo", customerDocument: null,
      description: "Evento exemplo", expectedDate: "2026-10-01", grossAmount: 1000, fees: 0, netAmount: 1000,
      paymentMethod: null, bankAccountId: null, parentReceivableId: null, notes: null
    });
    expect(v).toMatchObject({ competenceYear: 2026, competenceMonth: 10, expectedDate: "2026-10-01", status: "OPEN" });
  });
});

describe("sincronização de repasses não desfaz o que foi feito à mão", () => {
  const repasse = (extra: object = {}) => ({
    id: "s1", externalId: "ext1", deliveryStoreId: "loja", periodStart: dia("2026-10-01"), periodEnd: dia("2026-10-07"),
    netAmount: 900, grossAmount: 1000, totalFees: 100, paidAt: dia("2026-10-14"), status: "PAID", ...extra
  });
  const loja = { companyId: null, nickname: "Loja Exemplo" };
  const doRepasse = () => [...fake.contas.values()].find((c) => c.ifoodSettlementId === "s1")!;

  test("repasse pago nasce recebido, com o lançamento da plataforma", async () => {
    await upsertReceivableFromIfoodSettlement(repasse(), loja);
    const conta = doRepasse();
    expect(conta).toMatchObject({ status: "RECEIVED", paidAmount: 900, sourceType: "IFOOD_SETTLEMENT", customerName: "iFood" });
    expect(fake.recebimentosDe(conta.id)).toEqual([expect.objectContaining({ amount: 900, createdByUserId: null })]);
  });

  test("repasse não pago nasce em aberto, e vira recebido quando a plataforma paga", async () => {
    await upsertReceivableFromIfoodSettlement(repasse({ status: "PENDING", paidAt: null, periodEnd: dia("2026-10-30") }), loja);
    expect(doRepasse()).toMatchObject({ status: "OPEN", paidAmount: null });

    await upsertReceivableFromIfoodSettlement(repasse({ paidAt: dia("2026-10-14") }), loja);
    expect(doRepasse()).toMatchObject({ status: "RECEIVED", paidAmount: 900 });
    expect(fake.recebimentosDe(doRepasse().id)).toHaveLength(1);
  });

  test.each(["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"])("conta %s não é reescrita pela sincronização", async (status) => {
    await upsertReceivableFromIfoodSettlement(repasse({ status: "PENDING", paidAt: null, periodEnd: dia("2026-10-30") }), loja);
    const conta = doRepasse();
    Object.assign(conta, { status, paidAmount: 300, description: "ajustada à mão" });

    await upsertReceivableFromIfoodSettlement(repasse({ netAmount: 777 }), loja);

    expect(doRepasse()).toMatchObject({ status, paidAmount: 300, description: "ajustada à mão", netAmount: 900 });
  });

  test("recebimento estornado à mão não é refeito pela sincronização", async () => {
    await upsertReceivableFromIfoodSettlement(repasse(), loja);
    const conta = doRepasse();
    const [auto] = fake.recebimentosDe(conta.id);
    await reverseReceipt(conta.id, auto.id, "o dinheiro não caiu", "u1");

    await upsertReceivableFromIfoodSettlement(repasse({ netAmount: 950 }), loja);

    expect(doRepasse()).toMatchObject({ status: "OPEN", paidAmount: null, netAmount: 950 });
    expect(fake.recebimentosDe(conta.id)).toHaveLength(1);
  });

  test("baixa feita entre a leitura e a gravação da sincronização é preservada", async () => {
    await upsertReceivableFromIfoodSettlement(repasse({ status: "PENDING", paidAt: null, periodEnd: dia("2026-10-30") }), loja);
    const conta = doRepasse();
    fake.db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      Object.assign(conta, { status: "PARTIALLY_RECEIVED", paidAmount: 300 });
      return fn(fake.db);
    });

    await upsertReceivableFromIfoodSettlement(repasse(), loja);

    expect(doRepasse()).toMatchObject({ status: "PARTIALLY_RECEIVED", paidAmount: 300 });
    expect(fake.recebimentosDe(conta.id)).toHaveLength(0);
  });

  test("o dia do recebimento é o de São Paulo, não o do UTC", async () => {
    // 15/10 01:30 UTC = 14/10 22:30 em São Paulo
    await upsertReceivableFromIfoodSettlement(repasse({ paidAt: new Date("2026-10-15T01:30:00.000Z") }), loja);
    const conta = doRepasse();
    expect(conta.receivedDate).toEqual(dia("2026-10-14"));
    expect(fake.recebimentosDe(conta.id)[0].receivedDate).toEqual(dia("2026-10-14"));
  });

  test("99 Food usa a própria chave e o mesmo cuidado", async () => {
    await upsertReceivableFromNoventaNoveSettlement(repasse({ id: "n1" }), loja);
    const conta = [...fake.contas.values()].find((c) => c.noventaNoveSettlementId === "n1")!;
    expect(conta).toMatchObject({ sourceType: "NOVENTA_NOVE_SETTLEMENT", customerName: "99 Food", status: "RECEIVED" });
  });

  test.each([
    ["PAID", true], ["paid", true], ["SETTLED", true], ["SETTLEMENT_PAID", true],
    ["UNPAID", false], ["NOT_PAID", false], ["PARTIALLY_PAID", false], ["PENDING", false], ["UNKNOWN", false], ["", false]
  ])("status %j do repasse %s pago", (status, esperado) => {
    expect(statusIndicaPago(status)).toBe(esperado);
  });

  test("repasse com status UNPAID não nasce como recebido", async () => {
    await upsertReceivableFromIfoodSettlement(repasse({ status: "UNPAID" }), loja);
    expect(doRepasse()).toMatchObject({ status: "OPEN", paidAmount: null });
  });
});
