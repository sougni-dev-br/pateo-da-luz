import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";

// Tarifas de transporte. Antes eram três colunas fixas em PayrollSettings, o que
// impedia cadastrar EMTU (intermunicipal) sem mexer no schema. Agora é uma lista:
// cada tarifa tem valor próprio e a própria regra de gratuidade.
export const vtFareRouter = Router();

const BASES = ["VIAGEM", "MENSAL"] as const;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

// No Domingão Tarifa Zero a tarifa CAI (ou zera) — nunca sobe. Sem esta trava,
// inverter os dois campos ao cadastrar faria a tarifa de domingo ficar MAIOR que
// a normal e cobrar mais caro todo domingo, em silêncio, para todo mundo que usa
// aquela tarifa.
function validaSundayAmount(raw: unknown, amount: number): string | null {
  if (raw === undefined) return null;
  const v = numOrNull(raw);
  if (v == null) return null; // vazio = cobra normal no domingo
  if (v < 0) return "O valor de domingo não pode ser negativo.";
  if (v > amount) return "O valor de domingo não pode ser maior que o valor normal da tarifa.";
  return null;
}

vtFareRouter.get("/", async (request, response) => {
  const includeInactive = request.query.includeInactive === "true";
  const fares = await prisma.vtFare.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  // Quantos funcionários dependem de cada tarifa — a tela usa isso para avisar
  // antes de desativar algo que está em uso, e para explicar por que o valor
  // de uma tarifa muda o VT de várias pessoas de uma vez.
  const legs = await prisma.employeeVtLeg.groupBy({
    by: ["fareId"],
    _count: { employeeId: true },
    where: { employee: { deletedAt: null, isActive: true } },
  });
  const monthly = await prisma.employee.groupBy({
    by: ["vtMonthlyFareId"],
    _count: { id: true },
    where: { deletedAt: null, isActive: true, vtMonthlyFareId: { not: null } },
  });
  const usage = new Map<string, number>();
  for (const l of legs) usage.set(l.fareId, (usage.get(l.fareId) ?? 0) + l._count.employeeId);
  for (const m of monthly) {
    if (m.vtMonthlyFareId) usage.set(m.vtMonthlyFareId, (usage.get(m.vtMonthlyFareId) ?? 0) + m._count.id);
  }
  response.json(fares.map((f) => ({ ...f, inUseBy: usage.get(f.id) ?? 0 })));
});

vtFareRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as Record<string, unknown>;
  const name = str(b.name);
  const amount = numOrNull(b.amount);
  if (!name) return response.status(400).json({ message: "Nome da tarifa é obrigatório." });
  if (amount == null || amount < 0) return response.status(400).json({ message: "Valor da tarifa inválido." });
  const erroDomingo = validaSundayAmount(b.sundayAmount, amount);
  if (erroDomingo) return response.status(400).json({ message: erroDomingo });

  const duplicate = await prisma.vtFare.findFirst({ where: { name } });
  if (duplicate) return response.status(400).json({ message: "Já existe uma tarifa com esse nome." });

  const created = await prisma.vtFare.create({
    data: {
      id: crypto.randomUUID(),
      name,
      amount,
      basis: BASES.includes(b.basis as (typeof BASES)[number]) ? (b.basis as (typeof BASES)[number]) : "VIAGEM",
      sundayAmount: numOrNull(b.sundayAmount),
      isActive: b.isActive === undefined ? true : Boolean(b.isActive),
      sortOrder: Math.round(numOrNull(b.sortOrder) ?? 99),
      notes: str(b.notes),
    },
  });

  await auditLog({
    userId: user.id, action: "CREATE_VT_FARE", entity: "VtFare", entityId: created.id,
    newValue: created, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json(created);
});

vtFareRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.vtFare.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Tarifa não encontrada." });

  const b = request.body as Record<string, unknown>;
  const name = str(b.name) ?? existing.name;
  const amount = numOrNull(b.amount);
  if (amount != null && amount < 0) return response.status(400).json({ message: "Valor da tarifa inválido." });
  const erroDomingo = validaSundayAmount(b.sundayAmount, amount ?? Number(existing.amount));
  if (erroDomingo) return response.status(400).json({ message: erroDomingo });

  const duplicate = await prisma.vtFare.findFirst({ where: { name, id: { not: existing.id } } });
  if (duplicate) return response.status(400).json({ message: "Já existe uma tarifa com esse nome." });

  const updated = await prisma.vtFare.update({
    where: { id: existing.id },
    data: {
      name,
      amount: amount ?? undefined,
      basis: BASES.includes(b.basis as (typeof BASES)[number]) ? (b.basis as (typeof BASES)[number]) : undefined,
      sundayAmount: b.sundayAmount === undefined ? undefined : numOrNull(b.sundayAmount),
      isActive: b.isActive === undefined ? undefined : Boolean(b.isActive),
      sortOrder: b.sortOrder === undefined ? undefined : Math.round(numOrNull(b.sortOrder) ?? existing.sortOrder),
      notes: b.notes === undefined ? undefined : str(b.notes),
    },
  });

  await auditLog({
    userId: user.id, action: "UPDATE_VT_FARE", entity: "VtFare", entityId: updated.id,
    previousValue: existing, newValue: updated,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json(updated);
});

// Excluir de verdade só quando ninguém usa. Uma tarifa em uso vira INATIVA:
// apagá-la arrastaria o trajeto de quem depende dela, e o VT dessa pessoa
// passaria a sair zerado em silêncio.
vtFareRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.vtFare.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Tarifa não encontrada." });

  const legs = await prisma.employeeVtLeg.count({ where: { fareId: existing.id } });
  const monthly = await prisma.employee.count({ where: { vtMonthlyFareId: existing.id } });
  if (legs + monthly > 0) {
    return response.status(400).json({
      message: `Esta tarifa está no trajeto de ${legs + monthly} funcionário(s). Troque o trajeto deles ou desative a tarifa em vez de excluir.`,
    });
  }

  await prisma.vtFare.delete({ where: { id: existing.id } });
  await auditLog({
    userId: user.id, action: "DELETE_VT_FARE", entity: "VtFare", entityId: existing.id,
    previousValue: existing, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ ok: true });
});
