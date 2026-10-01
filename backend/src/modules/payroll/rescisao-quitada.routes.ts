// RH → Rescisões: registrar a rescisão "quitada no termo" (CLT, termo com líquido zero).
// POST /payroll/rescisoes/:employeeId/termo-sem-valor  { fileBase64, fileName, aplicar }
//   aplicar=false → prévia (nada é gravado); aplicar=true → cria a rescisão de R$ 0,00 paga.
// Montado sob /payroll/rescisoes: mesma permissão de lançar rescisão (módulo payroll).
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { RESCISAO_CATEGORY } from "./payroll.service.js";
import { pdfDoCorpo } from "./pdf-corpo.js";
import { avaliarTermoSemValor } from "./rescisao-quitada.js";
import { RecusaRescisao, travarRescisao } from "./rescisao-trava.js";
import { extrairTextoPdf } from "./rh-extract.service.js";
import { lerTextoRescisao, type ReciboRescisao } from "./tip-trct.service.js";

export const rescisaoQuitadaRouter = Router();

const RESCISAO_VIVA = { type: "RESCISAO" as const, deletedAt: null, status: { not: "CANCELED" as const } };
const MSG_JA_LANCADA = "Rescisão já lançada para este funcionário.";
const diaUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const nomeArquivo = (v: unknown) => String(v ?? "rescisao.pdf").replace(/[^\p{L}\p{N}.\-() _]/gu, "_").slice(0, 120);

async function lerTermo(fileBase64: unknown): Promise<{ recibo: ReciboRescisao; hash: string } | { status: number; message: string }> {
  const pdf = pdfDoCorpo(fileBase64, { artigo: "do", nome: "termo de rescisão", umNome: "um termo de rescisão" });
  if (!("buffer" in pdf)) return pdf;
  let texto: string;
  try {
    texto = await extrairTextoPdf(pdf.buffer);
  } catch (err) {
    return { status: 422, message: `Não foi possível ler o PDF do termo. ${(err as Error).message}` };
  }
  if (!/RESCIS[ÃA]O/i.test(texto)) return { status: 422, message: "O arquivo não parece um termo de rescisão." };
  return { recibo: lerTextoRescisao(texto), hash: crypto.createHash("sha256").update(pdf.buffer).digest("hex") };
}

// Trava de período: a competência (mês da saída) e o mês do pagamento.
async function periodoTravado(datas: Date[]): Promise<string | null> {
  try {
    for (const d of datas) await assertPeriodWritableForDate(d, "Rescisao quitada no termo");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Periodo fechado.";
  }
}

rescisaoQuitadaRouter.post("/:employeeId/termo-sem-valor", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as { fileBase64?: unknown; fileName?: unknown; aplicar?: unknown };

  const emp = await prisma.employee.findFirst({
    where: { id: request.params.employeeId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, cpf: true, modality: true, terminationDate: true },
  });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const lido = await lerTermo(b.fileBase64);
  if ("status" in lido) return response.status(lido.status).json({ message: lido.message });
  const { recibo, hash } = lido;

  const viva = await prisma.payrollItem.findFirst({ where: { ...RESCISAO_VIVA, employeeId: emp.id }, select: { id: true } });
  const avaliacao = avaliarTermoSemValor(recibo, emp, { rescisaoViva: viva != null });
  // Termo de outra pessoa: nem mostra a prévia.
  if (!avaliacao.casadoPor) return response.status(422).json({ message: avaliacao.recusa });

  const arquivo = nomeArquivo(b.fileName);
  const nome = `${emp.firstName} ${emp.lastName}`.trim();
  const previa = {
    employeeId: emp.id, nome, nomeNoTermo: recibo.nome, arquivo, hash,
    admissao: recibo.admissao, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    liquido: recibo.liquido, totalBruto: recibo.totalBruto, gorjeta: recibo.gorjeta,
    divergencias: avaliacao.divergencias,
    podeQuitar: avaliacao.recusa == null,
    recusa: avaliacao.recusa,
  };
  if (b.aplicar !== true) return response.json({ previa, aplicado: false });
  if (avaliacao.recusa) return response.status(viva ? 400 : 422).json({ message: avaliacao.recusa });

  const saida = emp.terminationDate!;
  const competencia = new Date(Date.UTC(saida.getUTCFullYear(), saida.getUTCMonth(), 1));
  const pagamento = diaUtc(recibo.pagamento ?? recibo.afastamento ?? saida.toISOString().slice(0, 10));
  const travado = await periodoTravado([competencia, pagamento]);
  if (travado) return response.status(400).json({ message: travado });

  const dre = await prisma.dRECategory.findFirst({ where: { name: RESCISAO_CATEGORY } });
  const em = new Date().toISOString();
  const termo = {
    arquivo, hash, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    admissao: recibo.admissao, totalBruto: recibo.totalBruto, gorjeta: recibo.gorjeta, liquido: 0,
  };
  const id = crypto.randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      await travarRescisao(tx, emp.id);
      const outra = await tx.payrollItem.findFirst({ where: { ...RESCISAO_VIVA, employeeId: emp.id }, select: { id: true } });
      if (outra) throw new RecusaRescisao(400, MSG_JA_LANCADA);
      await tx.payrollItem.create({
        data: {
          id,
          employeeId: emp.id,
          type: "RESCISAO",
          competenceYear: saida.getUTCFullYear(),
          competenceMonth: saida.getUTCMonth() + 1,
          periodLabel: "Rescisão (quitada no termo)",
          dueDate: pagamento,
          amount: 0,
          paymentDate: pagamento,
          paidAmount: 0,
          status: "PAID",
          dreCategoryId: dre?.id ?? null,
          source: "MANUAL",
          notes: "Termo de rescisão com líquido zero: nada a pagar.",
          details: {
            grupoRescisao: crypto.randomUUID(),
            quitadaNoTermo: true,
            gorjetaNaApuracao: null,
            termo,
            registradoPor: { userId: user.id, nome: user.name ?? null },
            em,
          },
          createdById: user.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof RecusaRescisao) return response.status(err.status).json({ message: err.message });
    throw err;
  }

  await auditLog({
    userId: user.id, action: "RELEASE_TERMINATION", entity: "PayrollItem", entityId: id,
    newValue: { employeeId: emp.id, quitadaNoTermo: true, net: 0, installments: 1, termo },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json({
    previa,
    aplicado: true,
    item: { id, competencia: `${String(saida.getUTCMonth() + 1).padStart(2, "0")}/${saida.getUTCFullYear()}`, pagamento: pagamento.toISOString().slice(0, 10) },
  });
});
