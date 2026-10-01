// Salário combinado com o banco: quem tem combinado vigente na competência, a gorjeta
// apurada de cada pessoa e a sincronização do SALARIO do extrato no Contas a Pagar com o
// valor integral (regra em salario-combinado-folha.ts).
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog } from "../security/security-utils.js";
import { cadastroVigenteEm, diaDeReferencia } from "./cadastro-historico.js";
import { carregarHistorico } from "./cadastro-historico.service.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { type GorjetaDaApuracao, mesclarDetalhes, salarioDaFolha } from "./salario-combinado-folha.js";

// Salário combinado VIGENTE no mês da competência (não o de hoje): quem teve o combinado
// mudado depois continua com o daquele mês. Sem ids = todos com combinado ou histórico dele.
export async function combinadosVigentes(ano: number, mes: number, ids: string[] | null) {
  const comHistorico = ids ? [] : (await prisma.employeeHistorico.findMany({
    where: { campo: "salarioCombinado" }, select: { employeeId: true }, distinct: ["employeeId"],
  })).map((h) => h.employeeId);
  const lista = await prisma.employee.findMany({
    where: ids
      ? { id: { in: ids } }
      : { deletedAt: null, OR: [{ salarioCombinado: { not: null } }, { id: { in: comHistorico } }] },
    select: { id: true, firstName: true, lastName: true, displayName: true, salarioCombinado: true, salarioCombinadoMotivo: true, terminationDate: true },
  });
  const historico = await carregarHistorico(lista.map((e) => e.id));
  return lista
    .map((e) => {
      const vigente = cadastroVigenteEm({ salarioCombinado: e.salarioCombinado == null ? null : Number(e.salarioCombinado) },
        historico.get(e.id) ?? [], diaDeReferencia(ano, mes, e.terminationDate));
      return { ...e, salarioCombinado: vigente.salarioCombinado as number | null };
    })
    .filter((e) => e.salarioCombinado != null);
}

export async function mapaCombinados(ano: number, mes: number, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  return new Map((await combinadosVigentes(ano, mes, [...new Set(ids)])).map((e) => [e.id, Number(e.salarioCombinado)]));
}

// Gorjeta líquida dos pontos (rateio − vales + créditos) de cada participante da apuração
// da competência — a mesma da folha de líquidos. null = não há apuração do mês.
export async function gorjetasDaCompetencia(ano: number, mes: number): Promise<Map<string, GorjetaDaApuracao> | null> {
  const comp = await computeTipCommission(ano, mes);
  if (!comp.periodId) return null;
  return new Map(comp.participants.map((p) => [p.employeeId, { noPeriodo: p.tipoCalculo !== "FORA_DO_PERIODO", gorjetaLiquida: p.netCommission }]));
}

export const avisoGorjetaPendente = (nome: string) =>
  `Salário combinado de ${nome}: gorjeta do mês ainda não apurada; lançado o líquido do extrato. Será atualizado ao fechar a gorjeta.`;

