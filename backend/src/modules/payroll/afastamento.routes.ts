import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForRange } from "../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";

// ─── Afastamento não remunerado ─────────────────────────────────────────────────
//
// Pedido da própria pessoa para ficar fora (sem remuneração). Lançado pela Folha, como as
// férias, mas NÃO vira PayrollItem: afastamento não é despesa. O intervalo vira um dia
// AFASTAMENTO por dia na Escala, com o motivo em `notes`, e é dali que leem:
//   - a gorjeta: os dias do ciclo sempre descontam presença;
//   - o salário de quem não tem registro (e a rescisão dele): descontam como faltas;
//   - o VT: o dia não gera condução.
// Um "intervalo" é uma sequência de dias seguidos com o mesmo motivo: não há tabela própria,
// então editar e excluir apontam o intervalo pelas datas.

export const afastamentoRouter = Router();

export const MOTIVO_MINIMO_LETRAS = 5;
const MAX_DIAS = 366;
const DIA_MS = 86_400_000;

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const dataBr = (d: Date | string) => (typeof d === "string" ? d : isoDia(d)).split("-").reverse().join("/");

export function letrasDoMotivo(motivo: unknown): number {
  return typeof motivo === "string" ? (motivo.match(/\p{L}/gu) ?? []).length : 0;
}

// "AAAA-MM-DD" de verdade (31/02 não vira 03/03 em silêncio) → meia-noite UTC.
export function parseDia(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || isoDia(d) !== v ? null : d;
}

export type IntervaloAfastamento = { employeeId: string; inicio: string; fim: string; dias: number; motivo: string | null };

// Dias seguidos, da mesma pessoa e com o mesmo motivo, formam um intervalo. Não há id de
// lançamento: dois afastamentos lançados colados (ex.: 01–10 e 11–20) com o MESMO motivo viram
// um intervalo só (01–20) na lista, e editar/excluir passa a valer para os dois juntos. Motivos
// diferentes mantêm os intervalos separados.
export function agruparAfastamentos(rows: Array<{ employeeId: string; date: Date; notes: string | null }>): IntervaloAfastamento[] {
  const ordenadas = [...rows].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.getTime() - b.date.getTime());
  return ordenadas.reduce<IntervaloAfastamento[]>((acc, r) => {
    const ultimo = acc[acc.length - 1];
    const motivo = r.notes ?? null;
    const emenda = ultimo && ultimo.employeeId === r.employeeId && ultimo.motivo === motivo
      && parseDia(ultimo.fim)!.getTime() + DIA_MS === r.date.getTime();
    if (emenda) return [...acc.slice(0, -1), { ...ultimo, fim: isoDia(r.date), dias: ultimo.dias + 1 }];
    return [...acc, { employeeId: r.employeeId, inicio: isoDia(r.date), fim: isoDia(r.date), dias: 1, motivo }];
  }, []);
}

class Recusa extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// Trava de período financeiro (mês travado ou CMV fechado) em todos os meses tocados: o
// afastamento muda salário e gorjeta desses meses.
async function mesesLiberados(inicio: Date, fim: Date, contexto: string) {
  try {
    await assertPeriodWritableForRange(inicio, fim, contexto);
  } catch (err) {
    throw new Recusa(400, err instanceof Error ? err.message : "Período fechado.");
  }
}

type Funcionario = { id: string; firstName: string; lastName: string; displayName: string | null; admissionDate: Date | null; terminationDate: Date | null };
const nomeDe = (e: Pick<Funcionario, "firstName" | "lastName" | "displayName">) => e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
const soDia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

async function funcionario(employeeId: unknown): Promise<Funcionario> {
  if (typeof employeeId !== "string" || !employeeId.trim()) throw new Recusa(400, "Funcionário é obrigatório.");
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, admissionDate: true, terminationDate: true },
  });
  if (!emp) throw new Recusa(404, "Funcionário não encontrado.");
  return emp;
}

function intervaloDe(inicioRaw: unknown, fimRaw: unknown): { inicio: Date; fim: Date } {
  const inicio = parseDia(inicioRaw);
  const fim = parseDia(fimRaw);
  if (!inicio || !fim) throw new Recusa(400, "Data de início ou de fim do afastamento inválida (use AAAA-MM-DD).");
  if (fim < inicio) throw new Recusa(400, "O fim do afastamento não pode ser antes do início.");
  return { inicio, fim };
}

