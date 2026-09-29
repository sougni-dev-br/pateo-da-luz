// Vales da gorjeta: adiantamentos, refeição, retirada de caixa… lançados no
// restaurante e abatidos da gorjeta antes do envio à contabilidade (que recebe a
// gorjeta líquida). Tudo fica no banco: lançar, corrigir e cancelar deixam
// autor, data e motivo; cancelar não apaga — o vale só deixa de descontar.
// Montado dentro de tipCommissionRouter (/payroll/tip).
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { saldoReserva, travarFundo } from "./tip-historico.service.js";

export const tipValesRouter = Router();

const TIPOS = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"] as const;
type Tipo = (typeof TIPOS)[number];
const VALOR_MAXIMO = 100_000;

const nomeDe = (e: { displayName: string | null; firstName: string; lastName: string }) =>
  (e.displayName || `${e.firstName} ${e.lastName}`).trim();

function dataOuNull(v: unknown): Date | null | "invalida" {
  if (v == null || v === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).slice(0, 10));
  if (!m) return "invalida";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? "invalida" : d;
}

// Lê e valida o corpo de um vale (lançar ou corrigir).
export function lerVale(b: Record<string, unknown>) {
  const type = TIPOS.includes(String(b.type) as Tipo) ? (String(b.type) as Tipo) : null;
  const amount = Number(b.amount);
  const date = dataOuNull(b.date);
  const notes = b.notes == null ? null : String(b.notes).trim().slice(0, 300) || null;
  if (!type) return { erro: "Escolha o tipo do vale." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > VALOR_MAXIMO) return { erro: "Valor do vale inválido." };
  if (date === "invalida") return { erro: "Data do vale inválida." };
  return { dados: { type, amount: Math.round(amount * 100) / 100, date, notes } };
}

// VALE-AAAA-NNNNN, sequência por ano (vai impresso no recibo).
async function proximoCodigoVale(ano: number): Promise<string> {
  const padrao = `^VALE-${ano}-(\\d+)$`;
  const [row] = await prisma.$queryRaw<Array<{ proximo: number }>>`
    SELECT COALESCE(MAX(SUBSTRING("codigo" FROM ${padrao})::int), 0) + 1 AS "proximo"
    FROM "TipVale" WHERE "codigo" LIKE ${`VALE-${ano}-%`}
  `;
  return `VALE-${ano}-${String(Number(row?.proximo ?? 1)).padStart(5, "0")}`;
}

// Período fechado não aceita vale: mudaria a gorjeta líquida já conferida.
async function barradoPorFechamento(periodId: string, response: Response, acao: string) {
  const p = await prisma.tipPeriod.findUnique({ where: { id: periodId }, select: { status: true, competenceMonth: true, competenceYear: true } });
  if (p?.status !== "CLOSED") return false;
  response.status(409).json({
    message: `A gorjeta de ${String(p.competenceMonth).padStart(2, "0")}/${p.competenceYear} está fechada. ${acao} mudaria a gorjeta líquida já conferida — reabra o período antes.`,
  });
  return true;
}

function valeParaTela(v: {
  id: string; participantId: string; type: string; amount: unknown; date: Date | null; notes: string | null;
  createdAt: Date; createdByName: string | null; updatedAt: Date | null; canceledAt: Date | null; canceledByName: string | null;
  cancelReason: string | null; reserveMovement?: { id: string } | null;
  codigo: string | null; reciboImpressoEm: Date | null; reciboImpressoes: number;
}) {
  return {
    id: v.id, participantId: v.participantId, type: v.type, amount: Number(v.amount),
    date: v.date ? v.date.toISOString().slice(0, 10) : null, notes: v.notes,
    lancadoEm: v.createdAt.toISOString(), lancadoPor: v.createdByName, alteradoEm: v.updatedAt?.toISOString() ?? null,
    canceladoEm: v.canceledAt?.toISOString() ?? null, canceladoPor: v.canceledByName, motivoCancelamento: v.cancelReason,
    doFundo: Boolean(v.reserveMovement),
    codigo: v.codigo, reciboImpressoEm: v.reciboImpressoEm?.toISOString() ?? null, reciboImpressoes: v.reciboImpressoes,
  };
}

