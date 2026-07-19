import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";

export const employeeRouter = Router();

// ─── validação CPF ────────────────────────────────────────────────────────────
function validateCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
}

// ─── enums permitidos (validação de entrada) ───────────────────────────────────
const MODALITIES = ["CLT", "NAO_CLT"] as const;
const REGIMES = ["SEIS_POR_UM", "CINCO_POR_DOIS"] as const;
const VT_TYPES = ["NENHUM", "TRANSPORTE_PUBLICO", "AUXILIO_COMBUSTIVEL"] as const;
const VT_PERIODICITIES = ["QUINZENAL", "MENSAL"] as const;
const VT_COMMUTES = ["ONIBUS", "METRO", "INTEGRADO", "ONIBUS_METRO_SEPARADO"] as const;
const ACCOUNT_TYPES = ["CONTA_CORRENTE", "POUPANCA", "CAIXA", "CARTEIRA", "CARTAO", "OUTROS"] as const;

function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number];
function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: null): T[number] | null;
function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number] | null): T[number] | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

// ─── coerção de campos ──────────────────────────────────────────────────────────
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function dateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}
function digits(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d === "" ? null : d;
}

// Campos do cadastro compartilhados por create e update (sem id/auditoria).
function buildEmployeeData(b: Record<string, unknown>) {
  return {
    firstName: str(b.firstName)!,
    lastName: str(b.lastName)!,
    rg: str(b.rg),
    pis: digits(b.pis),
    birthDate: dateOrNull(b.birthDate),
    phone: str(b.phone),
    email: str(b.email),
    zipCode: str(b.zipCode),
    address: str(b.address),
    addressNumber: str(b.addressNumber),
    addressComplement: str(b.addressComplement),
    neighborhood: str(b.neighborhood),
    city: str(b.city),
    state: str(b.state)?.toUpperCase().slice(0, 2) ?? null,
    bankName: str(b.bankName),
    bankAgency: str(b.bankAgency),
    bankAccount: str(b.bankAccount),
    bankAccountDigit: str(b.bankAccountDigit),
    bankAccountType: oneOf(ACCOUNT_TYPES, b.bankAccountType, "CONTA_CORRENTE"),
    pixKeyType: str(b.pixKeyType),
    pixKey: str(b.pixKey),
    sector: str(b.sector),
    position: str(b.position),
    baseSalary: numOrNull(b.baseSalary),
    shiftStart: str(b.shiftStart),
    shiftEnd: str(b.shiftEnd),
    modality: oneOf(MODALITIES, b.modality, "CLT"),
    scheduleRegime: oneOf(REGIMES, b.scheduleRegime, "SEIS_POR_UM"),
    includeInSchedule: b.includeInSchedule === undefined ? true : Boolean(b.includeInSchedule),
    admissionDate: dateOrNull(b.admissionDate),
    vtType: oneOf(VT_TYPES, b.vtType, "TRANSPORTE_PUBLICO"),
    vtPeriodicity: oneOf(VT_PERIODICITIES, b.vtPeriodicity, "QUINZENAL"),
    vtCommute: oneOf(VT_COMMUTES, b.vtCommute, null),
    vtTripsPerDay: intOrNull(b.vtTripsPerDay) ?? 2,
    vtFixedAmount: numOrNull(b.vtFixedAmount),
    notes: str(b.notes),
  };
}