function motivoDe(raw: unknown): string {
  const motivo = typeof raw === "string" ? raw.trim() : "";
  if (letrasDoMotivo(motivo) < MOTIVO_MINIMO_LETRAS) {
    throw new Recusa(400, `Informe o motivo do afastamento (pelo menos ${MOTIVO_MINIMO_LETRAS} letras).`);
  }
  return motivo.slice(0, 500);
}

function dentroDoVinculo(emp: Funcionario, inicio: Date, fim: Date) {
  if (emp.admissionDate && inicio.getTime() < soDia(emp.admissionDate)) {
    throw new Recusa(400, `${nomeDe(emp)} foi admitido(a) em ${dataBr(emp.admissionDate)}: o afastamento não pode começar antes da admissão.`);
  }
  if (emp.terminationDate && fim.getTime() > soDia(emp.terminationDate)) {
    throw new Recusa(400, `${nomeDe(emp)} tem desligamento em ${dataBr(emp.terminationDate)}: o afastamento não pode passar do desligamento.`);
  }
  const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA_MS) + 1;
  if (dias > MAX_DIAS) throw new Recusa(400, `Afastamento de ${dias} dias: o limite é ${MAX_DIAS} por lançamento.`);
  return dias;
}

// Dia que já é afastamento (fora do intervalo que está sendo editado) ou férias lançadas na
// Folha: recusa. Afastamento e férias no mesmo dia pagariam e descontariam ao mesmo tempo.
async function semConflito(emp: Funcionario, inicio: Date, fim: Date, ignorar?: { inicio: Date; fim: Date }) {
  const existentes = (await prisma.employeeScheduleDay.findMany({
    where: { employeeId: emp.id, type: "AFASTAMENTO", date: { gte: inicio, lte: fim } },
    select: { date: true },
  })).filter((r) => !ignorar || r.date < ignorar.inicio || r.date > ignorar.fim);
  if (existentes.length > 0) {
    const primeiro = existentes.map((r) => r.date).sort((a, b) => a.getTime() - b.getTime())[0];
    throw new Recusa(409, `${nomeDe(emp)} já tem afastamento lançado em ${dataBr(primeiro)}${existentes.length > 1 ? ` (e mais ${existentes.length - 1} dia(s))` : ""} dentro deste intervalo. Edite o que já existe.`);
  }
  const feriasNaEscala = await prisma.employeeScheduleDay.findMany({
    where: { employeeId: emp.id, type: "FERIAS", date: { gte: inicio, lte: fim } },
    select: { date: true },
  });
  if (feriasNaEscala.length > 0) {
    const primeiro = feriasNaEscala.map((r) => r.date).sort((a, b) => a.getTime() - b.getTime())[0];
    throw new Recusa(409, `${nomeDe(emp)} tem férias marcadas na Escala em ${dataBr(primeiro)}${feriasNaEscala.length > 1 ? ` (e mais ${feriasNaEscala.length - 1} dia(s))` : ""}, dentro deste afastamento.`);
  }
  const ferias = await prisma.payrollItem.findMany({
    where: {
      employeeId: emp.id, type: "FERIAS", deletedAt: null, status: { not: "CANCELED" },
      periodStart: { lte: fim }, periodEnd: { gte: inicio },
    },
    select: { periodStart: true, periodEnd: true },
  });
  const f = ferias.find((x) => x.periodStart && x.periodEnd);
  if (f) {
    throw new Recusa(409, `${nomeDe(emp)} tem férias lançadas na Folha de ${dataBr(f.periodStart!)} a ${dataBr(f.periodEnd!)}, que cruzam este afastamento.`);
  }
}

// Gorjeta já fechada no intervalo: o fechado não muda (vale o que foi gravado). Só avisa.
async function avisosDeFechado(inicio: Date, fim: Date): Promise<string[]> {
  const fechados = await prisma.tipPeriod.findMany({
    where: { status: "CLOSED", periodStart: { lte: fim }, periodEnd: { gte: inicio } },
    select: { label: true, code: true },
  });
  return fechados.map((p) => `${p.label}${p.code ? ` (${p.code})` : ""} já está fechada: o afastamento não muda o que foi fechado — reabra a gorjeta para recalcular.`);
}

type Cliente = Pick<typeof prisma, "employeeScheduleDay">;

