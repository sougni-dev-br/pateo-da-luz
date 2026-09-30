import { Router } from "express";
import { prisma } from "../../config/database.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { getSessionUser, type SessionUser } from "../security/security-utils.js";
import { avaliarHabitualidade, resumirDiarias, type DiariaParaResumo } from "./extras-calc.js";
import { hojeEmSaoPaulo, lerData, ymd } from "./extras-comum.js";
import { custoExtrasSql } from "./extras-custo.js";
import { limitesHabitualidade } from "./extras.routes.js";
import { nomeCompleto } from "./nomes.js";

// Fase 3 dos extras: painel por período e aviso de habitualidade.
export const extrasPainelRouter = Router();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MESES_MIN = 3;
const MESES_MAX = 24;
const JANELA_HABITUALIDADE_DIAS = 90;

type LinhaMes = { mes: string; valor: string | null };

// "2026-09" + n meses → primeiro dia (UTC) desse mês.
function inicioDoMes(ano: number, mes: number, deslocamento = 0) {
  return new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
}
const chaveMes = (d: Date) => d.toISOString().slice(0, 7);

// ─── PAINEL POR PERÍODO ──────────────────────────────────────────────────────
// Gasto com extras mês a mês (casa × fora + diferença paga, a mesma regra do
// DRE) e, para quem pode ver, a folha e o faturamento do mesmo mês — o peso
// dos extras no custo de pessoal e na receita.
extrasPainelRouter.get("/painel", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const hoje = hojeEmSaoPaulo();
  const m = /^(\d{4})-(\d{2})$/.exec(String(request.query.ate ?? ""));
  const ano = m ? Number(m[1]) : Number(hoje.slice(0, 4));
  const mes = m ? Number(m[2]) : Number(hoje.slice(5, 7));
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return response.status(400).json({ message: "Mês final inválido." });
  const pedidos = Number.parseInt(String(request.query.meses ?? "6"), 10);
  const qtd = Math.min(Math.max(Number.isFinite(pedidos) ? pedidos : 6, MESES_MIN), MESES_MAX);

  const inicio = inicioDoMes(ano, mes, -(qtd - 1));
  const fim = inicioDoMes(ano, mes, 1);
  const meses = Array.from({ length: qtd }, (_, i) => chaveMes(inicioDoMes(ano, mes, -(qtd - 1) + i)));

  // Folha e faturamento são dado de outros módulos: só para quem os vê.
  const [verFolha, verFaturamento] = await Promise.all([
    userHasPermission(user as SessionUser, "payroll", "view"),
    userHasPermission(user as SessionUser, "revenue", "view"),
  ]);

  const [diarias, diferencas, folha, faturamento] = await Promise.all([
    prisma.extraShift.findMany({
      where: { deletedAt: null, status: "REALIZADA", date: { gte: inicio, lt: fim } },
      select: {
        date: true, duration: true, totalAmount: true, sector: true, reason: true, eventName: true, employeeId: true, extraWorkerId: true,
        employee: { select: { firstName: true, lastName: true, displayName: true } },
        extraWorker: { select: { fullName: true } },
      },
    }),
    prisma.$queryRaw<LinhaMes[]>`
      SELECT to_char(c.dia, 'YYYY-MM') AS mes, SUM(c.valor)::text AS valor
      FROM (${custoExtrasSql}) c
      WHERE NOT c.diaria AND c.dia >= ${ymd(inicio)}::date AND c.dia < ${ymd(fim)}::date
      GROUP BY 1
    `,
    verFolha
      ? prisma.$queryRaw<LinhaMes[]>`
          SELECT to_char(MAKE_DATE(p."competenceYear", p."competenceMonth", 1), 'YYYY-MM') AS mes, SUM(p.amount)::text AS valor
          FROM "PayrollItem" p
          WHERE p."deletedAt" IS NULL AND p.status <> 'CANCELED'
            AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1) >= ${ymd(inicio)}::date
            AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1) < ${ymd(fim)}::date
          GROUP BY 1
        `
      : Promise.resolve([] as LinhaMes[]),
    verFaturamento
      ? prisma.$queryRaw<LinhaMes[]>`
          SELECT to_char(r.date, 'YYYY-MM') AS mes, SUM(r."grossAmount")::text AS valor
          FROM "RevenueEntry" r
          WHERE r.status <> 'CANCELLED' AND r.date >= ${inicio} AND r.date < ${fim}
          GROUP BY 1
        `
      : Promise.resolve([] as LinhaMes[]),
  ]);

  const porMes = (linhas: LinhaMes[]) => new Map(linhas.map((l) => [l.mes, Number(l.valor ?? 0)]));
  const dif = porMes(diferencas);
  const fol = porMes(folha);
  const fat = porMes(faturamento);

  const serie = meses.map((chave) => {
    const doMes = diarias.filter((d) => ymd(d.date).startsWith(chave));
    const casa = round2(doMes.filter((d) => d.employeeId).reduce((s, d) => s + Number(d.totalAmount), 0));
    const fora = round2(doMes.filter((d) => d.extraWorkerId).reduce((s, d) => s + Number(d.totalAmount), 0));
    const diferencaPaga = round2(dif.get(chave) ?? 0);
    return {
      mes: chave,
      casa,
      fora,
      diferencaPaga,
      total: round2(casa + fora + diferencaPaga),
      diarias: doMes.reduce((s, d) => s + (d.duration === "MEIA" ? 0.5 : 1), 0),
      folha: verFolha ? round2(fol.get(chave) ?? 0) : null,
      faturamento: verFaturamento ? round2(fat.get(chave) ?? 0) : null,
    };
  });

  const resumo = resumirDiarias(diarias.map((d): DiariaParaResumo => ({
    status: "REALIZADA", duration: d.duration, totalAmount: Number(d.totalAmount), sector: d.sector, reason: d.reason, eventName: d.eventName,
    pessoaId: d.employeeId ?? d.extraWorkerId!, pessoaNome: d.employee ? nomeCompleto(d.employee) : d.extraWorker!.fullName,
    origem: d.employeeId ? "CASA" : "FORA",
  })));

  response.json({
    ate: `${ano}-${String(mes).padStart(2, "0")}`,
    meses: serie,
    verFolha,
    verFaturamento,
    porSetor: resumo.porSetor,
    porMotivo: resumo.porMotivo,
    porEvento: resumo.porEvento,
    porPessoa: resumo.porPessoa.slice(0, 10),
  });
});

