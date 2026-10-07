// Recibos de pagamento de quem não tem registro (só leitura: nada é gravado). Regras em
// recibo-pagamento.ts. O recibo mostra valores de dias trabalhados, adiantamento e quinzena:
// só para quem pode ver Funcionários (403 sem). O CPF não vai para log nenhum.
//   GET /payroll/tip/recibos-pagamento?year&month[&employeeId]  pagamento do mês (lista de pagamento)
//   GET /payroll/recibos-adiantamento?year&month[&id]           1ª quinzena (dia 15) e adiantamento (dia 20)
import { Router, type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { getSessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { ROTULO_ACERTO, competenciaTexto } from "./acerto-lista.js";
import { nomeCompleto } from "./nomes.js";
import { computeTipCommission } from "./tip-commission.service.js";
import {
  type AcertoDoRecibo, type PagosAntesDoMes, type ParticipanteDoRecibo, type PessoaDoRecibo, ehPrimeiraQuinzena, recebeReciboDoMes, reciboDoMes, reciboPagoAntes,
} from "./recibo-pagamento.js";

const MSG_SEM_PERMISSAO = "O recibo mostra os valores pagos à pessoa: é preciso permissão de ver Funcionários.";

// Competência da URL; null se faltar ou for inválida (recibo nunca sai "do mês atual" por engano).
function competenciaDaUrl(q: Record<string, unknown>): { ano: number; mes: number } | null {
  const ano = Number(q.year);
  const mes = Number(q.month);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

const textoOuNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Sessão + ver Funcionários. Responde e devolve false quando barra.
async function autorizado(request: Request, response: Response): Promise<boolean> {
  const user = await getSessionUser(request);
  if (!user) { response.status(401).json({ message: "Sessão obrigatória." }); return false; }
  if (!(await podeVerDadosPessoais(request))) { response.status(403).json({ message: MSG_SEM_PERMISSAO }); return false; }
  return true;
}

// Cadastro para o cabeçalho do recibo. Não há código de funcionário no cadastro: o campo sai vazio.
async function pessoas(ids: string[]): Promise<Map<string, PessoaDoRecibo>> {
  const lista = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, firstName: true, lastName: true, cpf: true, position: true, admissionDate: true, birthDate: true, baseSalary: true,
      tipFunction: { select: { name: true } },
    },
  });
  return new Map(lista.map((e) => [e.id, {
    nome: nomeCompleto(e), cpf: e.cpf ?? null, codigo: null, funcao: e.position ?? e.tipFunction?.name ?? null,
    admissao: e.admissionDate ?? null, nascimento: e.birthDate ?? null, valorMensal: e.baseSalary == null ? null : Number(e.baseSalary),
  }]));
}

// ─── Pagamento do mês ────────────────────────────────────────────────────────
export const tipRecibosRouter = Router();

