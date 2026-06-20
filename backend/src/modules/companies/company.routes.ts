import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";

export const companyRouter = Router();

function validateCnpj(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;

  let sum = 0;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) sum += parseInt(clean[i]) * w1[i];
  const d1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  sum = 0;
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 13; i++) sum += parseInt(clean[i]) * w2[i];
  const d2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  return parseInt(clean[12]) === d1 && parseInt(clean[13]) === d2;
}

function formatCnpj(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "");
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

async function nextCompanyCode(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM "Company" WHERE code ~ '^EMP-[0-9]+$' ORDER BY LENGTH(code) DESC, code DESC LIMIT 1
  `;
  if (rows.length === 0) return "EMP-001";
  const lastNum = parseInt(rows[0].code.replace("EMP-", ""), 10);
  return `EMP-${String(lastNum + 1).padStart(3, "0")}`;
}

// ─── LIST COMPANIES ───────────────────────────────────────────────────────────
companyRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const search = request.query.search ? String(request.query.search) : undefined;
  const includeInactive = request.query.includeInactive === "true";

  const companies = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      c.id, c.code, c."tradeName", c."legalName", c.cnpj,
      c."stateRegistration", c."municipalRegistration",
      c."financialEmail", c.phone,
      c."zipCode", c.address, c."addressNumber", c."addressComplement",
      c.neighborhood, c.city, c.state,
      c.notes, c."isActive", c."createdAt", c."updatedAt",
      COUNT(ba.id) FILTER (WHERE ba."isActive") AS "activeBankAccountCount"
    FROM "Company" c
    LEFT JOIN "CompanyBankAccount" ba ON ba."companyId" = c.id
    WHERE
      (${includeInactive} OR c."isActive" = true)
      AND (
        ${search ?? null} IS NULL
        OR c."tradeName" ILIKE ${"%" + (search ?? "") + "%"}
        OR c."legalName"  ILIKE ${"%" + (search ?? "") + "%"}
        OR c.cnpj         ILIKE ${"%" + (search ?? "") + "%"}
        OR c.code         ILIKE ${"%" + (search ?? "") + "%"}
      )
    GROUP BY c.id
    ORDER BY c."isActive" DESC, c."tradeName" ASC
  `;

  response.json(companies);
});

// ─── ALL ACTIVE BANK ACCOUNTS (for dropdowns) ─────────────────────────────────
// MUST be registered before /:id to avoid Express matching "bank-accounts" as an id param
companyRouter.get("/bank-accounts/all", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const companyId = request.query.companyId ? String(request.query.companyId) : undefined;
  const accounts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT ba.*, c."tradeName" AS "companyTradeName", c.code AS "companyCode"
    FROM "CompanyBankAccount" ba
    JOIN "Company" c ON c.id = ba."companyId"
    WHERE ba."isActive" = true
      AND c."isActive" = true
      AND (${companyId ?? null} IS NULL OR ba."companyId" = ${companyId ?? null})
    ORDER BY c."tradeName" ASC, ba.name ASC
  `;
  response.json(accounts);
});

// ─── GET ONE COMPANY ──────────────────────────────────────────────────────────
companyRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${request.params.id}
  `;
  if (rows.length === 0) return void response.status(404).json({ message: "Empresa não encontrada." });
  response.json(rows[0]);
});

// ─── CREATE COMPANY ───────────────────────────────────────────────────────────
companyRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const {
    code: rawCode, tradeName, legalName, cnpj: rawCnpj,
    stateRegistration, municipalRegistration, financialEmail, phone,
    zipCode, address, addressNumber, addressComplement, neighborhood, city, state, notes
  } = request.body as Record<string, string | undefined>;

  if (!tradeName?.trim()) return void response.status(400).json({ message: "Nome fantasia é obrigatório." });
  if (!legalName?.trim()) return void response.status(400).json({ message: "Razão social é obrigatória." });
  if (!rawCnpj?.trim()) return void response.status(400).json({ message: "CNPJ é obrigatório." });

  const cnpjClean = rawCnpj.replace(/\D/g, "");
  if (!validateCnpj(cnpjClean)) return void response.status(400).json({ message: "CNPJ inválido." });
  const cnpj = formatCnpj(cnpjClean);

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Company" WHERE cnpj = ${cnpj}
  `;
  if (existing.length > 0) return void response.status(400).json({ message: "Já existe uma empresa com este CNPJ." });

  const code = rawCode?.trim() || await nextCompanyCode();
  const codeConflict = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Company" WHERE code = ${code}
  `;
  if (codeConflict.length > 0) return void response.status(400).json({ message: "Código já está em uso." });

  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "Company" (
      id, code, "tradeName", "legalName", cnpj,
      "stateRegistration", "municipalRegistration", "financialEmail", phone,
      "zipCode", address, "addressNumber", "addressComplement", neighborhood, city, state,
      notes, "isActive", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${code}, ${tradeName.trim()}, ${legalName.trim()}, ${cnpj},
      ${stateRegistration ?? null}, ${municipalRegistration ?? null}, ${financialEmail ?? null}, ${phone ?? null},
      ${zipCode ?? null}, ${address ?? null}, ${addressNumber ?? null}, ${addressComplement ?? null},
      ${neighborhood ?? null}, ${city ?? null}, ${state ?? null},
      ${notes ?? null}, true, ${now}, ${now}
    )
  `;

  const created = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${id}
  `)[0];

  await auditLog({
    userId: user.id, action: "CREATE_COMPANY", entity: "Company", entityId: id,
    newValue: created, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(201).json(created);
});

