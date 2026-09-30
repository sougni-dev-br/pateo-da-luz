// Backfill do histórico do cadastro a partir da auditoria (AuditLog). Usado por
// scripts/backfill-historico-cadastro.ts; aqui para os testes alcançarem.
//
// Cada registro de auditoria de funcionário com o "antes" e o "depois" vira uma linha por
// campo rastreado que mudou, vigente desde o dia da alteração (em São Paulo). A auditoria
// guarda o cadastro inteiro — com CPF —, mas só os campos rastreados são lidos daqui.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { alteracoes, type Alteracao } from "./cadastro-historico.js";

export const ACOES_BACKFILL = [
  "UPDATE_EMPLOYEE", "UPDATE_SALARIO_COMBINADO", "UPDATE_TIP_TEAM_MEMBER", "IMPORT_TIP_TEAM_MEMBER",
  "TERMINATE_EMPLOYEE", "INACTIVATE_EMPLOYEE", "REACTIVATE_EMPLOYEE",
] as const;

export type RegistroAuditoria = {
  id: string;
  action: string;
  entityId: string | null;
  userId: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
};

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

// Dia civil em São Paulo (a auditoria grava o instante em UTC).
export function diaEmSaoPaulo(d: Date): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  return new Date(`${iso}T00:00:00.000Z`);
}

// O que um registro de auditoria mudou nos campos rastreados. CREATE não é mudança
// (sem linha = o valor do cadastro vale desde sempre).
export function alteracoesDoAudit(a: RegistroAuditoria): Alteracao[] {
  const antes = objeto(a.previousValue);
  const depois = objeto(a.newValue);
  if (!antes || !depois) return [];
  if (a.action === "UPDATE_SALARIO_COMBINADO") {
    // Formato próprio: { valor, motivo }.
    return alteracoes({ salarioCombinado: antes.valor }, { salarioCombinado: depois.valor ?? null });
  }
  // Só o que está dos dois lados: campo que nem existia na auditoria antiga (ex.: o
  // adiantamento, criado depois) não é mudança de "vazio" para o valor novo.
  const emAmbos = Object.fromEntries(Object.entries(depois).filter(([k]) => k in antes));
  return alteracoes(antes, emAmbos);
}

export type LinhaBackfill = Alteracao & {
  employeeId: string; origemRef: string; vigenteDesde: Date; createdAt: Date;
  motivo: string; criadoPorId: string | null; action: string;
};

export function linhasDoAudit(a: RegistroAuditoria): LinhaBackfill[] {
  if (!a.entityId) return [];
  const motivoCombinado = a.action === "UPDATE_SALARIO_COMBINADO" ? objeto(a.newValue)?.motivo : null;
  return alteracoesDoAudit(a).map((alt) => ({
    ...alt,
    employeeId: a.entityId!,
    origemRef: a.id,
    vigenteDesde: diaEmSaoPaulo(a.createdAt),
    // A ordem de registro decide o vigente: a linha nasce com a data da auditoria.
    createdAt: a.createdAt,
    motivo: `Reconstruído da auditoria (${a.action})${typeof motivoCombinado === "string" && motivoCombinado ? `: ${motivoCombinado.slice(0, 200)}` : ""}`,
    criadoPorId: a.userId,
    action: a.action,
  }));
}

type Db = Pick<PrismaClient, "auditLog" | "employeeHistorico" | "employee" | "user">;

export type ResultadoBackfill = {
  auditorias: number;
  linhas: LinhaBackfill[];
  novas: LinhaBackfill[];
  jaExistiam: number;
  corte: Date | null;
  gravadas: number;
};

// Simulação por padrão: só calcula. `aplicar` grava (sem duplicar: origemRef + campo é único).
// Auditoria depois da primeira linha gravada pelo próprio sistema fica de fora: aquela
// mudança já entrou no histórico na hora, e repetir a linha duplicaria a mudança.
export async function executarBackfill(db: Db, opts: { aplicar: boolean }): Promise<ResultadoBackfill> {
  const primeiraDoSistema = await db.employeeHistorico.findFirst({
    where: { origem: { not: "BACKFILL" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true },
  });
  const corte = primeiraDoSistema?.createdAt ?? null;
  const auditorias = await db.auditLog.findMany({
    where: { entity: "Employee", action: { in: [...ACOES_BACKFILL] }, ...(corte ? { createdAt: { lt: corte } } : {}) },
    select: { id: true, action: true, entityId: true, userId: true, previousValue: true, newValue: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  // Só funcionários que existem (auditoria de cadastro apagado de vez não tem para onde ir).
  const ids = [...new Set(auditorias.map((a) => a.entityId).filter((x): x is string => Boolean(x)))];
  const existentes = new Set((await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id));
  const linhas = auditorias.flatMap((a) => linhasDoAudit(a)).filter((l) => existentes.has(l.employeeId));

  const refs = [...new Set(linhas.map((l) => l.origemRef))];
  const jaGravadas = new Set((await db.employeeHistorico.findMany({
    where: { origemRef: { in: refs } }, select: { origemRef: true, campo: true },
  })).map((h) => `${h.origemRef}|${h.campo}`));
  const novas = linhas.filter((l) => !jaGravadas.has(`${l.origemRef}|${l.campo}`));

  let gravadas = 0;
  if (opts.aplicar && novas.length > 0) {
    const usuarios = [...new Set(novas.map((l) => l.criadoPorId).filter((x): x is string => Boolean(x)))];
    const nomes = new Map((await db.user.findMany({ where: { id: { in: usuarios } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const r = await db.employeeHistorico.createMany({
      data: novas.map((l) => ({
        id: crypto.randomUUID(),
        employeeId: l.employeeId, campo: l.campo, valorAnterior: l.valorAnterior, valorNovo: l.valorNovo,
        vigenteDesde: l.vigenteDesde, motivo: l.motivo, origem: "BACKFILL", origemRef: l.origemRef,
        criadoPorId: l.criadoPorId, criadoPorNome: l.criadoPorId ? nomes.get(l.criadoPorId) ?? null : "script",
        createdAt: l.createdAt,
      })),
      skipDuplicates: true,
    });
    gravadas = r.count;
  }
  return { auditorias: auditorias.length, linhas, novas, jaExistiam: linhas.length - novas.length, corte, gravadas };
}
