// Rota do recibo da rescisão (TRCT) que volta da contabilidade.
// Montado em tip-commission.routes.ts (mesmo prefixo /payroll/tip).

import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { lerPdfRescisao } from "./tip-trct.service.js";
import { nomeCompleto } from "./nomes.js";
import { barrouPorFechamento, participantesTravadosPelaRescisao, calcularParaTela } from "./tip-routes-comum.js";

export const tipRescisaoReciboRouter = Router();
const router = tipRescisaoReciboRouter;

// ─── Recibo da rescisão (TRCT) que volta da contabilidade ───────────────────
// Lê o PDF, casa com o funcionário pelo CPF (sem gravar o CPF) e, com aplicar=true,
// grava a gorjeta paga como valor quitado da rescisão no período da saída.
router.post("/periods/:year/:month/rescisao-recibo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  const b = request.body as { fileBase64?: unknown; fileName?: unknown; aplicar?: unknown };
  if (typeof b.fileBase64 !== "string" || !b.fileBase64) return response.status(400).json({ message: "Envie o PDF da rescisão." });
  const arquivo = String(b.fileName ?? "rescisao.pdf").replace(/[^\p{L}\p{N}.\-() _]/gu, "_").slice(0, 120);

  const pdf = Buffer.from(b.fileBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (pdf.length > 5 * 1024 * 1024) return response.status(413).json({ message: "Arquivo grande demais para um termo de rescisão (máximo 5 MB)." });
  let lido;
  try {
    lido = await lerPdfRescisao(pdf);
  } catch (err) {
    return response.status(422).json({ message: "Não foi possível ler o PDF da rescisão. " + (err as Error).message });
  }
  const { recibo, hash } = lido;
  if (!recibo.cpfDigitos) return response.status(422).json({ message: "Não achei o CPF no termo de rescisão para saber de quem é." });
  const candidatos = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, cpf: true, firstName: true, lastName: true, displayName: true, admissionDate: true, terminationDate: true },
  });
  // Casa pelo CPF; se não achar, pelo nome completo (único) — e avisa, para o cadastro ser conferido.
  const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  let emp = candidatos.find((e) => (e.cpf ?? "").replace(/\D/g, "") === recibo.cpfDigitos);
  let casadoPeloNome = false;
  if (!emp && recibo.nome) {
    const nomeTermo = semAcento(recibo.nome);
    const mesmos = candidatos.filter((e) => semAcento(`${e.firstName} ${e.lastName}`) === nomeTermo);
    if (mesmos.length === 1) { emp = mesmos[0]; casadoPeloNome = true; }
  }
  if (!emp) {
    return response.status(422).json({ message: `Não achei no cadastro de funcionários de quem é o termo (${recibo.nome ?? "nome não lido"}): nem pelo CPF, nem pelo nome completo.` });
  }
  const nome = nomeCompleto(emp);

  const periodo = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
  if (!periodo) return response.status(404).json({ message: "Período não encontrado." });
  const participante = await prisma.tipParticipant.findUnique({ where: { periodId_employeeId: { periodId: periodo.id, employeeId: emp.id } } });

  const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const br = (isoDia: string | null) => (isoDia ? isoDia.split("-").reverse().join("/") : "vazia");
  const divergencias: string[] = [];
  if (casadoPeloNome) divergencias.push("O CPF do termo é diferente do CPF no cadastro: reconhecido pelo nome completo. Confira o cadastro.");
  if (recibo.gorjeta == null) divergencias.push("O termo não tem a rubrica de gorjeta.");
  if (recibo.afastamento && dia(emp.terminationDate) !== recibo.afastamento) {
    divergencias.push(`Saída no cadastro: ${br(dia(emp.terminationDate))} × termo: ${br(recibo.afastamento)}.`);
  }
  if (recibo.admissao && dia(emp.admissionDate) !== recibo.admissao) {
    divergencias.push(`Admissão no cadastro: ${br(dia(emp.admissionDate))} × termo: ${br(recibo.admissao)}.`);
  }
  if (recibo.afastamento && (recibo.afastamento < dia(periodo.periodStart)! || recibo.afastamento > dia(periodo.periodEnd)!)) {
    divergencias.push(`A saída (${br(recibo.afastamento)}) não cai neste período (${periodo.label}).`);
  }
  if (!participante) divergencias.push(`${nome} não está na apuração deste período.`);
  if (participante?.rescisaoValorFixo != null && recibo.gorjeta != null && Number(participante.rescisaoValorFixo) !== recibo.gorjeta) {
    divergencias.push(`Valor quitado digitado antes: ${Number(participante.rescisaoValorFixo).toFixed(2)} (será trocado pelo do termo).`);
  }

  const previa = {
    employeeId: emp.id, nome, arquivo, hash,
    gorjeta: recibo.gorjeta, liquido: recibo.liquido,
    admissao: recibo.admissao, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    divergencias,
  };
  if (b.aplicar !== true) return response.json({ previa, aplicado: false });

  if (!participante || recibo.gorjeta == null) {
    return response.status(422).json({ message: participante ? "O termo não tem a rubrica de gorjeta." : `${nome} não está na apuração deste período.` });
  }
  if (await barrouPorFechamento(periodo.id, response, "Lançar o recibo da rescisão")) return;
  if ((await participantesTravadosPelaRescisao([participante.employeeId])).has(participante.id)) {
    return response.status(409).json({ message: "A gorjeta paga desta pessoa veio da rescisão lançada: ajuste pela rescisão (RH → Rescisões)." });
  }
  const gravado = {
    fonte: "TRCT", arquivo, hash, gorjeta: recibo.gorjeta, liquido: recibo.liquido,
    admissao: recibo.admissao, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    importadoEm: new Date().toISOString(), importadoPor: user.name,
  };
  await prisma.tipParticipant.update({
    where: { id: participante.id },
    data: { rescisaoValorFixo: recibo.gorjeta, rescisaoRecibo: gravado },
  });
  await auditLog({
    userId: user.id, action: "TIP_RESCISAO_RECIBO", entity: "TipParticipant", entityId: participante.id,
    previousValue: { rescisaoValorFixo: participante.rescisaoValorFixo == null ? null : Number(participante.rescisaoValorFixo) },
    newValue: { employeeId: emp.id, ...gravado },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  const computation = await calcularParaTela(year, month, request);
  response.json({ previa, aplicado: true, computation });
});

