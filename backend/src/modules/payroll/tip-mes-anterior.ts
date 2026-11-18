// O mês anterior da gorjeta, lido do retrato do último fechamento vigente (o que foi pago de fato).
// Mês anterior ainda aberto, reaberto ou sem fechamento: não há com o que comparar (null).
import { prisma } from "../../config/database.js";

export type AnteriorDaPessoa = {
  gorjeta: number;
  pontosBase: number;
  pontosApurados: number;
  diasComputados: number;
  diasReferencia: number;
  funcao: string | null;
  // Retratos antigos podem não ter: sem o dado, a comparação segue.
  tipo: string | null;
  tipoCalculo: string | null;
};

export type TipMesAnterior = {
  year: number;
  month: number;
  label: string;
  valorPonto: number | null;
  porPessoa: Record<string, AnteriorDaPessoa>;
};

type Retrato = { params: unknown; totals: unknown; participants: unknown };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function competenciaAnterior(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// Retratos antigos podem faltar campos: o que não der para ler fica de fora, sem inventar zero.
export function anteriorDoRetrato(year: number, month: number, retrato: Retrato): TipMesAnterior | null {
  const params = (retrato.params ?? {}) as { label?: unknown };
  const totals = (retrato.totals ?? {}) as { pointValue?: unknown };
  const porPessoa: Record<string, AnteriorDaPessoa> = {};
  for (const bruto of Array.isArray(retrato.participants) ? retrato.participants : []) {
    const p = (bruto ?? {}) as Record<string, unknown>;
    const gorjeta = num(p.gorjeta);
    if (typeof p.employeeId !== "string" || gorjeta == null || p.foraDaGorjeta === true) continue;
    porPessoa[p.employeeId] = {
      gorjeta,
      pontosBase: num(p.pontosBase) ?? 0,
      pontosApurados: num(p.pontosApurados) ?? 0,
      diasComputados: num(p.diasComputados) ?? 0,
      diasReferencia: num(p.diasReferencia) ?? 0,
      funcao: typeof p.funcao === "string" ? p.funcao : null,
      tipo: typeof p.tipo === "string" ? p.tipo : null,
      tipoCalculo: typeof p.tipoCalculo === "string" ? p.tipoCalculo : null,
    };
  }
  // Nenhuma pessoa legível: melhor sem comparação do que marcar todo mundo como novo.
  if (Object.keys(porPessoa).length === 0) return null;
  return { year, month, label: typeof params.label === "string" ? params.label : `${String(month).padStart(2, "0")}/${year}`, valorPonto: num(totals.pointValue), porPessoa };
}

export async function carregarMesAnterior(year: number, month: number): Promise<TipMesAnterior | null> {
  const ant = competenciaAnterior(year, month);
  const fechamento = await prisma.tipPeriodClosing.findFirst({
    where: { competenceYear: ant.year, competenceMonth: ant.month, reopenedAt: null },
    orderBy: { version: "desc" },
    select: { params: true, totals: true, participants: true },
  });
  return fechamento ? anteriorDoRetrato(ant.year, ant.month, fechamento) : null;
}
