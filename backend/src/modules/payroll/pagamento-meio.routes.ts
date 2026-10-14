// GET /payroll/pagamento-meio?year&month&tipo=ADIANTAMENTO|QUINZENA — a lista do adiantamento
// (dia 20) ou da 1ª quinzena (dia 15) para conferir e levar ao banco. Regras em pagamento-meio.ts.
// Tem valores e PIX: só para quem vê Funcionários. Só leitura.
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { getSessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { nomeCompleto } from "./nomes.js";
import { type PessoaMeio, type TipoPagamentoMeio, montarPagamentoMeio } from "./pagamento-meio.js";
import { computePayroll } from "./payroll.service.js";
import { textoContaBancaria } from "./tip-conferencia.js";

export const MSG_SEM_PERMISSAO_MEIO = "A lista do adiantamento tem valores e PIX: é preciso permissão de ver Funcionários.";

export const pagamentoMeioRouter = Router();

/**
 * Avisos do cálculo da folha que falam deste pagamento (pulados, excluídos à mão, depois da saída).
 * Fora: "já veio do extrato" (a linha já está na lista), o VT ("VT 1ª quinzena") e a categoria do DRE.
 * Os avisos só têm nome e valor: quem chega aqui já vê Funcionários.
 */
export function avisoDoPagamento(tipo: TipoPagamentoMeio, aviso: string): boolean {
  if (/já veio do extrato|categoria|\bVT\b|vale-transporte|ajuda de custo/i.test(aviso)) return false;
  return tipo === "QUINZENA" ? /1ª quinzena/i.test(aviso) : /adiantamento/i.test(aviso);
}

pagamentoMeioRouter.get("/pagamento-meio", async (request, response) => {
  if (!(await getSessionUser(request))) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO_MEIO });
  const q = request.query as Record<string, unknown>;
  const ano = Number(q.year);
  const mes = Number(q.month);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return response.status(400).json({ message: "Informe o ano e o mês." });
  }
  if (q.tipo !== "ADIANTAMENTO" && q.tipo !== "QUINZENA") return response.status(400).json({ message: "Tipo deve ser ADIANTAMENTO ou QUINZENA." });
  const tipo: TipoPagamentoMeio = q.tipo;

  const [lancados, calculo] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { competenceYear: ano, competenceMonth: mes, type: "ADIANTAMENTO", deletedAt: null },
      select: { id: true, employeeId: true, amount: true, dueDate: true, paymentDate: true, paidAmount: true, details: true, source: true, status: true },
    }),
    computePayroll(ano, mes),
  ]);
  const ids = [...new Set([...lancados.map((i) => i.employeeId), ...calculo.items.map((i) => i.employeeId)])];
  const cadastro = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, firstName: true, lastName: true, modality: true, company: { select: { legalName: true } },
      pixKey: true, pixKeyType: true, bankName: true, bankAgency: true, bankAccount: true, bankAccountDigit: true, bankAccountType: true,
    },
  });
  const pessoas = new Map(cadastro.map((e): [string, PessoaMeio] => [e.id, {
    id: e.id, nome: nomeCompleto(e), semRegistro: e.modality === "NAO_CLT", empresa: e.company?.legalName ?? null,
    pix: e.pixKey?.trim() || null, pixTipo: e.pixKeyType?.trim() || null,
    contaBancaria: textoContaBancaria({
      bankName: e.bankName ?? null, bankAgency: e.bankAgency ?? null, bankAccount: e.bankAccount ?? null,
      bankAccountDigit: e.bankAccountDigit ?? null, bankAccountType: String(e.bankAccountType ?? "CONTA_CORRENTE"),
    }),
  }]));

  // Título cancelado não entra na lista nem no total, mas também não pode sumir calado: o cálculo
  // o conta como lançado (não vira "falta lançar"), então quem paga precisa do aviso.
  const ehQuinzena = (d: unknown) => (d as { primeiraQuinzena?: unknown } | null)?.primeiraQuinzena === true;
  const cancelados = lancados.filter((i) => i.status === "CANCELED" && ehQuinzena(i.details) === (tipo === "QUINZENA"));
  const vivos = lancados.filter((i) => i.status !== "CANCELED");
  const lista = montarPagamentoMeio(tipo, vivos.map((i) => ({
    ...i, amount: Number(i.amount), paidAmount: i.paidAmount == null ? null : Number(i.paidAmount),
  })), calculo.items, pessoas);
  const competencia = `${String(mes).padStart(2, "0")}/${ano}`;
  const avisos = [
    ...(calculo.warnings ?? []).filter((w) => avisoDoPagamento(tipo, w)),
    ...cancelados.map((i) => `${pessoas.get(i.employeeId)?.nome ?? "—"}: título de ${competencia} cancelado no Contas a Pagar — fora desta lista. Se ainda precisa pagar, restaure ou lance de novo.`),
    ...(lista.cltSemTitulo.length > 0
      ? [`CLT sem adiantamento de ${competencia} no Contas a Pagar (o extrato do adiantamento já foi importado no Retorno do RH?): ${lista.cltSemTitulo.join(", ")}.`]
      : []),
  ];
  response.json({ ...lista, competencia, avisos });
});
