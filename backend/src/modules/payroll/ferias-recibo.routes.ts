// RH → Férias: o "Aviso e Recibo de Férias" que a contabilidade devolve vira o título de pagamento.
// POST /payroll/ferias/recibo  { fileBase64, fileName, aplicar, employeeId? }
//   aplicar=false → prévia (nada é gravado); aplicar=true → cria o lançamento FERIAS (Contas a Pagar + DRE "Férias").
// O arquivo não é guardado: só os valores e a impressão digital (SHA-256), que impede importar o mesmo recibo duas vezes.
// Montado em /payroll/ferias: o controle de acesso resolve pelo prefixo /payroll, o mesmo módulo da Folha.
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { avaliarRecibo, ehReciboDeFerias, lerReciboDeFerias } from "./ferias-recibo.js";
import { duplicadosDe, resumoItem, rotuloLivre } from "./folha-duplicidade.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { FERIAS_CATEGORY, computeStatus } from "./payroll.service.js";
import { pdfDoCorpo } from "./pdf-corpo.js";
import { ehChaveUnicaDuplicada } from "./rescisao-trava.js";
import { extrairTextoPdf } from "./rh-extract.service.js";
import { round2 } from "./vt-calc.js";

export const feriasReciboRouter = Router();

// Os campos que a regra de duplicidade da folha olha.
const CAMPOS_DO_ITEM = { id: true, employeeId: true, type: true, competenceYear: true, competenceMonth: true, periodLabel: true, periodStart: true, details: true, status: true, deletedAt: true, paymentDate: true, paidAmount: true, amount: true, dueDate: true } as const;
const MSG_ROTULO_OCUPADO = "Já existe um lançamento de férias com o mesmo rótulo nesta competência (outra gravação ao mesmo tempo). Tente de novo.";
const diaUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDe = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const nomeArquivo = (v: unknown) => String(v ?? "recibo-ferias.pdf").replace(/[^\p{L}\p{N}.\-() _]/gu, "_").slice(0, 120);
const nomeCompleto = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.replace(/\s+/g, " ").trim();

class Recusa extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

type Candidato = { id: string; firstName: string; lastName: string; modality: string; terminationDate: Date | null };

async function acharFuncionario(nomeNoRecibo: string, employeeId: unknown): Promise<Candidato> {
  const campos = { id: true, firstName: true, lastName: true, modality: true, terminationDate: true } as const;
  if (typeof employeeId === "string" && employeeId) {
    const e = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: campos });
    if (!e) throw new Recusa(404, "Funcionário não encontrado.");
    return e;
  }
  const todos = await prisma.employee.findMany({ where: { deletedAt: null }, select: campos });
  const iguais = todos.filter((e) => semAcento(nomeCompleto(e)) === semAcento(nomeNoRecibo));
  if (iguais.length === 0) throw new Recusa(422, `Não achei, no cadastro, um funcionário chamado "${nomeNoRecibo}".`, { code: "SEM_FUNCIONARIO" });
  if (iguais.length > 1) {
    throw new Recusa(409, `Há mais de um funcionário chamado "${nomeNoRecibo}": escolha qual é.`, {
      code: "AMBIGUO", candidatos: iguais.map((e) => ({ id: e.id, nome: nomeCompleto(e) })),
    });
  }
  return iguais[0];
}

feriasReciboRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as { fileBase64?: unknown; fileName?: unknown; aplicar?: unknown; employeeId?: unknown };

  try {
    const pdf = pdfDoCorpo(b.fileBase64, { artigo: "do", nome: "recibo de férias", umNome: "um recibo de férias" });
    if (!("buffer" in pdf)) throw new Recusa(pdf.status, pdf.message);
    let texto: string;
    try {
      texto = await extrairTextoPdf(pdf.buffer);
    } catch (err) {
      throw new Recusa(422, `Não foi possível ler o PDF do recibo. ${(err as Error).message}`);
    }
    if (!ehReciboDeFerias(texto)) throw new Recusa(422, "O arquivo não parece um aviso e recibo de férias.");
    const recibo = lerReciboDeFerias(texto);
    const avaliacao = avaliarRecibo(recibo, texto);
    if (avaliacao.recusa) throw new Recusa(422, avaliacao.recusa);
    const avisos = [...avaliacao.avisos];
    const hash = crypto.createHash("sha256").update(pdf.buffer).digest("hex");
    const inicio = recibo.gozoInicio as string;
    const fim = recibo.gozoFim as string;
    const dias = recibo.dias as number;
    const liquido = recibo.liquido as number;

    const emp = await acharFuncionario(recibo.nome as string, b.employeeId);
    if (emp.modality !== "CLT") throw new Recusa(422, `${nomeCompleto(emp)} não é CLT: férias com aviso e recibo são só de quem tem registro.`);
    if (emp.terminationDate && isoDe(emp.terminationDate) as string < inicio) {
      throw new Recusa(422, `${nomeCompleto(emp)} saiu em ${dataBr(isoDe(emp.terminationDate))}, antes do início das férias do recibo.`);
    }
    if (semAcento(nomeCompleto(emp)) !== semAcento(recibo.nome as string)) {
      avisos.push(`O nome do recibo ("${recibo.nome}") é diferente do cadastro ("${nomeCompleto(emp)}"): confira se é a mesma pessoa.`);
    }

    // O que o ERP já sabe dessas férias.
    const programadas = await prisma.feriasProgramacao.findMany({
      where: { employeeId: emp.id, status: { in: ["PROGRAMADA", "GOZADA"] }, gozoInicio: { not: null } },
      select: { id: true, aquisitivoInicio: true, gozoInicio: true, dias: true },
    });
    const programacao = programadas.find((g) => isoDe(g.gozoInicio) === inicio) ?? null;
    if (programacao) {
      if (programacao.dias !== dias) avisos.push(`No ERP as férias têm ${programacao.dias} dias; o recibo traz ${dias}.`);
    } else {
      const doPeriodo = programadas.filter((g) => isoDe(g.aquisitivoInicio) === recibo.aquisitivoInicio);
      avisos.push(doPeriodo.length > 0
        ? `No ERP este período está programado para ${doPeriodo.map((g) => dataBr(isoDe(g.gozoInicio))).join(", ")}; o recibo começa em ${dataBr(inicio)}.`
        : `Não há férias programadas no ERP com início em ${dataBr(inicio)}: o título será lançado mesmo assim.`);
    }

    const start = diaUtc(inicio);
    const end = diaUtc(fim);
    const vencimentoIso = recibo.pagamentoEm ?? new Date(start.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    if (vencimentoIso > inicio) avisos.push(`A data do recibo (${dataBr(vencimentoIso)}) é depois do início das férias: pela lei o pagamento sai até 2 dias antes.`);
    const dueDate = diaUtc(vencimentoIso);

    // Mesmas guardas do lançamento manual de férias.
    try {
      await assertPeriodWritableForDate(start, "Lancamento de ferias");
    } catch (error) {
      throw new Recusa(400, error instanceof Error ? error.message : "Periodo fechado.");
    }
    const afastados = await prisma.employeeScheduleDay.findMany({
      where: { employeeId: emp.id, type: "AFASTAMENTO", date: { gte: start, lte: end } },
      select: { date: true }, orderBy: { date: "asc" },
    });
    if (afastados.length > 0) {
      throw new Recusa(409, `${nomeCompleto(emp)} está em afastamento não remunerado de ${dataBr(isoDe(afastados[0].date))} a ${dataBr(isoDe(afastados[afastados.length - 1].date))} dentro dessas férias. Ajuste o afastamento antes de lançar.`);
    }
    const competencia = { employeeId: emp.id, type: "FERIAS", competenceYear: start.getUTCFullYear(), competenceMonth: start.getUTCMonth() + 1 } as const;
    const jaImportado = await prisma.payrollItem.findFirst({
      where: { type: "FERIAS", deletedAt: null, status: { not: "CANCELED" }, details: { path: ["recibo", "hash"], equals: hash } },
      select: { id: true },
    });
    if (jaImportado) throw new Recusa(409, "Este recibo já foi importado.", { code: "JA_IMPORTADO" });
    const feriasDoMes = await prisma.payrollItem.findMany({ where: competencia, select: CAMPOS_DO_ITEM });
    const repetidas = duplicadosDe({ ...competencia, periodStart: start }, feriasDoMes);
    if (repetidas.length > 0) {
      throw new Recusa(409, `Estas férias de ${nomeCompleto(emp)} (início ${dataBr(inicio)}) já estão lançadas.`, { code: "DUPLICIDADE", existentes: repetidas.map(resumoItem) });
    }

    const previa = {
      employeeId: emp.id, nome: nomeCompleto(emp), nomeNoRecibo: recibo.nome, arquivo: nomeArquivo(b.fileName), hash,
      aquisitivoInicio: recibo.aquisitivoInicio, aquisitivoFim: recibo.aquisitivoFim, gozoInicio: inicio, gozoFim: fim, dias,
      vencimento: vencimentoIso, proventos: recibo.proventos, descontos: recibo.descontos, liquido,
      programacaoId: programacao?.id ?? null, avisos,
    };
    if (b.aplicar !== true) return response.json({ previa, aplicado: false });

    const dre = await prisma.dRECategory.findFirst({ where: { name: FERIAS_CATEGORY } });
    const id = crypto.randomUUID();
    try {
      await prisma.$transaction(async (tx) => {
        await travarFolhaDaPessoa(tx, emp.id);
        const mes = await tx.payrollItem.findMany({ where: competencia, select: CAMPOS_DO_ITEM });
        if (duplicadosDe({ ...competencia, periodStart: start }, mes).length > 0) {
          throw new Recusa(409, `Estas férias de ${nomeCompleto(emp)} (início ${dataBr(inicio)}) já estão lançadas.`, { code: "DUPLICIDADE" });
        }
        await tx.payrollItem.create({
          data: {
            id, employeeId: emp.id, type: "FERIAS",
            competenceYear: start.getUTCFullYear(), competenceMonth: start.getUTCMonth() + 1,
            periodLabel: rotuloLivre("Férias", mes.map((f) => f.periodLabel ?? "")),
            periodStart: start, periodEnd: end, dueDate,
            amount: round2(liquido), status: computeStatus(dueDate, null),
            dreCategoryId: dre?.id ?? null, source: "MANUAL",
            notes: `Aviso e recibo de férias da contabilidade (${previa.arquivo}).`,
            details: {
              recibo: {
                arquivo: previa.arquivo, hash, avisoEm: recibo.avisoEm, pagamentoEm: recibo.pagamentoEm,
                aquisitivoInicio: recibo.aquisitivoInicio, aquisitivoFim: recibo.aquisitivoFim, dias,
                proventos: recibo.proventos, descontos: recibo.descontos, liquido,
              },
              feriasProgramacaoId: programacao?.id ?? null,
              importadoPor: { userId: user.id, nome: user.name ?? null }, em: new Date().toISOString(),
            },
            createdById: user.id,
          },
        });
      });
    } catch (err) {
      if (ehChaveUnicaDuplicada(err)) throw new Recusa(409, MSG_ROTULO_OCUPADO);
      throw err;
    }
    await auditLog({
      userId: user.id, action: "IMPORT_VACATION_RECEIPT", entity: "PayrollItem", entityId: id,
      newValue: { employeeId: emp.id, gozoInicio: inicio, gozoFim: fim, liquido, vencimento: vencimentoIso, arquivo: previa.arquivo, hash },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") || null,
    });
    return response.status(201).json({ previa, aplicado: true, id });
  } catch (err) {
    if (err instanceof Recusa) return response.status(err.status).json({ message: err.message, ...err.extra });
    throw err;
  }
});
