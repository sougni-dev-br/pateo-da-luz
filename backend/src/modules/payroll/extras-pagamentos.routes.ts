import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, type SessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import {
  JUSTIFICATIVA_MINIMA, LIMITE_LONGO, auditoria, hojeEmSaoPaulo, lerData, periodoBloqueado, podeVerDadosDeFora, str, violouUnico, ymd,
} from "./extras-comum.js";
import { apelidoDe, nomeCompleto } from "./nomes.js";

// Pagamentos de extras: agrupam diárias REALIZADAS de uma pessoa num título do
// Contas a Pagar. A baixa e o estorno seguem o mesmo fluxo da folha.
export const extrasPagamentosRouter = Router();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_DIARIAS_POR_LOTE = 200;

const pessoaSelect = {
  employee: { select: { firstName: true, lastName: true, displayName: true, cpf: true, pixKey: true, pixKeyType: true, modality: true } },
  extraWorker: { select: { fullName: true, displayName: true, cpf: true, pixKey: true, pixKeyType: true } },
} as const;

type ComPessoa = {
  employeeId: string | null;
  extraWorkerId: string | null;
  employee: { firstName: string; lastName: string; displayName: string | null } | null;
  extraWorker: { fullName: string; displayName: string | null } | null;
};

function pessoaDe(x: ComPessoa) {
  if (x.employee) return { origem: "CASA" as const, pessoaId: x.employeeId!, nome: nomeCompleto(x.employee), apelido: apelidoDe(x.employee) };
  return { origem: "FORA" as const, pessoaId: x.extraWorkerId!, nome: x.extraWorker!.fullName, apelido: x.extraWorker!.displayName };
}

function situacao(p: { status: string; paymentDate: Date | null; dueDate: Date }) {
  if (p.status === "CANCELED") return "CANCELED";
  if (p.paymentDate) return "PAID";
  return ymd(p.dueDate) < hojeEmSaoPaulo() ? "OVERDUE" : "OPEN";
}