// Vales do período (inclusive cancelados) e o resumo por pessoa: gorjeta, vales, líquida.
tipValesRouter.get("/periods/:year/:month/vales", async (request: Request, response: Response) => {
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  const periodo = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
  if (!periodo) return response.status(404).json({ message: "Período não encontrado." });
  const [vales, comp] = await Promise.all([
    prisma.tipVale.findMany({
      where: { participant: { periodId: periodo.id } },
      include: { reserveMovement: { select: { id: true } }, participant: { select: { employeeId: true, employee: { select: { displayName: true, firstName: true, lastName: true } } } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    computeTipCommission(year, month),
  ]);
  response.json({
    code: periodo.code, status: periodo.status,
    vales: vales.map((v) => ({ ...valeParaTela(v), employeeId: v.participant.employeeId, nome: nomeDe(v.participant.employee) })),
    pessoas: comp.participants.filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO").map((p) => ({
      participantId: p.participantId, employeeId: p.employeeId, nome: p.employeeName, semRegistro: p.semRegistro,
      funcao: p.functionName, empresaId: p.companyId, empresa: p.companyName,
      gorjeta: p.rateioAmount, descontos: p.descontos, creditos: p.creditos, liquida: p.netCommission, pagoNaRescisao: p.pagoNaRescisao,
    })),
  });
});

tipValesRouter.post("/participants/:id/vales", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const lido = lerVale(request.body as Record<string, unknown>);
  if ("erro" in lido) return response.status(422).json({ message: lido.erro });
  const participante = await prisma.tipParticipant.findUnique({ where: { id: request.params.id }, select: { id: true, periodId: true, employeeId: true } });
  if (!participante) return response.status(404).json({ message: "Pessoa não está na apuração." });
  if (await barradoPorFechamento(participante.periodId, response, "Lançar um vale")) return;
  // Número do recibo: se dois lançarem no mesmo instante, o segundo pega o próximo.
  let vale;
  for (let tentativa = 0; ; tentativa++) {
    try {
      vale = await prisma.tipVale.create({
        data: {
          id: crypto.randomUUID(), participantId: participante.id, ...lido.dados, createdById: user.id, createdByName: user.name,
          codigo: await proximoCodigoVale(new Date().getFullYear()),
        },
      });
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002" || tentativa >= 3) throw err;
    }
  }
  await auditLog({
    userId: user.id, action: "CREATE_TIP_VALE", entity: "TipVale", entityId: vale.id,
    newValue: { periodId: participante.periodId, employeeId: participante.employeeId, ...lido.dados },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json({ id: vale.id, codigo: vale.codigo });
});

// Corrigir um vale (tipo, valor, data, descrição). Crédito do fundo não se corrige aqui.
tipValesRouter.put("/vales/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const lido = lerVale(request.body as Record<string, unknown>);
  if ("erro" in lido) return response.status(422).json({ message: lido.erro });
  const antes = await prisma.tipVale.findUnique({ where: { id: request.params.id }, include: { participant: { select: { periodId: true } }, reserveMovement: { select: { id: true } } } });
  if (!antes) return response.status(404).json({ message: "Vale não encontrado." });
  if (antes.canceledAt) return response.status(409).json({ message: "Este vale foi cancelado; lance um novo." });
  if (antes.reserveMovement) return response.status(409).json({ message: "Crédito da distribuição do fundo: corrija pela aba Relatórios → Fundo de reserva." });
  if (await barradoPorFechamento(antes.participant.periodId, response, "Corrigir um vale")) return;
  await prisma.tipVale.update({ where: { id: antes.id }, data: { ...lido.dados, updatedById: user.id, updatedAt: new Date() } });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_VALE", entity: "TipVale", entityId: antes.id,
    previousValue: { type: antes.type, amount: Number(antes.amount), date: antes.date, notes: antes.notes },
    newValue: lido.dados, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Cancelar (com motivo). Crédito da distribuição do fundo devolve o valor ao fundo.
tipValesRouter.post("/vales/:id/cancelar", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const motivo = String((request.body as { motivo?: unknown } | undefined)?.motivo ?? "").trim().slice(0, 300);
  if (motivo.length < 5) return response.status(422).json({ message: "Escreva o motivo do cancelamento (pelo menos 5 letras)." });
  const antes = await prisma.tipVale.findUnique({ where: { id: request.params.id }, include: { participant: { select: { periodId: true, employeeId: true } }, reserveMovement: true } });
  if (!antes) return response.status(404).json({ message: "Vale não encontrado." });
  if (antes.canceledAt) return response.status(409).json({ message: "Este vale já está cancelado." });
  if (await barradoPorFechamento(antes.participant.periodId, response, "Cancelar um vale")) return;
  await prisma.$transaction(async (tx) => {
    if (antes.reserveMovement) {
      await travarFundo(tx);
      await tx.tipReserveMovement.delete({ where: { id: antes.reserveMovement.id } });
    }
    await tx.tipVale.update({
      where: { id: antes.id },
      data: { canceledAt: new Date(), canceledById: user.id, canceledByName: user.name, cancelReason: motivo },
    });
  });
  await auditLog({
    userId: user.id, action: "CANCEL_TIP_VALE", entity: "TipVale", entityId: antes.id,
    previousValue: { periodId: antes.participant.periodId, employeeId: antes.participant.employeeId, type: antes.type, amount: Number(antes.amount), date: antes.date, notes: antes.notes },
    newValue: { motivo, devolvidoAoFundo: Boolean(antes.reserveMovement), saldoFundo: antes.reserveMovement ? await saldoReserva(prisma) : undefined },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Relatório: vales de um intervalo de competências (AAAA-MM), cancelados inclusive.
tipValesRouter.get("/reports/vales", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  const mes = (v: unknown) => /^(\d{4})-(\d{2})$/.exec(String(v ?? ""));
  const de = mes(q.de);
  const ate = mes(q.ate);
  if (!de || !ate) return response.status(400).json({ message: "Informe o intervalo (de e até, AAAA-MM)." });
  const chave = (m: RegExpExecArray) => Number(m[1]) * 100 + Number(m[2]);
  const periodos = await prisma.tipPeriod.findMany({ select: { id: true, code: true, competenceYear: true, competenceMonth: true } });
  const noIntervalo = periodos.filter((p) => {
    const k = p.competenceYear * 100 + p.competenceMonth;
    return k >= chave(de) && k <= chave(ate);
  });
  const porId = new Map(noIntervalo.map((p) => [p.id, p]));
  const vales = await prisma.tipVale.findMany({
    where: { participant: { periodId: { in: [...porId.keys()] } } },
    include: { reserveMovement: { select: { id: true } }, participant: { select: { periodId: true, employeeId: true, employee: { select: { displayName: true, firstName: true, lastName: true } } } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  response.json(vales.map((v) => {
    const p = porId.get(v.participant.periodId)!;
    return {
      ...valeParaTela(v), employeeId: v.participant.employeeId, nome: nomeDe(v.participant.employee),
      periodo: p.code, competencia: `${String(p.competenceMonth).padStart(2, "0")}/${p.competenceYear}`,
    };
  }));
});

// ─── Descrições prontas ─────────────────────────────────────────────────────
tipValesRouter.get("/vale-descricoes", async (_request, response) => {
  const lista = await prisma.tipValeDescricao.findMany({ orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { texto: "asc" }] });
  response.json(lista.map((d) => ({ id: d.id, texto: d.texto, tipo: d.tipo, ativo: d.ativo })));
});

tipValesRouter.post("/vale-descricoes", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { texto?: unknown; tipo?: unknown };
  const texto = String(b.texto ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const tipoBruto = b.tipo == null || b.tipo === "" ? null : String(b.tipo);
  if (texto.length < 3) return response.status(422).json({ message: "Escreva a descrição (pelo menos 3 letras)." });
  if (tipoBruto && !TIPOS.includes(tipoBruto as Tipo)) return response.status(422).json({ message: "Tipo inválido." });
  const tipo = tipoBruto as Tipo | null;
  const existente = await prisma.tipValeDescricao.findFirst({ where: { texto: { equals: texto, mode: "insensitive" }, tipo } });
  if (existente) {
    // Já existia (talvez desativada): só reativa.
    await prisma.tipValeDescricao.update({ where: { id: existente.id }, data: { ativo: true } });
  } else {
    const ultima = await prisma.tipValeDescricao.aggregate({ where: { tipo }, _max: { ordem: true } });
    await prisma.tipValeDescricao.create({ data: { id: crypto.randomUUID(), texto, tipo, ordem: (ultima._max.ordem ?? 0) + 1, createdById: user.id } });
  }
  await auditLog({ userId: user.id, action: "CREATE_TIP_VALE_DESCRICAO", entity: "TipValeDescricao", entityId: texto, newValue: { texto, tipo } });
  response.status(201).json({ ok: true });
});

tipValesRouter.put("/vale-descricoes/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const ativo = (request.body as { ativo?: unknown }).ativo !== false;
  const r = await prisma.tipValeDescricao.updateMany({ where: { id: request.params.id }, data: { ativo } });
  if (r.count === 0) return response.status(404).json({ message: "Descrição não encontrada." });
  await auditLog({ userId: user.id, action: ativo ? "REACTIVATE_TIP_VALE_DESCRICAO" : "DEACTIVATE_TIP_VALE_DESCRICAO", entity: "TipValeDescricao", entityId: request.params.id });
  response.json({ ok: true });
});

// ─── Recibo do vale ─────────────────────────────────────────────────────────
// Devolve o que vai impresso e registra a emissão (quem, quando, por qual empresa).
// CPF só vai para quem pode ver Funcionários; sem isso, o recibo sai com a linha em branco.
tipValesRouter.post("/vales/:id/recibo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const empresaId = String((request.body as { empresaId?: unknown } | undefined)?.empresaId ?? "");
  const vale = await prisma.tipVale.findUnique({
    where: { id: request.params.id },
    include: {
      participant: {
        select: {
          period: { select: { code: true, label: true } },
          employee: { select: { firstName: true, lastName: true, displayName: true, cpf: true, companyId: true, tipFunction: { select: { name: true } } } },
        },
      },
    },
  });
  if (!vale) return response.status(404).json({ message: "Vale não encontrado." });
  if (vale.canceledAt) return response.status(409).json({ message: "Vale cancelado não tem recibo." });
  if (vale.type === "CREDITO") return response.status(409).json({ message: "Crédito soma à gorjeta: não há recibo de desconto." });
  const idEmpresa = empresaId || vale.participant.employee.companyId;
  if (!idEmpresa) return response.status(422).json({ message: "Escolha a empresa que emite o recibo." });
  const empresa = await prisma.company.findFirst({
    where: { id: idEmpresa, isActive: true },
    select: { id: true, legalName: true, tradeName: true, cnpj: true, address: true, addressNumber: true, addressComplement: true, neighborhood: true, city: true, state: true },
  });
  if (!empresa) return response.status(422).json({ message: "Empresa não encontrada ou inativa." });
  const podeCpf = await userHasPermission(user as SessionUser, "employees", "view");
  const e = vale.participant.employee;
  const atualizado = await prisma.tipVale.update({
    where: { id: vale.id },
    data: { reciboEmpresaId: empresa.id, reciboImpressoEm: new Date(), reciboImpressoPor: user.name, reciboImpressoes: { increment: 1 } },
    select: { reciboImpressoes: true },
  });
  await auditLog({
    userId: user.id, action: "PRINT_TIP_VALE_RECIBO", entity: "TipVale", entityId: vale.id,
    newValue: { codigo: vale.codigo, empresa: empresa.legalName, vez: atualizado.reciboImpressoes },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  const endereco = [
    [empresa.address, empresa.addressNumber].filter(Boolean).join(", "), empresa.addressComplement, empresa.neighborhood,
    [empresa.city, empresa.state].filter(Boolean).join("/"),
  ].filter(Boolean).join(" · ");
  response.json({
    codigo: vale.codigo, vez: atualizado.reciboImpressoes,
    empresa: { razaoSocial: empresa.legalName, fantasia: empresa.tradeName, cnpj: empresa.cnpj, endereco, cidade: empresa.city },
    funcionario: { nome: nomeDe(e), cpf: podeCpf ? e.cpf : null, funcao: e.tipFunction?.name ?? null },
    vale: { tipo: vale.type, valor: Number(vale.amount), data: vale.date?.toISOString().slice(0, 10) ?? null, descricao: vale.notes },
    apuracao: { codigo: vale.participant.period.code, periodo: vale.participant.period.label },
    emitidoEm: new Date().toISOString(), emitidoPor: user.name,
  });
});
