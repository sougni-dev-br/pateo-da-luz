// Soma a diferença do salário combinado ao título do 13º (1ª parcela) que veio do extrato da
// contabilidade. Só mexe no título em aberto; o pago não muda (a diferença, nesse caso, sai em
// lançamento próprio "(combinado)", feito pelo gerador). Regras puras em decimo-terceiro-combinado.ts.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog } from "../security/security-utils.js";
import { complementoSomado, DESCRICAO_COMBINADO, descricaoSomada, foiSomado, liquidoDoExtrato, semMarcasDoCombinado, valorComCombinado } from "./decimo-terceiro-combinado.js";
import { ROTULO_13_EXTRATO_PARCELA_1 } from "./decimo-terceiro-sr.js";
import { round2 } from "./vt-calc.js";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type SomaAoExtrato = { employeeId: string; nome: string; antes: number; depois: number };
export type ResultadoSoma = { alterados: SomaAoExtrato[]; avisos: string[] };
// O que somar ao título de uma pessoa e como isso se chama na explicação. Número puro = diferença do salário combinado.
export type ComplementoDoExtrato = { valor: number; descricao: string };

// `complementos`: o que cada pessoa com combinado deve somar na 1ª parcela (employeeId → valor).
// Quem já foi somado e não tem mais diferença volta ao líquido do extrato.
export async function somarCombinadoAoExtrato(
  ano: number, complementos: ReadonlyMap<string, number | ComplementoDoExtrato>, userId: string,
): Promise<ResultadoSoma> {
  const resultado: ResultadoSoma = { alterados: [], avisos: [] };
  const itens = await prisma.payrollItem.findMany({
    where: { type: "DECIMO_TERCEIRO", competenceYear: ano, periodLabel: ROTULO_13_EXTRATO_PARCELA_1, deletedAt: null, paymentDate: null, status: { not: "CANCELED" } },
    select: { id: true, employeeId: true, amount: true, details: true, employee: { select: { firstName: true, lastName: true } } },
  });
  for (const i of itens) {
    const pedido = complementos.get(i.employeeId);
    const complemento = pedido == null ? 0 : typeof pedido === "number" ? pedido : pedido.valor;
    const descricao = pedido != null && typeof pedido !== "number" ? pedido.descricao : DESCRICAO_COMBINADO;
    if (complemento <= 0 && !foiSomado(i.details)) continue;
    const nome = `${i.employee.firstName} ${i.employee.lastName}`.trim();
    const liquido = liquidoDoExtrato(i.details);
    if (liquido == null) {
      resultado.avisos.push(`13º de ${nome}: o lançamento não guardou o líquido do extrato; reimporte o extrato para somar o valor a mais (salário combinado ou período sem registro).`);
      continue;
    }
    // Valor do título que o sistema não gerou (ajustado à mão no Contas a Pagar): não é sobrescrito.
    const esperado = foiSomado(i.details) ? round2(liquido + (complementoSomado(i.details) ?? 0)) : round2(liquido);
    const atual = round2(Number(i.amount));
    if (Math.abs(atual - esperado) >= 0.01) {
      resultado.avisos.push(`13º de ${nome}: o título (${reais(atual)}) foi ajustado à mão e difere do esperado (${reais(esperado)}); o valor somado (salário combinado ou período sem registro) não foi mexido. Confira o valor.`);
      continue;
    }
    const base = semMarcasDoCombinado(i.details);
    const novo = complemento > 0
      ? (() => { const c = valorComCombinado(liquido, complemento, descricao); return { valor: c.valor, details: { ...base, ...c.detalhes } }; })()
      : { valor: round2(liquido), details: base };
    const antes = round2(Number(i.amount));
    const descricaoAntes = foiSomado(i.details) ? descricaoSomada(i.details) ?? DESCRICAO_COMBINADO : null;
    if (complemento > 0 && descricaoAntes != null && descricaoAntes !== descricao) {
      resultado.avisos.push(`13º de ${nome}: o valor somado ao título mudou de "${descricaoAntes}" para "${descricao}". Confira o título.`);
    }
    // Campo a campo (o jsonb reordena as chaves, então comparar o objeto inteiro nunca dá igual).
    const jaCerto = Math.abs(antes - novo.valor) < 0.005
      && (complemento > 0
        ? foiSomado(i.details) && Math.abs((complementoSomado(i.details) ?? -1) - round2(complemento)) < 0.005 && (descricaoSomada(i.details) ?? DESCRICAO_COMBINADO) === descricao
        : !foiSomado(i.details));
    const mesmo = jaCerto;
    if (mesmo) continue;
    // Condicionado ao estado lido: se alguém pagou ou excluiu no meio, não grava.
    const r = await prisma.payrollItem.updateMany({
      where: { id: i.id, deletedAt: null, paymentDate: null },
      data: { amount: novo.valor, details: novo.details as Prisma.InputJsonValue, updatedById: userId },
    });
    if (r.count === 0) continue;
    await auditLog({
      userId, action: "DECIMO_COMBINADO_SOMADO", entity: "PayrollItem", entityId: i.id,
      previousValue: { amount: antes }, newValue: { amount: novo.valor, complemento, ano },
    }).catch(() => undefined);
    resultado.alterados.push({ employeeId: i.employeeId, nome, antes, depois: novo.valor });
  }
  return resultado;
}
