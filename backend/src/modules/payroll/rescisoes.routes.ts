// RH → Rescisões: a lista de quem saiu (ou está saindo) com a situação da rescisão, e o
// detalhe que a tela usa para mostrar as pendências antes de lançar.
//
// Montado em /payroll/rescisoes: o controle de acesso resolve pelo prefixo /payroll, o
// mesmo módulo que lança a rescisão. Sem CPF e sem salário — nada aqui depende de
// poder ver Funcionários.
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import { entraNaLista, itensDaFolhaAposSaida, resumoDaRescisao, type ResumoRescisaoLancada } from "./rescisoes-lista.js";

export const rescisoesRouter = Router();

const isoDia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const nomeDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();

type TermoGravado = { arquivo?: unknown; importadoEm?: unknown; gorjeta?: unknown; liquido?: unknown; pagamento?: unknown };
type TermoResumo = { arquivo: string | null; importadoEm: string | null; gorjeta: number | null; liquido: number | null; pagamento: string | null };
function termoDe(recibo: unknown): TermoResumo | null {
  if (!recibo || typeof recibo !== "object") return null;
  const r = recibo as TermoGravado;
  return {
    arquivo: typeof r.arquivo === "string" ? r.arquivo : null,
    importadoEm: typeof r.importadoEm === "string" ? r.importadoEm : null,
    gorjeta: typeof r.gorjeta === "number" ? r.gorjeta : null,
    liquido: typeof r.liquido === "number" ? r.liquido : null,
    pagamento: typeof r.pagamento === "string" ? r.pagamento : null,
  };
}

const SELECT_PESSOA = {
  id: true, firstName: true, lastName: true, displayName: true, modality: true,
  terminationDate: true, terminationReason: true, isActive: true,
  company: { select: { tradeName: true } },
} as const;

const RESCISAO_VIVA = { type: "RESCISAO" as const, deletedAt: null, status: { not: "CANCELED" as const } };

// ─── LISTA ─────────────────────────────────────────────────────────────────────
rescisoesRouter.get("/", async (_request, response) => {
  const hojeIso = hojeEmSaoPaulo();
  const hoje = new Date(`${hojeIso}T00:00:00.000Z`);

  const candidatos = await prisma.employee.findMany({
    where: {
      deletedAt: null,
      OR: [
        { terminationDate: { not: null } },
        { payrollItems: { some: { ...RESCISAO_VIVA, paymentDate: null } } },
      ],
    },
    select: SELECT_PESSOA,
  });
  const ids = candidatos.map((c) => c.id);
  const [parcelas, participacoes, ativos] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { ...RESCISAO_VIVA, employeeId: { in: ids } },
      select: { employeeId: true, amount: true, paymentDate: true, dueDate: true },
    }),
    prisma.tipParticipant.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, rescisaoRecibo: true },
    }),
    prisma.employee.findMany({
      where: { deletedAt: null, isActive: true, terminationDate: null },
      select: { id: true, firstName: true, lastName: true, displayName: true, modality: true, company: { select: { tradeName: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);

  const resumos = new Map<string, ResumoRescisaoLancada | null>(
    ids.map((id) => [id, resumoDaRescisao(parcelas.filter((p) => p.employeeId === id))]),
  );
  const termos = new Map<string, ReturnType<typeof termoDe>>();
  for (const p of participacoes) {
    const t = termoDe(p.rescisaoRecibo);
    if (t) termos.set(p.employeeId, t);
  }

  const pessoas = candidatos
    .filter((c) => entraNaLista({ saida: c.terminationDate, hoje, rescisao: resumos.get(c.id) ?? null }))
    .map((c) => ({
      employeeId: c.id,
      nome: nomeDe(c),
      apelido: c.displayName,
      empresa: c.company?.tradeName ?? null,
      semRegistro: c.modality === "NAO_CLT",
      saida: isoDia(c.terminationDate),
      motivo: c.terminationReason,
      rescisao: resumos.get(c.id) ?? null,
      termo: termos.get(c.id) ?? null,
    }))
    .sort((a, b) => (b.saida ?? "").localeCompare(a.saida ?? "") || a.nome.localeCompare(b.nome, "pt-BR"));

  response.json({
    hoje: hojeIso,
    pessoas,
    ativos: ativos.map((a) => ({
      employeeId: a.id, nome: nomeDe(a), apelido: a.displayName,
      empresa: a.company?.tradeName ?? null, semRegistro: a.modality === "NAO_CLT",
    })),
  });
});

// ─── DETALHE (pendências antes de lançar) ──────────────────────────────────────
rescisoesRouter.get("/:employeeId", async (request, response) => {
  const emp = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null }, select: SELECT_PESSOA });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const saida = emp.terminationDate;
  const [itens, parcelas] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { employeeId: emp.id, deletedAt: null, paymentDate: null, status: { not: "CANCELED" }, type: { notIn: ["RESCISAO", "FERIAS"] } },
      select: {
        id: true, type: true, status: true, periodLabel: true, competenceYear: true, competenceMonth: true,
        amount: true, dueDate: true, paymentDate: true, details: true,
      },
    }),
    prisma.payrollItem.findMany({ where: { ...RESCISAO_VIVA, employeeId: emp.id }, select: { amount: true, paymentDate: true, dueDate: true } }),
  ]);

  // O período de gorjeta que contém a saída: é nele que o termo (TRCT) é lido.
  const periodo = saida
    ? await prisma.tipPeriod.findFirst({
      where: { periodStart: { lte: saida }, periodEnd: { gte: saida } },
      select: { id: true, competenceYear: true, competenceMonth: true, label: true, status: true },
    })
    : null;
  const participante = periodo
    ? await prisma.tipParticipant.findUnique({
      where: { periodId_employeeId: { periodId: periodo.id, employeeId: emp.id } },
      select: { rescisaoRecibo: true },
    })
    : null;

  // Folha do mês da saída (extrato da contabilidade) já importada? E a pessoa está nela?
  const extrato = saida
    ? await prisma.rhExtract.findFirst({
      where: { competenceYear: saida.getUTCFullYear(), competenceMonth: saida.getUTCMonth() + 1, calculo: "MENSAL" },
      select: { id: true, pessoas: { where: { employeeId: emp.id }, select: { id: true } } },
    })
    : null;

  response.json({
    pessoa: {
      employeeId: emp.id, nome: nomeDe(emp), apelido: emp.displayName, empresa: emp.company?.tradeName ?? null,
      semRegistro: emp.modality === "NAO_CLT", saida: isoDia(saida), motivo: emp.terminationReason,
      rescisao: resumoDaRescisao(parcelas),
      termo: termoDe(participante?.rescisaoRecibo),
    },
    itensAposSaida: itensDaFolhaAposSaida(itens, saida),
    periodoGorjeta: periodo
      ? { year: periodo.competenceYear, month: periodo.competenceMonth, label: periodo.label, fechado: periodo.status === "CLOSED", participa: participante != null }
      : null,
    extratoDoMes: saida
      ? {
        competencia: `${String(saida.getUTCMonth() + 1).padStart(2, "0")}/${saida.getUTCFullYear()}`,
        importado: extrato != null,
        pessoaNoExtrato: (extrato?.pessoas.length ?? 0) > 0,
      }
      : null,
  });
});
