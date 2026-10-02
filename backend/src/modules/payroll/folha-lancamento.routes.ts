// Lançamento manual na Folha (salário, adiantamento, vale-transporte) e a conferência
// do lote antes da baixa — as duas pontas das travas contra pagamento em duplicidade.
// Rescisão e férias têm rotas próprias (payroll.routes.ts).
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import {
  aposSaida, competenciaDe, diaIso, duplicadosDe, motivoValido, MOTIVO_MINIMO, resumoItem, rotuloLivre, rotuloTipo,
  suspeitosDoLote, type ItemFolha,
} from "./folha-duplicidade.js";
import { FOLHA_CATEGORY, VT_CATEGORY, computeStatus, getOrDefaultSettings } from "./payroll.service.js";
import { eveOf, round2 } from "./vt-calc.js";

export const folhaLancamentoRouter = Router();

const TIPOS_MANUAIS = ["SALARIO", "ADIANTAMENTO", "VALE_TRANSPORTE"] as const;
type TipoManual = (typeof TIPOS_MANUAIS)[number];
const VALOR_MAXIMO = 1_000_000;

// Recusa com status e corpo, lançada de dentro da transação para desfazê-la.
export class RecusaFolha extends Error {
  constructor(public readonly status: number, public readonly corpo: Record<string, unknown>) {
    super(String(corpo.message ?? "Recusado."));
  }
}