// ─── UPDATE COMPANY ───────────────────────────────────────────────────────────
companyRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const before = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${request.params.id}
  `)[0];
  if (!before) return void response.status(404).json({ message: "Empresa não encontrada." });

  const {
    tradeName, legalName, cnpj: rawCnpj,
    stateRegistration, municipalRegistration, financialEmail, phone,
    zipCode, address, addressNumber, addressComplement, neighborhood, city, state, notes
  } = request.body as Record<string, string | undefined>;

  if (!tradeName?.trim()) return void response.status(400).json({ message: "Nome fantasia é obrigatório." });
  if (!legalName?.trim()) return void response.status(400).json({ message: "Razão social é obrigatória." });
  if (!rawCnpj?.trim()) return void response.status(400).json({ message: "CNPJ é obrigatório." });

  const cnpjClean = rawCnpj.replace(/\D/g, "");
  if (!validateCnpj(cnpjClean)) return void response.status(400).json({ message: "CNPJ inválido." });
  const cnpj = formatCnpj(cnpjClean);

  const cnpjConflict = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Company" WHERE cnpj = ${cnpj} AND id != ${request.params.id}
  `;
  if (cnpjConflict.length > 0) return void response.status(400).json({ message: "CNPJ já está em uso por outra empresa." });

  await prisma.$executeRaw`
    UPDATE "Company" SET
      "tradeName" = ${tradeName.trim()},
      "legalName" = ${legalName.trim()},
      cnpj = ${cnpj},
      "stateRegistration" = ${stateRegistration ?? null},
      "municipalRegistration" = ${municipalRegistration ?? null},
      "financialEmail" = ${financialEmail ?? null},
      phone = ${phone ?? null},
      "zipCode" = ${zipCode ?? null},
      address = ${address ?? null},
      "addressNumber" = ${addressNumber ?? null},
      "addressComplement" = ${addressComplement ?? null},
      neighborhood = ${neighborhood ?? null},
      city = ${city ?? null},
      state = ${state ?? null},
      notes = ${notes ?? null},
      "updatedAt" = NOW()
    WHERE id = ${request.params.id}
  `;

  const after = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${request.params.id}
  `)[0];

  await auditLog({
    userId: user.id, action: "UPDATE_COMPANY", entity: "Company", entityId: request.params.id,
    previousValue: before, newValue: after, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(after);
});

// ─── TOGGLE STATUS ────────────────────────────────────────────────────────────
companyRouter.patch("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const before = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${request.params.id}
  `)[0];
  if (!before) return void response.status(404).json({ message: "Empresa não encontrada." });

  const { isActive } = request.body as { isActive: boolean };

  await prisma.$executeRaw`
    UPDATE "Company" SET "isActive" = ${Boolean(isActive)}, "updatedAt" = NOW()
    WHERE id = ${request.params.id}
  `;

  const after = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Company" WHERE id = ${request.params.id}
  `)[0];

  const action = Boolean(isActive) ? "REACTIVATE_COMPANY" : "INACTIVATE_COMPANY";
  await auditLog({
    userId: user.id, action, entity: "Company", entityId: request.params.id,
    previousValue: before, newValue: after, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(after);
});

// ─── LIST BANK ACCOUNTS ───────────────────────────────────────────────────────
companyRouter.get("/:id/bank-accounts", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const includeInactive = request.query.includeInactive === "true";
  const accounts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount"
    WHERE "companyId" = ${request.params.id}
      AND (${includeInactive} OR "isActive" = true)
    ORDER BY "isActive" DESC, name ASC
  `;
  response.json(accounts);
});

