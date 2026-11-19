// Soma ao título FERIAS (em aberto) a diferença do salário combinado e da gorjeta integral — molde do 13º
// com combinado (decimo-terceiro-combinado.service.ts). Regras puras em ferias-combinado.ts.
//
// Gatilho: ação EXPLÍCITA (POST /payroll/ferias/combinado). Não roda sozinho na importação do recibo nem em
// segundo plano: o complemento depende do combinado vigente e da janela de 12 meses (que muda a cada apuração
// fechada), então quem paga olha a prévia, confere a fórmula e só então aplica. Reaplicar recalcula enquanto
// o título estiver aberto; pago nunca muda; nunca cria um segundo título.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog } from "../security/security-utils.js";
import {
  chaveDoMes, complementoDeFerias, complementoSomadoAFerias, foiSomadoAFerias, diasDoRecibo, informadasGuardadas, janelaDeMeses,
  liquidoDoRecibo, mediaDaGorjeta, semMarcasDoFeriasCombinado, valorFeriasComCombinado, type MesDaGorjeta,
} from "./ferias-combinado.js";
import { gorjetaDaPessoa } from "./salario-combinado-folha.js";
import { gorjetasDaCompetencia, mapaCombinados } from "./salario-combinado.service.js";

const round2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MAX_GORJETA_MES = 100_000;
const CHAVE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export class RecusaFerias extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type PreviaFeriasCombinado = {
  payrollItemId: string; employeeId: string; nome: string;
  combinado: number | null; mediaGorjeta: number; mesesContados: number; mesesAusentes: string[]; meses: MesDaGorjeta[];
  remuneracao: number; liquidoRecibo: number; complemento: number; valorAntes: number; valorDepois: number;
  formula: string | null; avisos: string[];
};
export type ResultadoFeriasCombinado = { aplicado: boolean; previa: PreviaFeriasCombinado; motivo?: string };

function validarInformadas(informadas: Record<string, unknown> | undefined, janela: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [chave, v] of Object.entries(informadas ?? {})) {
    if (!CHAVE_MES.test(chave)) throw new RecusaFerias(400, `Competência "${chave}" inválida: use AAAA-MM.`);
    if (!janela.has(chave)) throw new RecusaFerias(400, `A competência ${chave} está fora dos 12 meses que entram na média.`);
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_GORJETA_MES) {
      throw new RecusaFerias(400, `Gorjeta de ${chave} inválida: informe um valor entre 0 e ${MAX_GORJETA_MES}.`);
    }
    out.set(chave, round2(v));
  }
  return out;
}

// Gorjeta integral (a mesma da folha de líquidos) de cada mês da janela. Decisão do Eli (19/11/2026): se o mês tem apuração
// no sistema, vale a apuração; o valor informado à mão só PREENCHE mês sem apuração (ou com apuração indisponível).
async function mesesDaGorjeta(
  janela: ReadonlyArray<{ ano: number; mes: number; chave: string }>, informadas: ReadonlyMap<string, number>, employeeId: string, avisos: string[],
): Promise<MesDaGorjeta[]> {
  // Em paralelo: são até 12 apurações da casa inteira.
  return Promise.all(janela.map(async (m): Promise<MesDaGorjeta> => {
    const info = informadas.get(m.chave);
    const informado = (): MesDaGorjeta => (info != null ? { chave: m.chave, valor: info, origem: "INFORMADA" } : { chave: m.chave, valor: null, origem: "AUSENTE" });
    try {
      const g = gorjetaDaPessoa(await gorjetasDaCompetencia(m.ano, m.mes), employeeId);
      if (g == null) return informado();
      if (info != null) avisos.push(`${m.chave}: há apuração no sistema, então o valor informado à mão (${reais(info)}) foi ignorado.`);
      // Fora do período ou paga na rescisão conta como zero naquele mês (mesma regra da folha de líquidos).
      return { chave: m.chave, valor: g.noPeriodo && !g.pagoNaRescisao ? round2(g.gorjetaLiquida) : 0, origem: "APURACAO" };
    } catch (err) {
      console.error(`[ferias-combinado] apuração de ${chaveDoMes(m.ano, m.mes)} falhou`, err);
      avisos.push(`Não foi possível calcular a gorjeta de ${chaveDoMes(m.ano, m.mes)} (apuração indisponível): faturamento indisponível ou erro interno; ${info != null ? "valeu o valor informado à mão" : "o mês ficou fora da média"}.`);
      return informado();
    }
  }));
}