// ─── LIST ──────────────────────────────────────────────────────────────────────
employeeRouter.get("/", async (request, response) => {
  const search = str(request.query.search);
  const sector = str(request.query.sector);
  const includeInactive = request.query.includeInactive === "true";

  const where: Prisma.EmployeeWhereInput = { deletedAt: null };
  if (!includeInactive) where.isActive = true;
  if (sector) where.sector = sector;
  if (search) {
    const cpfDigits = search.replace(/\D/g, "");
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { position: { contains: search, mode: "insensitive" } },
      ...(cpfDigits ? [{ cpf: { contains: cpfDigits } }] : []),
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  response.json(employees);
});

// ─── ANIVERSARIANTES ────────────────────────────────────────────────────────────
// Registrada antes de "/:id" para não ser capturada como id.
employeeRouter.get("/birthdays", async (request, response) => {
  const month = intOrNull(request.query.month) ?? new Date().getMonth() + 1;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, "firstName", "lastName", "birthDate", sector, position
    FROM "Employee"
    WHERE "deletedAt" IS NULL AND "isActive" = true AND "birthDate" IS NOT NULL
      AND EXTRACT(MONTH FROM "birthDate") = ${month}
    ORDER BY EXTRACT(DAY FROM "birthDate") ASC, "firstName" ASC
  `;
  response.json(rows);
});

// ─── OPÇÕES (setores e cargos já usados — para combobox "escolha ou crie") ────────
// Registrada antes de "/:id" para não ser capturada como id.
employeeRouter.get("/options", async (_request, response) => {
  const rows = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { sector: true, position: true },
  });
  const clean = (values: Array<string | null>) =>
    Array.from(new Set(values.map((v) => (v ?? "").trim()).filter((v) => v !== ""))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  response.json({
    sectors: clean(rows.map((r) => r.sector)),
    positions: clean(rows.map((r) => r.position)),
  });
});

// ─── GET ONE ─────────────────────────────────────────────────────────────────────
employeeRouter.get("/:id", async (request, response) => {
  const employee = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!employee) return response.status(404).json({ message: "Funcionário não encontrado." });
  return response.json(employee);
});

// ─── CREATE ───────────────────────────────────────────────────────────────────────
employeeRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as Record<string, unknown>;
  const firstName = str(b.firstName);
  const lastName = str(b.lastName);
  const cpfRaw = str(b.cpf);

  if (!firstName) return response.status(400).json({ message: "Nome é obrigatório." });
  if (!lastName) return response.status(400).json({ message: "Sobrenome é obrigatório." });
  if (!cpfRaw) return response.status(400).json({ message: "CPF é obrigatório." });

  const cpf = cpfRaw.replace(/\D/g, "");
  if (!validateCpf(cpf)) return response.status(400).json({ message: "CPF inválido." });

  const existing = await prisma.employee.findFirst({ where: { cpf, deletedAt: null } });
  if (existing) return response.status(400).json({ message: "Já existe um funcionário com este CPF." });

  const created = await prisma.employee.create({
    data: {
      id: crypto.randomUUID(),
      cpf,
      ...buildEmployeeData(b),
      isActive: true,
      createdById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE_EMPLOYEE",
    entity: "Employee",
    entityId: created.id,
    newValue: created,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.status(201).json(created);
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────────
employeeRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const b = request.body as Record<string, unknown>;
  const firstName = str(b.firstName);
  const lastName = str(b.lastName);
  const cpfRaw = str(b.cpf);

  if (!firstName) return response.status(400).json({ message: "Nome é obrigatório." });
  if (!lastName) return response.status(400).json({ message: "Sobrenome é obrigatório." });
  if (!cpfRaw) return response.status(400).json({ message: "CPF é obrigatório." });

  const cpf = cpfRaw.replace(/\D/g, "");
  if (!validateCpf(cpf)) return response.status(400).json({ message: "CPF inválido." });

  const cpfConflict = await prisma.employee.findFirst({
    where: { cpf, deletedAt: null, id: { not: request.params.id } },
  });
  if (cpfConflict) return response.status(400).json({ message: "CPF já está em uso por outro funcionário." });

  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: {
      cpf,
      ...buildEmployeeData(b),
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── TOGGLE STATUS (ativar / inativar sem desligamento formal) ────────────────────
employeeRouter.patch("/:id/status", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const isActive = Boolean((request.body as { isActive?: unknown }).isActive);
  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: isActive
      ? { isActive: true, terminationDate: null, terminationReason: null, updatedById: user.id }
      : { isActive: false, updatedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: isActive ? "REACTIVATE_EMPLOYEE" : "INACTIVATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── DESLIGAMENTO ─────────────────────────────────────────────────────────────────
employeeRouter.patch("/:id/terminate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const b = request.body as Record<string, unknown>;
  const terminationDate = dateOrNull(b.terminationDate) ?? new Date();
  const terminationReason = str(b.terminationReason);

  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: { terminationDate, terminationReason, isActive: false, updatedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: "TERMINATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── SALDO DE FOLGA POR FERIADO (banco de folgas) ─────────────────────────────────
// Ajusta o saldo (delta +/-). Feriado trabalhado gera folga a mais; ao tirar a
// folga, debita. Nunca fica negativo.
employeeRouter.patch("/:id/holiday-comp", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const delta = intOrNull((request.body as { delta?: unknown }).delta) ?? 0;
  const newBalance = Math.max(0, existing.holidayCompBalance + delta);

  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: { holidayCompBalance: newBalance, updatedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "ADJUST_HOLIDAY_COMP", entity: "Employee", entityId: updated.id,
    previousValue: { holidayCompBalance: existing.holidayCompBalance },
    newValue: { holidayCompBalance: newBalance },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, holidayCompBalance: updated.holidayCompBalance });
});

// ─── RESTAURAR (desfazer exclusão) ──────────────────────────────────────────────
// Volta o funcionário como INATIVO (deletedAt limpo). Reative com "Reativar".
employeeRouter.patch("/:id/restore", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: { not: null } } });
  if (!existing) return response.status(404).json({ message: "Funcionário excluído não encontrado (talvez já restaurado)." });

  const updated = await prisma.employee.update({
    where: { id: existing.id },
    data: { deletedAt: null, deletedById: null, updatedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "RESTORE_EMPLOYEE", entity: "Employee", entityId: updated.id,
    newValue: { restored: true }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, isActive: updated.isActive });
});

// ─── DELETE (soft) ────────────────────────────────────────────────────────────────
employeeRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const reason = String((request.body as { reason?: unknown })?.reason ?? "").trim();
  if (reason.length < 3) return response.status(400).json({ message: "Informe a justificativa da exclusão (mín. 3 caracteres)." });

  await prisma.employee.update({
    where: { id: request.params.id },
    data: { deletedAt: new Date(), deletedById: user.id, isActive: false },
  });

  await auditLog({
    userId: user.id,
    action: "DELETE_EMPLOYEE",
    entity: "Employee",
    entityId: request.params.id,
    previousValue: existing,
    newValue: { reason },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ ok: true });
});