// Grava o intervalo: o que estava marcado nesses dias (folga, turno, falta…) sai — a pessoa
// está afastada — e cada dia vira AFASTAMENTO com o motivo.
async function gravarDias(tx: Cliente, emp: Funcionario, inicio: Date, fim: Date, motivo: string, userId: string) {
  const substituidas = (await tx.employeeScheduleDay.findMany({
    where: { employeeId: emp.id, date: { gte: inicio, lte: fim } },
    select: { date: true, type: true },
  })).filter((r) => r.type !== "AFASTAMENTO").map((r) => ({ date: isoDia(r.date), type: r.type as string }))
    .sort((a, b) => a.date.localeCompare(b.date));
  await tx.employeeScheduleDay.deleteMany({ where: { employeeId: emp.id, date: { gte: inicio, lte: fim } } });
  const data = [];
  for (let t = inicio.getTime(); t <= fim.getTime(); t += DIA_MS) {
    data.push({ id: crypto.randomUUID(), employeeId: emp.id, date: new Date(t), type: "AFASTAMENTO" as const, notes: motivo, createdById: userId });
  }
  await tx.employeeScheduleDay.createMany({ data, skipDuplicates: true });
  return substituidas;
}

function responderRecusa(err: unknown, response: { status: (c: number) => { json: (b: unknown) => unknown } }) {
  if (err instanceof Recusa) return response.status(err.status).json({ message: err.message });
  throw err;
}

const auditoria = (request: Parameters<typeof requestIp>[0]) => ({
  ipAddress: requestIp(request),
  userAgent: String(request.headers["user-agent"] ?? ""),
});

// ─── GET /payroll/afastamentos?year=&month=[&employeeId=] ───────────────────────
// Intervalos que tocam o mês, inteiros (um afastamento de 20/08 a 10/09 vem completo em setembro).
afastamentoRouter.get("/", async (request, response) => {
  const year = Number(request.query.year);
  const month = Number(request.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return response.status(400).json({ message: "Informe ano (2000 a 2100) e mês (1 a 12) válidos." });
  }
  const inicioMes = new Date(Date.UTC(year, month - 1, 1));
  const proximoMes = new Date(Date.UTC(year, month, 1));
  const filtroPessoa = typeof request.query.employeeId === "string" && request.query.employeeId ? request.query.employeeId : null;

  const doMes = await prisma.employeeScheduleDay.findMany({
    where: { type: "AFASTAMENTO", date: { gte: inicioMes, lt: proximoMes }, ...(filtroPessoa ? { employeeId: { in: [filtroPessoa] } } : {}) },
    select: { employeeId: true },
  });
  const ids = [...new Set(doMes.map((r) => r.employeeId))];
  if (ids.length === 0) return response.json({ year, month, afastamentos: [] });

  const [dias, pessoas] = await Promise.all([
    prisma.employeeScheduleDay.findMany({
      where: { employeeId: { in: ids }, type: "AFASTAMENTO" },
      select: { employeeId: true, date: true, notes: true },
    }),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, displayName: true } }),
  ]);
  const nome = new Map(pessoas.map((p) => [p.id, nomeDe(p)]));
  const afastamentos = agruparAfastamentos(dias)
    .filter((i) => parseDia(i.inicio)! < proximoMes && parseDia(i.fim)! >= inicioMes)
    .map((i) => ({ employeeId: i.employeeId, employeeName: nome.get(i.employeeId) ?? "", inicio: i.inicio, fim: i.fim, dias: i.dias, motivo: i.motivo }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR") || a.inicio.localeCompare(b.inicio));
  response.json({ year, month, afastamentos });
});

// ─── POST /payroll/afastamentos — lançar ────────────────────────────────────────
afastamentoRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as Record<string, unknown>;
  try {
    const emp = await funcionario(b.employeeId);
    const { inicio, fim } = intervaloDe(b.inicio, b.fim);
    const motivo = motivoDe(b.motivo);
    const dias = dentroDoVinculo(emp, inicio, fim);
    await mesesLiberados(inicio, fim, "Lancamento de afastamento");
    await semConflito(emp, inicio, fim);
    const substituidas = await prisma.$transaction((tx) => gravarDias(tx, emp, inicio, fim, motivo, user.id));
    const avisos = await avisosDeFechado(inicio, fim);
    await auditLog({
      userId: user.id, action: "RELEASE_UNPAID_LEAVE", entity: "EmployeeScheduleDay", entityId: emp.id,
      previousValue: substituidas.length ? { marcasSubstituidas: substituidas } : undefined,
      newValue: { employeeId: emp.id, inicio: isoDia(inicio), fim: isoDia(fim), dias, motivo },
      ...auditoria(request),
    });
    return response.status(201).json({ employeeId: emp.id, inicio: isoDia(inicio), fim: isoDia(fim), dias, motivo, substituidas: substituidas.length, avisos });
  } catch (err) {
    return responderRecusa(err, response);
  }
});