export type SalarioSincronizado = { payrollItemId: string; employeeId: string; nome: string; antes: number; depois: number; pendenteGorjeta: boolean };
export type ResultadoSincronizacao = {
  competencia: string;
  alterados: SalarioSincronizado[];
  semMudanca: number;
  pagosIgnorados: number;
  avisos: string[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const objeto = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const mesmoValor = (a: number, b: number) => Math.abs(a - b) < 0.005;
const CHAVES_COMPARADAS = ["combinado", "adiantamento", "gorjetaIntegral", "complemento", "origemValor", "pendenteGorjeta"];
const mesmoEstado = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  CHAVES_COMPARADAS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

// Recalcula o SALARIO do extrato ainda não pago de quem tem (ou tinha) salário combinado na
// competência. Pago não muda. Não cria lançamento: só ajusta o que a importação gravou.
// A trava do período (fechamento mensal/CMV) lança: quem chama decide como avisar.
export async function sincronizarSalariosCombinados(ano: number, mes: number, usuario: { id: string; name: string }): Promise<ResultadoSincronizacao> {
  const mmaaaa = `${String(mes).padStart(2, "0")}/${ano}`;
  const resultado: ResultadoSincronizacao = { competencia: mmaaaa, alterados: [], semMudanca: 0, pagosIgnorados: 0, avisos: [] };
  const itens = await prisma.payrollItem.findMany({
    where: {
      type: "SALARIO", competenceYear: ano, competenceMonth: mes, periodLabel: `Extrato ${mmaaaa}`, source: "EXTRATO_RH",
      deletedAt: null, status: { not: "CANCELED" },
    },
    select: { id: true, employeeId: true, amount: true, paymentDate: true, status: true, details: true, employee: { select: { firstName: true, lastName: true } } },
  });
  if (itens.length === 0) return resultado;
  const combinados = await mapaCombinados(ano, mes, itens.map((i) => i.employeeId));
  // Só quem tem combinado agora ou tinha quando o lançamento foi calculado (para desfazer).
  const tocados = itens.filter((i) => {
    const d = objeto(i.details);
    return combinados.has(i.employeeId) || d.origemValor === "SALARIO_COMBINADO" || d.pendenteGorjeta === true;
  });
  const abertos = tocados.filter((i) => i.paymentDate == null && i.status !== "PAID");
  resultado.pagosIgnorados = tocados.length - abertos.length;
  if (abertos.length === 0) return resultado;

  await assertPeriodWritableForDate(new Date(Date.UTC(ano, mes - 1, 1)), "Atualização dos salários combinados");
  const gorjetas = await gorjetasDaCompetencia(ano, mes);

  for (const i of abertos) {
    const nome = `${i.employee.firstName} ${i.employee.lastName}`.trim();
    const d = objeto(i.details);
    const liquidoExtrato = num(d.liquidoExtrato) ?? num(d.liquido);
    const combinado = combinados.get(i.employeeId) ?? null;
    if (liquidoExtrato == null || (combinado != null && !("adiantamento" in d))) {
      resultado.avisos.push(`Salário de ${nome} (${mmaaaa}): o lançamento não guardou o líquido e o adiantamento do extrato; reimporte o extrato para calcular o salário combinado.`);
      continue;
    }
    const calc = salarioDaFolha({
      liquidoExtrato, adiantamento: num(d.adiantamento), combinado, gorjeta: gorjetas?.get(i.employeeId) ?? null,
    });
    if (calc.pendenteGorjeta) resultado.avisos.push(`Salário combinado de ${nome}: gorjeta do mês ainda não apurada; mantido o líquido do extrato.`);
    if (calc.aviso) resultado.avisos.push(`Salário combinado de ${nome}: ${calc.aviso}.`);
    const antes = Number(i.amount);
    const detalhes = mesclarDetalhes(i.details, calc.detalhes);
    if (mesmoValor(antes, calc.valor) && mesmoEstado(d, detalhes)) { resultado.semMudanca += 1; continue; }
    await prisma.payrollItem.update({ where: { id: i.id }, data: { amount: calc.valor, details: detalhes as never, updatedById: usuario.id } });
    await auditLog({
      userId: usuario.id, action: "SALARIO_COMBINADO_SINCRONIZADO", entity: "PayrollItem", entityId: i.id,
      previousValue: { amount: antes, origemValor: d.origemValor ?? null, pendenteGorjeta: d.pendenteGorjeta ?? false },
      newValue: { amount: calc.valor, origemValor: calc.detalhes.origemValor ?? null, pendenteGorjeta: calc.pendenteGorjeta, competencia: mmaaaa },
    });
    resultado.alterados.push({ payrollItemId: i.id, employeeId: i.employeeId, nome, antes, depois: calc.valor, pendenteGorjeta: calc.pendenteGorjeta });
  }
  return resultado;
}
