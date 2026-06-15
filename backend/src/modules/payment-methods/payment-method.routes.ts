import { PaymentMethodType, Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { isLegacyInstallmentPaymentMethodName } from "../../shared/utils/payment-methods.js";
import { requireRole } from "../security/security-utils.js";

export const paymentMethodRouter = Router();

function getType(value: unknown): PaymentMethodType {
  const normalized = normalizeText(value);

  if (normalized.includes("dinheiro")) return "CASH";
  if (normalized.includes("pix")) return "PIX";
  if (normalized.includes("credito")) return "CREDIT_CARD";
  if (normalized.includes("debito")) return "DEBIT_CARD";
  if (normalized.includes("boleto")) return "BANK_SLIP";
  if (normalized.includes("transfer")) return "TRANSFER";

  return "OTHER";
}

function getGroup(value: unknown): string {
  const normalized = normalizeText(value);

  if (normalized.includes("dinheiro")) return "dinheiro";
  if (normalized.includes("pix")) return "pix";
  if (normalized.includes("boleto")) return "boleto";
  if (normalized.includes("cartao")) return "cartao";
  if (normalized.includes("faturado")) return "faturado";

  return "outros";
}

paymentMethodRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.PaymentMethodWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { normalizedName: { contains: normalizeText(search), mode: "insensitive" } },
          { group: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};

  const methods = await prisma.paymentMethod.findMany({ where, orderBy: { name: "asc" } });
  response.json(methods);
});

paymentMethodRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (isLegacyInstallmentPaymentMethodName(name)) {
    response.status(400).json({ message: "Cadastre apenas o metodo base. O numero de parcelas deve ser informado no lancamento da compra." });
    return;
  }
  const method = await prisma.paymentMethod.create({
    data: {
      name,
      normalizedName: normalizeText(name),
      type: request.body.type || getType(name),
      group: request.body.group || getGroup(name),
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true
    }
  });

  response.status(201).json(method);
});

paymentMethodRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  const current = await prisma.paymentMethod.findUnique({ where: { id: request.params.id } });
  if (!current) {
    response.status(404).json({ message: "Metodo nao encontrado." });
    return;
  }
  if (!isLegacyInstallmentPaymentMethodName(current.name) && isLegacyInstallmentPaymentMethodName(name)) {
    response.status(400).json({ message: "Cadastre apenas o metodo base. O numero de parcelas deve ser informado no lancamento da compra." });
    return;
  }
  const method = await prisma.paymentMethod.update({
    where: { id: request.params.id },
    data: {
      name,
      normalizedName: normalizeText(name),
      type: request.body.type || getType(name),
      group: request.body.group || getGroup(name),
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true
    }
  });

  response.json(method);
});

paymentMethodRouter.patch("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const method = await prisma.paymentMethod.update({
    where: { id: request.params.id },
    data: { isActive: Boolean(request.body.isActive) }
  });

  response.json(method);
});
