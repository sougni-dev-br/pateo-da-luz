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
      select: { id: true, employeeId: true, amount: true, dueDate: true, paymentDate: true, paidAmount: true, details: true },
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

  const lista = montarPagamentoMeio(tipo, lancados.map((i) => ({
    ...i, amount: Number(i.amount), paidAmount: i.paidAmount == null ? null : Number(i.paidAmount),
  })), calculo.items, pessoas);
  // Só os avisos do cálculo que falam deste pagamento (pulados, excluídos à mão). "Já veio do
  // extrato" não entra: a linha da pessoa já está na lista, com a empresa do extrato.
  const chave = tipo === "QUINZENA" ? /quinzena/i : /adiantamento/i;
  const avisos = (calculo.warnings ?? []).filter((w) => chave.test(w) && !/já veio do extrato/i.test(w));
  response.json({ ...lista, competencia: `${String(mes).padStart(2, "0")}/${ano}`, avisos });
});
