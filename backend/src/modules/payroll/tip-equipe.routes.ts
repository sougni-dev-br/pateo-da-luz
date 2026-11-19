// Rotas da equipe da gorjeta (pontos, cota fixa, quem participa).
// Montado em tip-commission.routes.ts (mesmo prefixo /payroll/tip).

import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { registrarAlteracoes } from "./cadastro-historico.service.js";
import { mudouSituacao, registrarHistorico } from "./tip-historico.service.js";
import { parseDateUTC, numOrNull, textoOuNull, hojeSaoPaulo } from "./tip-routes-comum.js";

export const tipEquipeRouter = Router();
const router = tipEquipeRouter;

// ─── Equipe da gorjeta ──────────────────────────────────────────────────────
// Só os campos da gorjeta (sem CPF, salário ou dados bancários), para quem opera
// a gorjeta não precisar da permissão de Funcionários.
router.get("/team", async (_request, response) => {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, isActive: true,
      sector: true, position: true, modality: true, admissionDate: true, terminationDate: true,
      companyId: true, participaGorjeta: true, inicioGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  response.json(employees.map((e) => ({
    ...e,
    cotaFixaGorjeta: e.cotaFixaGorjeta == null ? null : Number(e.cotaFixaGorjeta),
    pontosExtra: e.pontosExtra == null ? null : Number(e.pontosExtra),
  })));
});

router.put("/team/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const antes = await prisma.employee.findFirst({
    where: { id: request.params.employeeId, deletedAt: null },
    select: {
      id: true, companyId: true, participaGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
  });
  if (!antes) return response.status(404).json({ message: "Funcionário não encontrado." });

  const tipFunctionId = b.tipFunctionId ? String(b.tipFunctionId) : null;
  if (tipFunctionId && !(await prisma.tipFunction.findUnique({ where: { id: tipFunctionId } }))) {
    return response.status(422).json({ message: "Função não encontrada." });
  }
  const companyId = b.companyId ? String(b.companyId) : null;
  if (companyId && !(await prisma.company.findUnique({ where: { id: companyId } }))) {
    return response.status(422).json({ message: "Empresa não encontrada." });
  }
  // Ponto extra: soma (ou tira) dos pontos da função, sempre com justificativa.
  const extraBruto = numOrNull(b.pontosExtra);
  const extra = extraBruto == null || Math.abs(extraBruto) < 0.005 ? null : Math.round(extraBruto * 100) / 100;
  const motivoExtra = extra == null ? null : textoOuNull(b.pontosExtraMotivo);
  if (extra != null && (!motivoExtra || motivoExtra.length < 5)) {
    return response.status(422).json({ message: "Informe a justificativa do ponto extra (pelo menos 5 caracteres)." });
  }
  if (extra != null && Math.abs(extra) > 100) return response.status(422).json({ message: "Ponto extra fora do limite (±100)." });
  const pontosFuncao = tipFunctionId ? Number((await prisma.tipFunction.findUnique({ where: { id: tipFunctionId } }))?.points ?? 0) : 0;
  if (extra != null && pontosFuncao + extra < 0) {
    return response.status(422).json({ message: `O extra deixaria a pessoa com pontos negativos (função ${pontosFuncao}, extra ${extra}).` });
  }

  const tipoGorjeta = b.tipoGorjeta === "FIXO" ? "FIXO" : "PONTOS";
  const participa = Boolean(b.participaGorjeta);
  // Função, pontos e participação ficam no histórico, com a data a partir da qual valem.
  const registrar = mudouSituacao(
    { participaGorjeta: antes.participaGorjeta, tipFunctionId: antes.tipFunctionId, pontosExtra: antes.pontosExtra == null ? null : Number(antes.pontosExtra), pontosExtraMotivo: antes.pontosExtraMotivo },
    { participaGorjeta: participa, tipFunctionId, pontosExtra: extra, pontosExtraMotivo: motivoExtra },
  );
  // A justificativa do extra só explica o histórico quando foi o extra que mudou.
  const extraMudou = (antes.pontosExtra == null ? null : Number(antes.pontosExtra)) !== extra || antes.pontosExtraMotivo !== motivoExtra;
  // Tirar o extra também explica no histórico o que saiu.
  const extraRetirado = extra == null && antes.pontosExtra != null
    ? `Ponto extra retirado (era ${Number(antes.pontosExtra) > 0 ? "+" : ""}${Number(antes.pontosExtra)}: ${antes.pontosExtraMotivo ?? "sem justificativa"})`
    : null;
  const vigencia = parseDateUTC(b.validFrom) ?? hojeSaoPaulo();
  const depois = await prisma.$transaction(async (tx) => {
    const atualizado = await tx.employee.update({
    where: { id: antes.id },
    data: {
      participaGorjeta: participa,
      tipFunctionId,
      pontosExtra: extra,
      pontosExtraMotivo: motivoExtra,
      companyId,
      tipoGorjeta,
      cotaFixaGorjeta: tipoGorjeta === "FIXO" ? (numOrNull(b.cotaFixaGorjeta) ?? 0) : null,
      updatedById: user.id,
    },
    select: {
      id: true, companyId: true, participaGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
    });
    if (registrar) await registrarHistorico(tx, antes.id, vigencia, user.id, textoOuNull(b.reason) ?? (extraMudou ? motivoExtra ?? extraRetirado : null));
    // Empresa também tem histórico no cadastro (a exportação à contabilidade agrupa por ela).
    await registrarAlteracoes(tx, {
      employeeId: antes.id, antes: { companyId: antes.companyId }, depois: { companyId }, vigenteDesde: vigencia,
      motivo: textoOuNull(b.reason), origem: "EQUIPE_GORJETA", usuario: { id: user.id, nome: user.name },
    });
    return atualizado;
  });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_TEAM_MEMBER", entity: "Employee", entityId: antes.id,
    previousValue: antes, newValue: depois,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Empresas para agrupar o envio à contabilidade (só id e nome).
router.get("/companies", async (_request, response) => {
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, tradeName: true },
    orderBy: { tradeName: "asc" },
  });
  response.json(companies);
});