// ─── CREATE BANK ACCOUNT ──────────────────────────────────────────────────────
companyRouter.post("/:id/bank-accounts", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const company = (await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Company" WHERE id = ${request.params.id}
  `)[0];
  if (!company) return void response.status(404).json({ message: "Empresa não encontrada." });

  const {
    bankName, agency, account, accountDigit, accountType,
    pixKey, name, notes
  } = request.body as Record<string, string | undefined>;

  if (!name?.trim()) return void response.status(400).json({ message: "Nome/descrição da conta é obrigatório." });

  const validTypes = ["CONTA_CORRENTE", "POUPANCA", "CAIXA", "CARTEIRA", "CARTAO", "OUTROS"];
  const resolvedType = accountType && validTypes.includes(accountType) ? accountType : "CONTA_CORRENTE";

  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "CompanyBankAccount" (
      id, "companyId", "bankName", agency, account, "accountDigit",
      "accountType", "pixKey", name, notes, "isActive", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${request.params.id}, ${bankName ?? null}, ${agency ?? null},
      ${account ?? null}, ${accountDigit ?? null},
      ${resolvedType}::"BankAccountType", ${pixKey ?? null},
      ${name.trim()}, ${notes ?? null}, true, ${now}, ${now}
    )
  `;

  const created = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount" WHERE id = ${id}
  `)[0];

  await auditLog({
    userId: user.id, action: "CREATE_BANK_ACCOUNT", entity: "CompanyBankAccount", entityId: id,
    newValue: created, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(201).json(created);
});

// ─── UPDATE BANK ACCOUNT ──────────────────────────────────────────────────────
companyRouter.put("/:id/bank-accounts/:accountId", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const before = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount" WHERE id = ${request.params.accountId} AND "companyId" = ${request.params.id}
  `)[0];
  if (!before) return void response.status(404).json({ message: "Conta bancária não encontrada." });

  const {
    bankName, agency, account, accountDigit, accountType,
    pixKey, name, notes
  } = request.body as Record<string, string | undefined>;

  if (!name?.trim()) return void response.status(400).json({ message: "Nome/descrição da conta é obrigatório." });

  const validTypes = ["CONTA_CORRENTE", "POUPANCA", "CAIXA", "CARTEIRA", "CARTAO", "OUTROS"];
  const resolvedType = accountType && validTypes.includes(accountType) ? accountType : "CONTA_CORRENTE";

  await prisma.$executeRaw`
    UPDATE "CompanyBankAccount" SET
      "bankName" = ${bankName ?? null},
      agency = ${agency ?? null},
      account = ${account ?? null},
      "accountDigit" = ${accountDigit ?? null},
      "accountType" = ${resolvedType}::"BankAccountType",
      "pixKey" = ${pixKey ?? null},
      name = ${name.trim()},
      notes = ${notes ?? null},
      "updatedAt" = NOW()
    WHERE id = ${request.params.accountId}
  `;

  const after = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount" WHERE id = ${request.params.accountId}
  `)[0];

  await auditLog({
    userId: user.id, action: "UPDATE_BANK_ACCOUNT", entity: "CompanyBankAccount", entityId: request.params.accountId,
    previousValue: before, newValue: after, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(after);
});

// ─── TOGGLE BANK ACCOUNT STATUS ───────────────────────────────────────────────
companyRouter.patch("/:id/bank-accounts/:accountId/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const before = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount" WHERE id = ${request.params.accountId} AND "companyId" = ${request.params.id}
  `)[0];
  if (!before) return void response.status(404).json({ message: "Conta bancária não encontrada." });

  const { isActive } = request.body as { isActive: boolean };

  await prisma.$executeRaw`
    UPDATE "CompanyBankAccount" SET "isActive" = ${Boolean(isActive)}, "updatedAt" = NOW()
    WHERE id = ${request.params.accountId}
  `;

  const after = (await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "CompanyBankAccount" WHERE id = ${request.params.accountId}
  `)[0];

  const action = Boolean(isActive) ? "REACTIVATE_BANK_ACCOUNT" : "INACTIVATE_BANK_ACCOUNT";
  await auditLog({
    userId: user.id, action, entity: "CompanyBankAccount", entityId: request.params.accountId,
    previousValue: before, newValue: after, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(after);
});