tipRecibosRouter.get("/recibos-pagamento", async (request, response) => {
  if (!(await autorizado(request, response))) return;
  const q = request.query as Record<string, unknown>;
  const comp = competenciaDaUrl(q);
  if (!comp) return response.status(400).json({ message: "Competência inválida." });
  const employeeId = textoOuNull(q.employeeId);

  const apuracao = await computeTipCommission(comp.ano, comp.mes, { incluirDadosPessoais: true });
  const participantes = (apuracao.participants as unknown as ParticipanteDoRecibo[])
    .filter(recebeReciboDoMes)
    .filter((p) => !employeeId || p.employeeId === employeeId);
  if (employeeId && participantes.length === 0) {
    return response.status(404).json({ message: "Essa pessoa não tem pagamento a receber na lista deste mês." });
  }
  const ids = participantes.map((p) => p.employeeId);
  const [dados, acertos, pagosAntes] = await Promise.all([
    pessoas(ids),
    ids.length === 0 ? [] : prisma.payrollItem.findMany({
      where: {
        type: "SALARIO", periodLabel: ROTULO_ACERTO, competenceYear: comp.ano, competenceMonth: comp.mes,
        employeeId: { in: ids }, deletedAt: null, status: { not: "CANCELED" },
      },
      select: { employeeId: true, amount: true, paidAmount: true, paymentDate: true },
    }),
    // Adiantamento e 1ª quinzena já pagos: a data vai na referência da linha de desconto.
    ids.length === 0 ? [] : prisma.payrollItem.findMany({
      where: {
        type: "ADIANTAMENTO", competenceYear: comp.ano, competenceMonth: comp.mes, employeeId: { in: ids },
        deletedAt: null, status: { not: "CANCELED" }, paymentDate: { not: null },
      },
      select: { employeeId: true, paymentDate: true, details: true, amount: true },
    }),
  ]);
  const pagosDe = new Map<string, PagosAntesDoMes>();
  for (const t of pagosAntes) {
    const atual = pagosDe.get(t.employeeId) ?? {};
    pagosDe.set(t.employeeId, ehPrimeiraQuinzena(t.details)
      ? { ...atual, quinzena: t.paymentDate, quinzenaTitulo: Number(t.amount) }
      : { ...atual, adiantamento: t.paymentDate, adiantamentoTitulo: Number(t.amount) });
  }
  const acertoDe = new Map<string, AcertoDoRecibo>(acertos.map((a) => [a.employeeId, {
    amount: Number(a.amount), paidAmount: a.paidAmount == null ? null : Number(a.paidAmount), paymentDate: a.paymentDate,
  }]));
  const recibos = participantes.map((p) => reciboDoMes(
    p, dados.get(p.employeeId) ?? { nome: p.employeeName, cpf: null }, acertoDe.get(p.employeeId) ?? null, comp.ano, comp.mes,
    pagosDe.get(p.employeeId) ?? {},
  ));
  response.json({ competencia: competenciaTexto(comp.ano, comp.mes), recibos });
});

// ─── 1ª quinzena e adiantamento ──────────────────────────────────────────────
export const folhaRecibosRouter = Router();

folhaRecibosRouter.get("/recibos-adiantamento", async (request, response) => {
  if (!(await autorizado(request, response))) return;
  const q = request.query as Record<string, unknown>;
  const comp = competenciaDaUrl(q);
  if (!comp) return response.status(400).json({ message: "Competência inválida." });
  const id = textoOuNull(q.id);

  // Só o título do sem registro (o CLT recebe o holerite da contabilidade).
  const titulos = await prisma.payrollItem.findMany({
    where: {
      type: "ADIANTAMENTO", competenceYear: comp.ano, competenceMonth: comp.mes, deletedAt: null, status: { not: "CANCELED" },
      details: { path: ["semRegistro"], equals: true }, ...(id ? { id } : {}),
    },
    select: {
      id: true, employeeId: true, competenceYear: true, competenceMonth: true, amount: true, paidAmount: true, paymentDate: true, details: true,
      differenceReason: true, employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ employee: { firstName: "asc" } }, { employee: { lastName: "asc" } }],
  });
  if (id && titulos.length === 0) {
    return response.status(404).json({ message: "Lançamento não encontrado (ou não é quinzena/adiantamento de quem não tem registro)." });
  }
  const dados = await pessoas([...new Set(titulos.map((t) => t.employeeId))]);
  const recibos = titulos
    .map((t) => reciboPagoAntes({
      id: t.id, employeeId: t.employeeId, competenceYear: t.competenceYear, competenceMonth: t.competenceMonth,
      amount: Number(t.amount), paidAmount: t.paidAmount == null ? null : Number(t.paidAmount), paymentDate: t.paymentDate, details: t.details,
      differenceReason: t.differenceReason,
    }, dados.get(t.employeeId) ?? { nome: nomeCompleto(t.employee), cpf: null }))
    .filter((r) => r.total > 0);
  response.json({ competencia: competenciaTexto(comp.ano, comp.mes), recibos });
});