// Próximo código EXT-AAAA-NNNN. Dentro da transação a busca já enxerga os
// criados no mesmo lote; entre lotes simultâneos, o índice único barra e a
// criação tenta de novo.
// O maior é calculado pelo NÚMERO: por texto, "EXT-2026-10000" viria antes de
// "EXT-2026-9999" e o contador voltaria para trás.
async function proximoCodigo(tx: Pick<typeof prisma, "$queryRaw">, ano: number) {
  const prefixo = `EXT-${ano}-`;
  const [linha] = await tx.$queryRaw<Array<{ maior: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("code" FROM (${prefixo.length + 1})::int) AS INTEGER)) AS maior
    FROM "ExtraPayment" WHERE "code" LIKE ${`${prefixo}%`}
  `;
  return `${prefixo}${String((linha?.maior ?? 0) + 1).padStart(4, "0")}`;
}

// ─── LISTA: realizadas sem pagamento + pagamentos ────────────────────────────
extrasPagamentosRouter.get("/", async (request, response) => {
  const now = new Date();
  const anoPedido = Number.parseInt(String(request.query.year ?? ""), 10);
  const year = anoPedido >= 2000 && anoPedido <= 2100 ? anoPedido : now.getFullYear();
  const month = Math.min(Math.max(Number.parseInt(String(request.query.month ?? ""), 10) || now.getMonth() + 1, 1), 12);
  const inicio = new Date(Date.UTC(year, month - 1, 1));
  const fim = new Date(Date.UTC(year, month, 1));

  // Pendentes de qualquer mês: diária antiga sem pagamento é justamente o que
  // não pode sumir da tela só porque o mês virou.
  const [pendentes, pagamentos] = await Promise.all([
    prisma.extraShift.findMany({
      // Diária de R$ 0 não gera título (o pagamento exige valor): não fica aqui para sempre.
      where: { deletedAt: null, status: "REALIZADA", paymentId: null, totalAmount: { gt: 0 } },
      include: pessoaSelect,
      orderBy: [{ date: "asc" }],
      take: 1000,
    }),
    prisma.extraPayment.findMany({
      where: { OR: [{ dueDate: { gte: inicio, lt: fim } }, { status: "PENDING" }] },
      include: { ...pessoaSelect, shifts: { where: { deletedAt: null }, select: { id: true, date: true, duration: true, totalAmount: true } } },
      orderBy: [{ dueDate: "desc" }, { code: "desc" }],
    }),
  ]);

  response.json({
    pendentes: pendentes.map((d) => ({
      id: d.id,
      date: ymd(d.date),
      duration: d.duration,
      sector: d.sector,
      totalAmount: Number(d.totalAmount),
      ...pessoaDe(d),
    })),
    pagamentos: pagamentos.map((p) => ({
      id: p.id,
      code: p.code,
      ...pessoaDe(p),
      amount: Number(p.amount),
      dueDate: ymd(p.dueDate),
      paymentDate: p.paymentDate ? p.paymentDate.toISOString() : null,
      paidAmount: p.paidAmount == null ? null : Number(p.paidAmount),
      paidPaymentMethodName: p.paidPaymentMethodName,
      situacao: situacao(p),
      cancelReason: p.cancelReason,
      diarias: p.shifts.map((s) => ({ id: s.id, date: ymd(s.date), duration: s.duration, totalAmount: Number(s.totalAmount) })),
    })),
  });
});

// ─── GERAR PAGAMENTO (aprovar) ─────────────────────────────────────────────────
// Recebe diárias de uma ou mais pessoas e cria UM título por pessoa.
extrasPagamentosRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const ids = Array.isArray(b.shiftIds) ? [...new Set(b.shiftIds.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length === 0) return response.status(400).json({ message: "Escolha ao menos uma diária." });
  if (ids.length > MAX_DIARIAS_POR_LOTE) return response.status(400).json({ message: `No máximo ${MAX_DIARIAS_POR_LOTE} diárias por vez.` });
  const dueDate = lerData(b.dueDate);
  if (!dueDate) return response.status(400).json({ message: "Informe o vencimento." });
  const notes = str(b.notes);
  if (notes && notes.length > LIMITE_LONGO) return response.status(400).json({ message: `Observação: máximo de ${LIMITE_LONGO} caracteres.` });

  const diarias = await prisma.extraShift.findMany({ where: { id: { in: ids }, deletedAt: null } });
  if (diarias.length !== ids.length) return response.status(400).json({ message: "Alguma diária não foi encontrada. Recarregue a tela." });
  const invalida = diarias.find((d) => d.status !== "REALIZADA" || d.paymentId);
  if (invalida) {
    return response.status(400).json({
      message: invalida.paymentId ? "Alguma diária já está em outro pagamento. Recarregue a tela." : "Só diárias realizadas entram em pagamento.",
    });
  }

  const porPessoa = new Map<string, typeof diarias>();
  for (const d of diarias) {
    const chave = d.employeeId ? `c:${d.employeeId}` : `f:${d.extraWorkerId}`;
    porPessoa.set(chave, [...(porPessoa.get(chave) ?? []), d]);
  }

  const ano = Number(hojeEmSaoPaulo().slice(0, 4));
  let criados: Array<{ id: string; code: string; amount: number; shiftIds: string[] }> = [];
  // Até 3 tentativas: dois lotes ao mesmo tempo podem disputar o mesmo código.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      criados = await prisma.$transaction(async (tx) => {
        const feitos: Array<{ id: string; code: string; amount: number; shiftIds: string[] }> = [];
        for (const grupo of porPessoa.values()) {
          const previa = round2(grupo.reduce((s, d) => s + Number(d.totalAmount), 0));
          if (previa <= 0) throw new Error("VALOR_ZERO");
          const code = await proximoCodigo(tx, ano);
          const pg = await tx.extraPayment.create({
            data: {
              code, amount: previa, dueDate, notes, createdById: user.id,
              employeeId: grupo[0].employeeId, extraWorkerId: grupo[0].extraWorkerId,
            },
          });
          // updateMany com paymentId: null — se outra pessoa acabou de pôr a
          // mesma diária num pagamento, a contagem não bate e a transação desfaz.
          const r = await tx.extraShift.updateMany({ where: { id: { in: grupo.map((d) => d.id) }, paymentId: null, deletedAt: null, status: "REALIZADA" }, data: { paymentId: pg.id } });
          if (r.count !== grupo.length) throw new Error("CONCORRENCIA");
          // O valor do título é a soma lida DEPOIS de travar as diárias, dentro da
          // transação: uma edição de valor entre a leitura inicial e agora não
          // deixa o título diferente do que o DRE conta.
          const soma = await tx.extraShift.aggregate({ where: { paymentId: pg.id, deletedAt: null }, _sum: { totalAmount: true } });
          const amount = round2(Number(soma._sum.totalAmount ?? 0));
          if (amount <= 0) throw new Error("VALOR_ZERO");
          if (amount !== previa) await tx.extraPayment.update({ where: { id: pg.id }, data: { amount } });
          feitos.push({ id: pg.id, code, amount, shiftIds: grupo.map((d) => d.id) });
        }
        return feitos;
      });
      break;
    } catch (error) {
      if (error instanceof Error && error.message === "VALOR_ZERO") return response.status(400).json({ message: "O total das diárias escolhidas é zero." });
      if (error instanceof Error && error.message === "CONCORRENCIA") return response.status(409).json({ message: "Alguma diária entrou em outro pagamento agora. Recarregue a tela." });
      if (violouUnico(error) && tentativa < 2) continue;
      throw error;
    }
  }

  for (const c of criados) {
    await auditLog({
      userId: user.id, action: "CREATE_EXTRA_PAYMENT", entity: "ExtraPayment", entityId: c.id,
      newValue: { code: c.code, amount: c.amount, dueDate: ymd(dueDate), shiftIds: c.shiftIds }, ...auditoria(request),
    });
  }
  response.status(201).json({ pagamentos: criados.map(({ id, code, amount }) => ({ id, code, amount })) });
});

// ─── BAIXA (paridade com a folha e com contas a pagar) ────────────────────────
extrasPagamentosRouter.patch("/:id/pay", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.extraPayment.findUnique({ where: { id: request.params.id } });
  if (!existing || existing.status === "CANCELED") return response.status(404).json({ message: "Pagamento não encontrado." });
  if (existing.paymentDate || existing.status === "PAID") {
    return response.status(400).json({ message: "Pagamento já baixado. Estorne antes de lançar uma nova baixa." });
  }

  const b = request.body as Record<string, unknown>;
  // Só AAAA-MM-DD, e o padrão é hoje em São Paulo: new Date() no servidor (UTC)
  // já é "amanhã" depois das 21h e seria recusado como data futura.
  const paymentDate = lerData(b.paymentDate ? String(b.paymentDate).slice(0, 10) : hojeEmSaoPaulo());
  if (!paymentDate) return response.status(400).json({ message: "Data do pagamento inválida." });
  const paidAmount = b.paidAmount == null || b.paidAmount === "" ? Number(existing.amount) : Number(b.paidAmount);
  const paidPaymentMethodId = str(b.paidPaymentMethodId);
  const paidPaymentMethodNameInput = str(b.paidPaymentMethodName);
  const differenceReason = str(b.differenceReason);
  const paymentNotes = str(b.paymentNotes ?? b.notes);
  const payingCompanyId = str(b.payingCompanyId);
  const companyBankAccountId = str(b.companyBankAccountId);

  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    return response.status(400).json({ message: "Valor pago (> 0) é obrigatório." });
  }
  if (ymd(paymentDate) > hojeEmSaoPaulo()) return response.status(400).json({ message: "Data do pagamento não pode ser futura." });
  if (await periodoBloqueado(paymentDate, "Baixa de pagamento de extra", response)) return;
  if (!paidPaymentMethodId && !paidPaymentMethodNameInput) return response.status(400).json({ message: "Forma de pagamento é obrigatória." });
  if (paidAmount > Number(existing.amount) * 10 && paidAmount - Number(existing.amount) > 10_000) {
    return response.status(400).json({ message: "Valor pago é mais de 10x o título. Confira antes de baixar." });
  }
  const difference = round2(paidAmount - Number(existing.amount));
  if (Math.abs(difference) > 0.009 && !differenceReason) {
    return response.status(400).json({ message: "Justificativa obrigatória quando o valor pago difere do valor do título." });
  }
  // Conta só com a empresa dona dela; as colunas não têm FK, então o vínculo é
  // conferido aqui.
  if (companyBankAccountId && !payingCompanyId) return response.status(400).json({ message: "Informe a empresa pagadora da conta bancária." });
  if (payingCompanyId && !(await prisma.company.findFirst({ where: { id: payingCompanyId }, select: { id: true } }))) {
    return response.status(400).json({ message: "Empresa pagadora não encontrada." });
  }
  if (payingCompanyId && companyBankAccountId) {
    const owned = await prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId: payingCompanyId, isActive: true } });
    if (!owned) return response.status(400).json({ message: "Conta bancária não pertence à empresa selecionada ou está inativa." });
  }
  const method = paidPaymentMethodId ? await prisma.paymentMethod.findUnique({ where: { id: paidPaymentMethodId } }) : null;
  if (paidPaymentMethodId && !method) return response.status(400).json({ message: "Forma de pagamento não encontrada." });
  const paidPaymentMethodName = method?.name ?? paidPaymentMethodNameInput;

  // Só baixa título ainda em aberto: duas abas (ou um cancelamento ao mesmo
  // tempo) não podem gravar duas baixas nem pagar um título cancelado.
  const r = await prisma.extraPayment.updateMany({
    where: { id: existing.id, status: "PENDING", paymentDate: null },
    data: {
      paymentDate, paidAmount: round2(paidAmount), status: "PAID",
      paidPaymentMethodId, paidPaymentMethodName,
      paidByCompanyId: payingCompanyId, companyBankAccountId, differenceReason, paymentNotes, updatedById: user.id,
    },
  });
  if (r.count === 0) return response.status(409).json({ message: "Este pagamento mudou agora (baixado ou cancelado). Recarregue a tela." });
  await auditLog({
    userId: user.id, action: "PAY_EXTRA_PAYMENT", entity: "ExtraPayment", entityId: existing.id,
    previousValue: { status: existing.status }, newValue: { status: "PAID", paymentDate: ymd(paymentDate), paidAmount: round2(paidAmount), paidPaymentMethodName },
    ...auditoria(request),
  });
  response.json({ id: existing.id, status: "PAID" });
});

// ─── ESTORNO ─────────────────────────────────────────────────────────────────
extrasPagamentosRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const reason = str((request.body as { reason?: unknown })?.reason);
  if (!reason) return response.status(400).json({ message: "Motivo obrigatório para estornar o pagamento." });
  if (reason.length > LIMITE_LONGO) return response.status(400).json({ message: `Motivo: máximo de ${LIMITE_LONGO} caracteres.` });

  const existing = await prisma.extraPayment.findUnique({ where: { id: request.params.id } });
  if (!existing || existing.status === "CANCELED") return response.status(404).json({ message: "Pagamento não encontrado." });
  if (!existing.paymentDate) return response.status(400).json({ message: "Este pagamento ainda não foi baixado." });
  if (await periodoBloqueado(new Date(`${ymd(existing.paymentDate)}T00:00:00Z`), "Estorno de pagamento de extra", response)) return;

  const r = await prisma.extraPayment.updateMany({
    where: { id: existing.id, status: "PAID", paymentDate: existing.paymentDate },
    data: {
      paymentDate: null, paidAmount: null, status: "PENDING", paidPaymentMethodId: null, paidPaymentMethodName: null,
      paidByCompanyId: null, companyBankAccountId: null, differenceReason: null, paymentNotes: reason, updatedById: user.id,
    },
  });
  if (r.count === 0) return response.status(409).json({ message: "Este pagamento mudou agora. Recarregue a tela." });
  await auditLog({
    userId: user.id, action: "REVERSE_EXTRA_PAYMENT", entity: "ExtraPayment", entityId: existing.id,
    previousValue: { status: existing.status, paymentDate: existing.paymentDate, paidAmount: existing.paidAmount }, newValue: { status: "PENDING", reverseReason: reason },
    ...auditoria(request),
  });
  response.json({ id: existing.id, status: "PENDING" });
});

// ─── CANCELAR (solta as diárias) ─────────────────────────────────────────────
extrasPagamentosRouter.post("/:id/cancel", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const reason = str((request.body as { reason?: unknown })?.reason);
  if (!reason || reason.length < JUSTIFICATIVA_MINIMA) return response.status(400).json({ message: "Informe o motivo do cancelamento (mín. 3 caracteres)." });
  if (reason.length > LIMITE_LONGO) return response.status(400).json({ message: `Motivo: máximo de ${LIMITE_LONGO} caracteres.` });

  const existing = await prisma.extraPayment.findUnique({ where: { id: request.params.id } });
  if (!existing || existing.status === "CANCELED") return response.status(404).json({ message: "Pagamento não encontrado." });
  if (existing.paymentDate) return response.status(400).json({ message: "Pagamento já baixado: estorne em Contas a Pagar antes de cancelar." });

  // Cancela primeiro, com a condição de ainda estar em aberto; só então solta
  // as diárias. Uma baixa simultânea faz o cancelamento não pegar nada e as
  // diárias continuam presas ao título pago (senão seriam pagas de novo).
  const soltas = await prisma.$transaction(async (tx) => {
    const c = await tx.extraPayment.updateMany({
      where: { id: existing.id, status: "PENDING", paymentDate: null },
      data: { status: "CANCELED", cancelReason: reason, canceledAt: new Date(), canceledById: user.id, updatedById: user.id },
    });
    if (c.count === 0) return null;
    const r = await tx.extraShift.updateMany({ where: { paymentId: existing.id }, data: { paymentId: null } });
    return r.count;
  });
  if (soltas === null) return response.status(409).json({ message: "Este pagamento mudou agora (foi baixado?). Recarregue a tela." });
  await auditLog({
    userId: user.id, action: "CANCEL_EXTRA_PAYMENT", entity: "ExtraPayment", entityId: existing.id,
    previousValue: { status: existing.status, code: existing.code }, newValue: { status: "CANCELED", reason, diariasSoltas: soltas },
    ...auditoria(request),
  });
  response.json({ ok: true, diariasSoltas: soltas });
});

// ─── RECIBO ───────────────────────────────────────────────────────────────────
// CPF e PIX só para quem pode ver dados pessoais (da casa: Funcionários; de fora:
// Funcionários ou Administrar Extras).
extrasPagamentosRouter.get("/:id/receipt", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const p = await prisma.extraPayment.findUnique({
    where: { id: request.params.id },
    include: { ...pessoaSelect, shifts: { where: { deletedAt: null }, orderBy: { date: "asc" } } },
  });
  if (!p || p.status === "CANCELED") return response.status(404).json({ message: "Pagamento não encontrado." });

  const verDados = p.employee ? await podeVerDadosPessoais(request) : await podeVerDadosDeFora(request, user as SessionUser);
  const doc = p.employee ?? p.extraWorker!;
  response.json({
    code: p.code,
    ...pessoaDe(p),
    cpf: verDados ? doc.cpf : null,
    pixKey: verDados ? doc.pixKey : null,
    pixKeyType: verDados ? doc.pixKeyType : null,
    amount: Number(p.amount),
    dueDate: ymd(p.dueDate),
    paymentDate: p.paymentDate ? ymd(p.paymentDate) : null,
    paidAmount: p.paidAmount == null ? null : Number(p.paidAmount),
    paidPaymentMethodName: p.paidPaymentMethodName,
    diarias: p.shifts.map((s) => ({
      date: ymd(s.date), duration: s.duration, sector: s.sector, role: s.role, eventName: s.eventName, startTime: s.startTime, endTime: s.endTime,
      baseAmount: Number(s.baseAmount), transportAmount: Number(s.transportAmount), bonusAmount: Number(s.bonusAmount),
      discountAmount: Number(s.discountAmount), totalAmount: Number(s.totalAmount),
    })),
  });
});
