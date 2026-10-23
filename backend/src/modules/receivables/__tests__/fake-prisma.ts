import { vi } from "vitest";

// Banco em memória só com o que o serviço de contas a receber usa. Não interpreta `where`
// de listagem (os testes conferem o `where` enviado); resolve por id/chave de repasse.

type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0;
const novoId = (prefixo: string) => `${prefixo}${++seq}`;

export function criarFakePrisma() {
  const contas = new Map<string, Linha>();
  const recebimentos = new Map<string, Linha>();

  const recebimentosDe = (id: string) =>
    [...recebimentos.values()]
      .filter((r) => r.receivableId === id)
      .sort((a, b) => a.receivedDate - b.receivedDate || a.createdAt - b.createdAt);

  const comRelacoes = (conta: Linha | undefined, include?: Linha) => {
    if (!conta) return null;
    const copia: Linha = { ...conta };
    if (include?.company) copia.company = null;
    if (include?.receipts) copia.receipts = recebimentosDe(conta.id).map((r) => ({ ...r }));
    return copia;
  };

  const criarRecebimento = (data: Linha): Linha => {
    const r = { id: novoId("rc"), createdAt: new Date(Date.now() + seq), reversedAt: null, reversedByUserId: null, reversalReason: null, paymentMethod: null, bankAccountId: null, notes: null, createdByUserId: null, ...data };
    recebimentos.set(r.id, r);
    return r;
  };

  const criarConta = (data: Linha): Linha => {
    const { receipts, ...resto } = data;
    const conta = {
      id: novoId("ct"), companyId: null, sourceRef: null, ifoodSettlementId: null, noventaNoveSettlementId: null, customerName: null,
      customerDocument: null, paidAmount: null, receivedDate: null, paymentMethod: null, bankAccountId: null, installmentNumber: null,
      totalInstallments: null, parentReceivableId: null, notes: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null,
      status: "OPEN", fees: 0, grossAmount: 0, createdAt: new Date(), ...resto
    };
    contas.set(conta.id, conta);
    receipts?.create && criarRecebimento({ receivableId: conta.id, ...receipts.create });
    return conta;
  };

  const achar = (where: Linha) =>
    [...contas.values()].find((c) => Object.entries(where).every(([k, v]) => c[k] === v));

  const db: Linha = {
    receivable: {
      findUnique: vi.fn(async ({ where, include }: Linha) => comRelacoes(achar(where), include)),
      create: vi.fn(async ({ data, include }: Linha) => comRelacoes(criarConta(data), include)),
      update: vi.fn(async ({ where, data, include }: Linha) => {
        const atual = contas.get(where.id)!;
        Object.assign(atual, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
        return comRelacoes(atual, include);
      }),
      findMany: vi.fn(async ({ where, select }: Linha) => {
        const todas = [...contas.values()];
        if (select) return todas.filter((c) => where?.status?.in?.includes(c.status));
        return todas.map((c) => comRelacoes(c, { company: true }));
      }),
      count: vi.fn(async () => contas.size),
      aggregate: vi.fn(async ({ where }: Linha) => {
        const { gte, lt } = where.receivedDate;
        const doMes = [...contas.values()].filter(
          (c) => where.status.in.includes(c.status) && c.receivedDate && c.receivedDate >= gte && c.receivedDate < lt && recebimentosDe(c.id).length === 0
        );
        return { _sum: { paidAmount: doMes.reduce((s, c) => s + Number(c.paidAmount), 0) }, _count: doMes.length };
      })
    },
    receivableReceipt: {
      create: vi.fn(async ({ data }: Linha) => criarRecebimento(data)),
      findUnique: vi.fn(async ({ where }: Linha) => recebimentos.get(where.id) ?? null),
      findFirst: vi.fn(async ({ where }: Linha) => recebimentosDe(where.receivableId).at(-1) ?? null),
      update: vi.fn(async ({ where, data }: Linha) => Object.assign(recebimentos.get(where.id)!, data)),
      aggregate: vi.fn(async ({ where }: Linha) => {
        const { gte, lt } = where.receivedDate;
        const doMes = [...recebimentos.values()].filter((r) => !r.reversedAt && r.receivedDate >= gte && r.receivedDate < lt);
        return { _sum: { amount: doMes.reduce((s, r) => s + Number(r.amount), 0) }, _count: doMes.length };
      })
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: Linha) => unknown) => fn(db))
  };

  return {
    db,
    contas,
    recebimentos,
    recebimentosDe,
    /** Cadastra uma conta já pronta e devolve o id. */
    semear: (dados: Linha = {}) =>
      criarConta({
        sourceType: "DIRECT",
        description: "Evento de teste",
        competenceYear: 2026,
        competenceMonth: 10,
        expectedDate: new Date("2026-10-30T00:00:00.000Z"),
        netAmount: 1000,
        grossAmount: 1000,
        ...dados
      }).id as string
  };
}