// ─── HABITUALIDADE ───────────────────────────────────────────────────────────
// Pessoas de fora com diária frequente/regular (risco de vínculo). Conta
// realizadas e previstas: avisa antes de a diária agendada acontecer.
// ?pessoa=<id>&data=AAAA-MM-DD simula a diária que está sendo lançada, para o
// aviso aparecer ANTES de salvar ("com esta, chega a 3 dias na semana").
extrasPainelRouter.get("/habitualidade", async (request, response) => {
  const hoje = hojeEmSaoPaulo();
  const desde = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10) - JANELA_HABITUALIDADE_DIAS));
  const [limites, diarias] = await Promise.all([
    limitesHabitualidade(),
    prisma.extraShift.findMany({
      where: { deletedAt: null, extraWorkerId: { not: null }, status: { in: ["REALIZADA", "PREVISTA"] }, date: { gte: desde } },
      select: { id: true, date: true, extraWorkerId: true, extraWorker: { select: { fullName: true, displayName: true, isActive: true } } },
    }),
  ]);

  const porPessoa = new Map<string, { nome: string; apelido: string | null; ativo: boolean; diarias: { id: string; data: string }[] }>();
  for (const d of diarias) {
    const id = d.extraWorkerId!;
    const p = porPessoa.get(id) ?? { nome: d.extraWorker!.fullName, apelido: d.extraWorker!.displayName, ativo: d.extraWorker!.isActive, diarias: [] };
    p.diarias.push({ id: d.id, data: ymd(d.date) });
    porPessoa.set(id, p);
  }

  // ?ignorar=<id>: ao editar, a data antiga da própria diária não conta.
  const idValido = (v: unknown) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : null);
  const simPessoa = idValido(request.query.pessoa);
  const ignorar = idValido(request.query.ignorar);
  const simData = lerData(request.query.data);
  let simulacao = null;
  if (simPessoa && simData) {
    const atual = (porPessoa.get(simPessoa)?.diarias ?? []).filter((d) => d.id !== ignorar).map((d) => d.data);
    simulacao = { pessoa: simPessoa, data: ymd(simData), ...avaliarHabitualidade([...atual, ymd(simData)], hoje, limites, [ymd(simData)]) };
  }

  const pessoas = [...porPessoa.entries()]
    .map(([id, p]) => ({ id, nome: p.nome, apelido: p.apelido, ativo: p.ativo, ...avaliarHabitualidade(p.diarias.map((d) => d.data), hoje, limites) }))
    .sort((a, b) => Number(b.emRisco) - Number(a.emRisco) || b.diasUltimos30 - a.diasUltimos30 || a.nome.localeCompare(b.nome, "pt-BR"));

  response.json({ hoje, limites, pessoas, simulacao });
});