// ─── PUT /payroll/afastamentos — editar um intervalo (datas e motivo) ───────────
afastamentoRouter.put("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as Record<string, unknown>;
  try {
    const emp = await funcionario(b.employeeId);
    const atual = intervaloDe(b.inicioAtual, b.fimAtual);
    const antigos = await prisma.employeeScheduleDay.findMany({
      where: { employeeId: emp.id, type: "AFASTAMENTO", date: { gte: atual.inicio, lte: atual.fim } },
      select: { date: true, notes: true },
    });
    if (antigos.length === 0) throw new Recusa(404, "Afastamento não encontrado nesse intervalo (pode ter sido alterado por outra pessoa). Recarregue a lista.");
    const { inicio, fim } = intervaloDe(b.inicio, b.fim);
    const motivo = motivoDe(b.motivo);
    const dias = dentroDoVinculo(emp, inicio, fim);
    // O intervalo antigo também muda (os dias dele saem): os dois precisam estar liberados.
    await mesesLiberados(atual.inicio, atual.fim, "Edicao de afastamento");
    await mesesLiberados(inicio, fim, "Edicao de afastamento");
    await semConflito(emp, inicio, fim, atual);
    const substituidas = await prisma.$transaction(async (tx) => {
      await tx.employeeScheduleDay.deleteMany({ where: { employeeId: emp.id, type: "AFASTAMENTO", date: { gte: atual.inicio, lte: atual.fim } } });
      return gravarDias(tx, emp, inicio, fim, motivo, user.id);
    });
    const avisos = await avisosDeFechado(new Date(Math.min(inicio.getTime(), atual.inicio.getTime())), new Date(Math.max(fim.getTime(), atual.fim.getTime())));
    await auditLog({
      userId: user.id, action: "UPDATE_UNPAID_LEAVE", entity: "EmployeeScheduleDay", entityId: emp.id,
      previousValue: { inicio: isoDia(atual.inicio), fim: isoDia(atual.fim), dias: antigos.length, motivo: antigos[0].notes ?? null },
      newValue: { inicio: isoDia(inicio), fim: isoDia(fim), dias, motivo, ...(substituidas.length ? { marcasSubstituidas: substituidas } : {}) },
      ...auditoria(request),
    });
    return response.json({ employeeId: emp.id, inicio: isoDia(inicio), fim: isoDia(fim), dias, motivo, substituidas: substituidas.length, avisos });
  } catch (err) {
    return responderRecusa(err, response);
  }
});

// ─── DELETE /payroll/afastamentos?employeeId=&inicio=&fim= ──────────────────────
// Tira só os dias AFASTAMENTO do intervalo; o que mais houver na escala fica.
afastamentoRouter.delete("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  try {
    const emp = await funcionario(request.query.employeeId);
    const { inicio, fim } = intervaloDe(request.query.inicio, request.query.fim);
    const where = { employeeId: emp.id, type: "AFASTAMENTO" as const, date: { gte: inicio, lte: fim } };
    const antigos = await prisma.employeeScheduleDay.findMany({ where, select: { date: true, notes: true } });
    if (antigos.length === 0) throw new Recusa(404, "Afastamento não encontrado nesse intervalo. Recarregue a lista.");
    await mesesLiberados(inicio, fim, "Exclusao de afastamento");
    await prisma.employeeScheduleDay.deleteMany({ where });
    const avisos = await avisosDeFechado(inicio, fim);
    await auditLog({
      userId: user.id, action: "DELETE_UNPAID_LEAVE", entity: "EmployeeScheduleDay", entityId: emp.id,
      previousValue: { inicio: isoDia(inicio), fim: isoDia(fim), dias: antigos.length, motivo: antigos[0].notes ?? null },
      ...auditoria(request),
    });
    return response.json({ ok: true, dias: antigos.length, avisos });
  } catch (err) {
    return responderRecusa(err, response);
  }
});