// Uma escrita de folha por pessoa de cada vez: dois lançamentos simultâneos passariam
// os dois pela checagem e criariam o par duplicado. A trava solta no commit/rollback.
export async function travarFolhaDaPessoa(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`folha:${employeeId}`}))`;
}

export const nomeDe = (e: { firstName: string; lastName: string } | null | undefined) =>
  e ? `${e.firstName} ${e.lastName}`.trim() : "";
export const dataBr = (d: Date | string | null | undefined) => (diaIso(d) ?? "").split("-").reverse().join("/");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Campos que as travas leem de cada item da folha.
export const CAMPOS_TRAVA = {
  id: true, employeeId: true, type: true, competenceYear: true, competenceMonth: true, periodLabel: true, periodStart: true,
  details: true, status: true, deletedAt: true, paymentDate: true, paidAmount: true, amount: true, dueDate: true,
} as const;

type Periodo = { periodStart: Date | null; periodEnd: Date | null; rotulo: string; vencimento: Date };

// Período, rótulo e vencimento padrão de cada tipo — os mesmos do "Gerar folha".
function periodoDoLancamento(
  tipo: TipoManual, ano: number, mes: number, quinzena: 1 | 2 | null,
  settings: { vtSecondPeriodStartDay: number; advanceDueDay: number; salaryDueDay: number },
): Periodo {
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const utc = (y: number, m: number, dia: number) => new Date(Date.UTC(y, m - 1, dia));
  if (tipo === "VALE_TRANSPORTE") {
    const corte = Math.min(Math.max(settings.vtSecondPeriodStartDay, 2), diasNoMes);
    const [inicio, fim, rotulo] = quinzena === 1 ? [1, corte - 1, "VT 1ª quinzena"]
      : quinzena === 2 ? [corte, diasNoMes, "VT 2ª quinzena"]
        : [1, diasNoMes, "VT mensal"];
    const [vy, vm, vd] = eveOf(ano, mes, inicio);
    return { periodStart: utc(ano, mes, inicio), periodEnd: utc(ano, mes, fim), rotulo, vencimento: utc(vy, vm, vd) };
  }
  if (tipo === "ADIANTAMENTO") {
    return { periodStart: null, periodEnd: null, rotulo: "Adiantamento", vencimento: utc(ano, mes, Math.min(settings.advanceDueDay, diasNoMes)) };
  }
  const ny = mes === 12 ? ano + 1 : ano;
  const nm = mes === 12 ? 1 : mes + 1;
  const diasProximo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return { periodStart: null, periodEnd: null, rotulo: "Salário", vencimento: utc(ny, nm, Math.min(settings.salaryDueDay, diasProximo)) };
}

type Entrada = {
  employeeId: string; tipo: TipoManual; ano: number; mes: number; quinzena: 1 | 2 | null; valor: number;
  vencimento: Date | null; notas: string | null; complemento: boolean; confirmaAposSaida: boolean;
};

function lerEntrada(b: Record<string, unknown>): { erro: string } | Entrada {
  const tipo = String(b.type ?? "");
  if (!TIPOS_MANUAIS.includes(tipo as TipoManual)) {
    return { erro: "Lançamento manual é de salário, adiantamento ou vale-transporte (rescisão e férias têm tela própria)." };
  }
  const ano = Number(b.competenceYear);
  const mes = Number(b.competenceMonth);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { erro: "Competência inválida." };
  }
  const valor = Number(b.amount);
  if (!Number.isFinite(valor) || valor <= 0 || valor > VALOR_MAXIMO) return { erro: "Valor (maior que zero) é obrigatório." };
  const q = b.quinzena == null || b.quinzena === "" ? null : Number(b.quinzena);
  if (q != null && q !== 1 && q !== 2) return { erro: "Quinzena inválida (1, 2 ou mês inteiro)." };
  const vencimento = b.dueDate ? new Date(String(b.dueDate)) : null;
  if (vencimento && Number.isNaN(vencimento.getTime())) return { erro: "Vencimento inválido." };
  const notas = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim().slice(0, 1000) : null;
  return {
    employeeId: String(b.employeeId ?? ""), tipo: tipo as TipoManual, ano, mes,
    quinzena: tipo === "VALE_TRANSPORTE" ? (q as 1 | 2 | null) : null,
    valor: round2(valor), vencimento, notas, complemento: b.complemento === true, confirmaAposSaida: b.confirmaAposSaida === true,
  };
}

// ─── LANÇAMENTO MANUAL ──────────────────────────────────────────────────────────
folhaLancamentoRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = (request.body ?? {}) as Record<string, unknown>;
  const lido = lerEntrada(b);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });

  const emp = await prisma.employee.findFirst({ where: { id: lido.employeeId, deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });
  const nome = nomeDe(emp);

  try {
    await assertPeriodWritableForDate(new Date(lido.ano, lido.mes - 1, 1), "Lancamento manual de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Período fechado." });
  }

  const settings = await getOrDefaultSettings();
  const periodo = periodoDoLancamento(lido.tipo, lido.ano, lido.mes, lido.quinzena, settings);
  const novo: ItemFolha = {
    employeeId: emp.id, type: lido.tipo, competenceYear: lido.ano, competenceMonth: lido.mes, periodStart: periodo.periodStart,
  };
  const competencia = competenciaDe(novo);

  // Trava 2: nada depois da saída (salvo confirmação com motivo).
  let aposSaidaInfo: { motivo: string; saida: string; por: string; porNome: string | null; em: string } | null = null;
  if (aposSaida(novo, emp.terminationDate)) {
    if (!lido.confirmaAposSaida) {
      return response.status(409).json({
        code: "APOS_SAIDA",
        message: `${nome} saiu em ${dataBr(emp.terminationDate)}: ${periodo.rotulo} de ${competencia} é depois da saída.`,
        saida: diaIso(emp.terminationDate),
      });
    }
    const motivo = motivoValido(b.motivoAposSaida);
    if (!motivo) return response.status(400).json({ message: `Explique por que lançar depois da saída (pelo menos ${MOTIVO_MINIMO} letras).` });
    aposSaidaInfo = { motivo, saida: diaIso(emp.terminationDate)!, por: user.id, porNome: user.name ?? null, em: new Date().toISOString() };
  }

  let complementoInfo: { motivo: string; por: string; porNome: string | null; em: string } | null = null;
  if (lido.complemento) {
    const motivo = motivoValido(b.motivoComplemento);
    if (!motivo) return response.status(400).json({ message: `Explique o complemento (pelo menos ${MOTIVO_MINIMO} letras).` });
    complementoInfo = { motivo, por: user.id, porNome: user.name ?? null, em: new Date().toISOString() };
  }

  const dre = await prisma.dRECategory.findFirst({ where: { name: lido.tipo === "VALE_TRANSPORTE" ? VT_CATEGORY : FOLHA_CATEGORY } });
  const vencimento = lido.vencimento ?? periodo.vencimento;
  // O vencimento posiciona o título no Contas a Pagar (e o mês dele no caixa): mês travado
  // também recusa, não só o da competência.
  try {
    await assertPeriodWritableForDate(vencimento, "Vencimento de lancamento manual de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Período do vencimento fechado." });
  }

  let criado: { id: string; periodLabel: string };
  try {
    criado = await prisma.$transaction(async (tx) => {
      await travarFolhaDaPessoa(tx, emp.id);
      // Todos da competência, inclusive excluídos: os vivos dizem se é duplicado, e os
      // rótulos de todos (a chave única não olha deletedAt) dizem qual rótulo está livre.
      const doMes = await tx.payrollItem.findMany({
        where: { employeeId: emp.id, type: lido.tipo, competenceYear: lido.ano, competenceMonth: lido.mes },
        select: CAMPOS_TRAVA,
      });
      const duplicados = duplicadosDe(novo, doMes);
      // Trava 1: um pagamento por pessoa + tipo + competência (+ quinzena no VT).
      if (duplicados.length > 0 && !complementoInfo) {
        throw new RecusaFolha(409, {
          code: "DUPLICIDADE",
          message: `Já existe ${rotuloTipo(lido.tipo).toLowerCase()} de ${competencia} para ${nome}. Se for um pagamento a mais, marque como complemento e explique o motivo.`,
          existentes: duplicados.map(resumoItem),
        });
      }
      const base = complementoInfo ? `${periodo.rotulo} (complemento)` : periodo.rotulo;
      const periodLabel = rotuloLivre(base, doMes.map((i) => i.periodLabel));
      const details: Record<string, unknown> = {
        lancamentoManual: true,
        ...(complementoInfo ? { complemento: complementoInfo, duplicaDe: duplicados.map((d) => d.id) } : {}),
        ...(aposSaidaInfo ? { aposSaida: aposSaidaInfo } : {}),
      };
      const item = await tx.payrollItem.create({
        data: {
          id: crypto.randomUUID(), employeeId: emp.id, type: lido.tipo, competenceYear: lido.ano, competenceMonth: lido.mes,
          periodLabel, periodStart: periodo.periodStart, periodEnd: periodo.periodEnd, dueDate: vencimento, amount: lido.valor,
          status: computeStatus(vencimento, null), dreCategoryId: dre?.id ?? null, source: "MANUAL", notes: lido.notas,
          details: details as Prisma.InputJsonValue, createdById: user.id,
        },
      });
      return { id: item.id, periodLabel };
    });
  } catch (err) {
    if (err instanceof RecusaFolha) return response.status(err.status).json(err.corpo);
    throw err;
  }

  const comum = { entity: "PayrollItem", entityId: criado.id, userId: user.id, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") };
  const resumo = { employeeId: emp.id, tipo: lido.tipo, competencia, rotulo: criado.periodLabel, valor: lido.valor };
  await auditLog({ ...comum, action: "CREATE_PAYROLL_ITEM_MANUAL", newValue: resumo });
  if (complementoInfo) await auditLog({ ...comum, action: "LANCAMENTO_FOLHA_COMPLEMENTO", newValue: { ...resumo, complemento: complementoInfo } });
  if (aposSaidaInfo) await auditLog({ ...comum, action: "LANCAMENTO_FOLHA_APOS_SAIDA", newValue: { ...resumo, aposSaida: aposSaidaInfo } });

  response.status(201).json({ id: criado.id, periodLabel: criado.periodLabel, amount: lido.valor, valorFormatado: brl(lido.valor) });
});

// ─── CONFERÊNCIA DO LOTE ANTES DA BAIXA ─────────────────────────────────────────
// Recebe os ids da folha que vão ser baixados juntos e devolve, de uma vez, os suspeitos:
// o que já tem o mesmo pagamento pago e os pares repetidos dentro do próprio lote.
// Nada é baixado aqui; a tela decide (confirma ou tira os itens).
folhaLancamentoRouter.post("/pay-check", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const ids = Array.isArray(request.body?.ids) ? (request.body.ids as unknown[]).map(String).filter(Boolean).slice(0, 500) : [];
  if (ids.length === 0) return response.json({ suspeitos: [] });

  const lote = await prisma.payrollItem.findMany({ where: { id: { in: ids }, deletedAt: null }, select: CAMPOS_TRAVA });
  if (lote.length === 0) return response.json({ suspeitos: [] });
  const pessoas = [...new Set(lote.map((i) => i.employeeId))];
  const pagos = await prisma.payrollItem.findMany({
    where: { employeeId: { in: pessoas }, deletedAt: null, paymentDate: { not: null }, id: { notIn: ids } },
    select: CAMPOS_TRAVA,
  });
  const funcionarios = await prisma.employee.findMany({ where: { id: { in: pessoas } }, select: { id: true, firstName: true, lastName: true } });
  const nomes = new Map(funcionarios.map((f) => [f.id, nomeDe(f)]));

  const suspeitos = suspeitosDoLote(lote, pagos).map((s) => ({
    item: resumoItem(s.item),
    pessoa: nomes.get(s.item.employeeId) ?? "",
    jaPagos: s.jaPagos.map(resumoItem),
    noLote: s.noLote.map(resumoItem),
  }));
  response.json({ suspeitos });
});
