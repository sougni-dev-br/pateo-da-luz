// 13º dos sem registro, em /payroll/decimo-terceiro. A prévia mostra salário: exige ver Funcionários.
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { montarListaDecimo13 } from "./decimo-terceiro-lista.js";
import { nomeCompleto } from "./nomes.js";
import type { PessoaMeio } from "./pagamento-meio.js";
import { textoContaBancaria } from "./tip-conferencia.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import {
  gerarDecimoTerceiroSR, informarVariavelDecimo13, listarDecimoTerceiroClt, listarDecimoTerceiroSR, removerVariavelDecimo13,
  validarVariavelInformada,
} from "./decimo-terceiro.service.js";

export const decimoTerceiroRouter = Router();

const MSG_SEM_PERMISSAO = "O 13º é calculado sobre o salário: exige a permissão de ver Funcionários.";

// Ausente = ano corrente. Informado e inválido = erro (gerar 13º no ano errado em silêncio é pior que recusar).
export function lerAno(v: unknown): number | null {
  if (v == null || v === "") return new Date().getFullYear();
  const n = Number(v);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
}

const MSG_ANO = "Ano inválido (use um ano entre 2020 e 2100).";

// Ausente = 1ª parcela. Informado e diferente de 1 ou 2 = erro.
export function lerParcela(v: unknown): 1 | 2 | null {
  if (v == null || v === "") return 1;
  return v === 1 || v === 2 || v === "1" || v === "2" ? (Number(v) as 1 | 2) : null;
}

decimoTerceiroRouter.get("/", async (request, response) => {
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno(request.query.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  // CLT: lista só de leitura (o valor vem do extrato da contabilidade).
  response.json({ ...(await listarDecimoTerceiroSR(ano)), clt: await listarDecimoTerceiroClt(ano) });
});

// Lista de pagamento do 13º (1ª ou 2ª parcela) para conferir e levar ao banco, como a do adiantamento.
// Tem valores e PIX: mesma permissão da prévia. Só leitura.
decimoTerceiroRouter.get("/lista", async (request, response) => {
  if (!(await getSessionUser(request))) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno(request.query.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  const parcela = lerParcela(request.query.parcela);
  if (parcela == null) return response.status(400).json({ message: "Parcela inválida (use 1 ou 2)." });
  const [itens, previa] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { type: "DECIMO_TERCEIRO", competenceYear: ano, deletedAt: null, status: { not: "CANCELED" } },
      select: { id: true, employeeId: true, periodLabel: true, amount: true, dueDate: true, paymentDate: true, paidAmount: true, details: true },
    }),
    listarDecimoTerceiroSR(ano),
  ]);
  const ids = [...new Set([...itens.map((i) => i.employeeId), ...previa.linhas.map((l) => l.employeeId)])];
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
  const lista = montarListaDecimo13(
    ano, parcela,
    itens.map((i) => ({ ...i, amount: Number(i.amount), paidAmount: i.paidAmount == null ? null : Number(i.paidAmount) })),
    previa.linhas.map((l) => ({
      employeeId: l.employeeId, origem: l.origem, viaExtrato: l.viaExtrato, somaNoExtrato: l.somaNoExtrato, calculo: l.calculo, p1: l.p1, p: parcela === 1 ? l.p1 : l.p2,
    })),
    pessoas,
  );
  response.json({ ...lista, avisos: [...previa.avisos, ...lista.avisos] });
});

// Variável do mês informada à mão (substitui a apuração só no cálculo do 13º). Exige a mesma permissão da prévia.
decimoTerceiroRouter.put("/variavel", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const c = request.body ?? {};
  const ano = lerAno(c.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  const entrada = { employeeId: c.employeeId, ano, mes: c.mes, valor: c.valor, motivo: c.motivo };
  const erro = validarVariavelInformada(entrada);
  if (erro) return response.status(400).json({ message: erro });
  let anterior: number | null;
  try {
    ({ anterior } = await informarVariavelDecimo13(entrada, user.id));
  } catch (error) {
    return response.status(422).json({ message: error instanceof Error ? error.message : "Não foi possível gravar." });
  }
  // Fora do try: o valor já foi gravado, então falha de auditoria não vira "não gravou".
  await auditLog({
    userId: user.id, action: "SET_DECIMO_TERCEIRO_VARIAVEL", entity: "DecimoTerceiroVariavel", entityId: entrada.employeeId,
    previousValue: { valor: anterior }, newValue: { ano, mes: entrada.mes, valor: entrada.valor },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  }).catch(() => undefined);
  response.json({ ok: true });
});

decimoTerceiroRouter.delete("/variavel", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const ano = lerAno(request.query.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  const employeeId = String(request.query.employeeId ?? "");
  const mes = Number(request.query.mes);
  if (!employeeId || !Number.isInteger(mes) || mes < 1 || mes > 11) return response.status(400).json({ message: "Funcionário ou mês inválido." });
  const { anterior } = await removerVariavelDecimo13(employeeId, ano, mes);
  await auditLog({
    userId: user.id, action: "REMOVE_DECIMO_TERCEIRO_VARIAVEL", entity: "DecimoTerceiroVariavel", entityId: employeeId,
    previousValue: { ano, mes, valor: anterior },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

decimoTerceiroRouter.post("/generate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await podeVerDadosPessoais(request))) return response.status(403).json({ message: MSG_SEM_PERMISSAO });
  const corpo = request.body ?? {};
  const ano = lerAno(corpo.year);
  if (ano == null) return response.status(400).json({ message: MSG_ANO });
  const parcela = lerParcela(corpo.parcela);
  if (parcela == null) return response.status(400).json({ message: "Parcela inválida (use 1 ou 2)." });
  let resultado;
  try {
    resultado = await gerarDecimoTerceiroSR(ano, user.id, parcela);
  } catch (error) {
    // Mês de folha fechado: nada foi gravado, e quem gerou precisa saber por quê.
    return response.status(422).json({ message: error instanceof Error ? error.message : "Não foi possível gerar o 13º." });
  }
  // Só contagens: os nomes dos avisos já voltam na resposta, e o log não precisa deles.
  await auditLog({
    userId: user.id, action: "GENERATE_DECIMO_TERCEIRO", entity: "PayrollItem",
    newValue: {
      ano: resultado.ano, parcela: resultado.parcela, criadas: resultado.criadas, atualizadas: resultado.atualizadas,
      restauradas: resultado.restauradas, semCalculo: resultado.semCalculo, avisos: resultado.avisos.length,
    },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json(resultado);
});