export async function somarCombinadoAFerias(a: {
  payrollItemId: string; aplicar: boolean; usuario: { id: string; name: string }; informadas?: Record<string, unknown>;
}): Promise<ResultadoFeriasCombinado> {
  const i = await prisma.payrollItem.findFirst({
    where: { id: a.payrollItemId, type: "FERIAS", deletedAt: null, status: { not: "CANCELED" } },
    select: { id: true, employeeId: true, amount: true, status: true, paymentDate: true, periodStart: true, details: true, employee: { select: { firstName: true, lastName: true } } },
  });
  if (!i) throw new RecusaFerias(404, "Título de férias não encontrado.");
  const nome = `${i.employee.firstName} ${i.employee.lastName}`.trim();
  if (i.paymentDate != null || i.status === "PAID") throw new RecusaFerias(409, `O título de férias de ${nome} já foi pago: não é alterado.`);
  const liquido = liquidoDoRecibo(i.details);
  if (liquido == null) throw new RecusaFerias(422, "Este título de férias não veio do recibo da contabilidade (sem o líquido do recibo): não dá para calcular o complemento.");
  if (!i.periodStart) throw new RecusaFerias(422, "O título de férias não tem o início do gozo.");

  const atual = round2(Number(i.amount));
  const jaSomado = foiSomadoAFerias(i.details);
  const esperado = jaSomado ? round2(liquido + (complementoSomadoAFerias(i.details) ?? 0)) : round2(liquido);
  if (Math.abs(atual - esperado) >= 0.01) {
    throw new RecusaFerias(409, `O valor do título (${reais(atual)}) foi ajustado à mão e difere do esperado (${reais(esperado)}): confira antes de somar.`);
  }

  const anoGozo = i.periodStart.getUTCFullYear(), mesGozo = i.periodStart.getUTCMonth() + 1;
  const combinado = (await mapaCombinados(anoGozo, mesGozo, [i.employeeId])).get(i.employeeId) ?? null;
  const avisos: string[] = [];
  const janela = janelaDeMeses(anoGozo, mesGozo);
  const informadas = new Map<string, number>([
    ...Object.entries(informadasGuardadas(i.details)), ...validarInformadas(a.informadas, new Set(janela.map((m) => m.chave))),
  ]);
  const previaBase = { payrollItemId: i.id, employeeId: i.employeeId, nome, liquidoRecibo: liquido, valorAntes: atual };

  let novo: { valor: number; details: Record<string, unknown> };
  let previa: PreviaFeriasCombinado;
  if (combinado == null) {
    if (!jaSomado) throw new RecusaFerias(422, `${nome} não tem salário combinado vigente em ${String(mesGozo).padStart(2, "0")}/${anoGozo}: não há o que somar.`);
    avisos.push("Sem salário combinado vigente: a soma anterior será desfeita e o título volta ao líquido do recibo.");
    novo = { valor: round2(liquido), details: semMarcasDoFeriasCombinado(i.details) };
    previa = { ...previaBase, combinado: null, mediaGorjeta: 0, mesesContados: 0, mesesAusentes: [], meses: [], remuneracao: 0, complemento: 0, valorDepois: novo.valor, formula: null, avisos };
  } else {
    const meses = await mesesDaGorjeta(janela, informadas, i.employeeId, avisos);
    const media = mediaDaGorjeta(meses);
    if (media.mesesAusentes.length > 0) {
      avisos.push(`${media.mesesAusentes.length} mês(es) sem apuração nem valor informado (${media.mesesAusentes.join(", ")}): não entram na média. Informe à mão se houve gorjeta.`);
    }
    const dias = diasDoRecibo(i.details);
    if (dias < 30) avisos.push(`Recibo de ${dias} dias de gozo: a remuneração foi proporcional a ${dias}/30. Se houver abono pecuniário, confira o valor.`);
    const calc = complementoDeFerias({ combinado, mediaGorjeta: media.media, liquidoRecibo: liquido, dias });
    if (calc.negativo) avisos.push("O líquido do recibo já é maior que a remuneração devida pela fórmula: nada a somar.");
    const soma = valorFeriasComCombinado({ liquidoRecibo: liquido, calc, combinado, media, meses, dias });
    novo = calc.complemento > 0
      ? { valor: soma.valor, details: { ...semMarcasDoFeriasCombinado(i.details), ...soma.detalhes } }
      : { valor: round2(liquido), details: semMarcasDoFeriasCombinado(i.details) };
    previa = {
      ...previaBase, combinado, mediaGorjeta: media.media, mesesContados: media.mesesContados, mesesAusentes: media.mesesAusentes, meses,
      remuneracao: calc.remuneracao, complemento: calc.complemento, valorDepois: novo.valor, formula: soma.detalhes.feriasCombinado.formula, avisos,
    };
    if (calc.complemento <= 0 && !jaSomado) return { aplicado: false, previa, motivo: "Nada a somar." };
  }

  if (!a.aplicar) return { aplicado: false, previa };
  try {
    await assertPeriodWritableForDate(i.periodStart, "Complemento do salário combinado nas férias");
  } catch (e) {
    throw new RecusaFerias(400, e instanceof Error ? e.message : "Período fechado.");
  }
  // Condicionado ao estado lido: se alguém pagou, excluiu ou mexeu no valor no meio, não grava.
  const r = await prisma.payrollItem.updateMany({
    where: { id: i.id, deletedAt: null, paymentDate: null, amount: i.amount },
    data: { amount: novo.valor, details: novo.details as Prisma.InputJsonValue, updatedById: a.usuario.id },
  });
  if (r.count === 0) return { aplicado: false, previa, motivo: "O título mudou durante o cálculo (pago, excluído ou editado): nada foi gravado." };
  await auditLog({
    userId: a.usuario.id, action: "FERIAS_COMBINADO_SOMADO", entity: "PayrollItem", entityId: i.id,
    previousValue: { amount: atual }, newValue: { amount: novo.valor, complemento: previa.complemento, combinado, mediaGorjeta: previa.mediaGorjeta },
  }).catch((e) => console.error("[ferias-combinado] auditoria falhou", e));
  return { aplicado: true, previa };
}
