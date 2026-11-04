// O Ponto alimenta a apuração: faltas (coluna Faltas da gorjeta e salário) e hora extra / adicional noturno (lista de pagamento).
// Só entra mês com o Ponto FECHADO; o que for digitado na apuração continua valendo mais.

import { prisma } from "../../config/database.js";
import { pontoFechadoDoMes, type PontoFechadoDaPessoa } from "./ponto.service.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Meses (ano, mês) que o intervalo toca. */
function mesesDoIntervalo(ini: Date, fim: Date): Array<[number, number]> {
  const meses: Array<[number, number]> = [];
  let ano = ini.getUTCFullYear();
  let mes = ini.getUTCMonth() + 1;
  while (ano < fim.getUTCFullYear() || (ano === fim.getUTCFullYear() && mes <= fim.getUTCMonth() + 1)) {
    meses.push([ano, mes]);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

export interface PontoDaApuracao {
  /**
   * Dias de falta no intervalo: os que a Escala já marca como FALTA mais os que o Ponto fechado apurou, sem repetir.
   * null = a pessoa não tem nenhum mês de Ponto fechado no intervalo (vale só a Escala).
   */
  faltas(employeeId: string, ini: Date, fim: Date): number | null;
  /** Hora extra paga em folha e adicional noturno do mês do salário; null = Ponto do mês não fechado para a pessoa. */
  horas(employeeId: string): { horaExtraMin: number; noturnoMin: number } | null;
}

/** Junta o Ponto fechado e a Escala para o ciclo da gorjeta e para o mês civil do salário. */
export async function carregarPontoDaApuracao(
  employeeIds: string[],
  intervalos: Array<{ ini: Date; fim: Date }>,
  mesDoSalario: { year: number; month: number },
): Promise<PontoDaApuracao> {
  const porMes = new Map<string, Map<string, PontoFechadoDaPessoa>>();
  const chaves = new Set<string>([`${mesDoSalario.year}-${mesDoSalario.month}`]);
  for (const { ini, fim } of intervalos) for (const [a, m] of mesesDoIntervalo(ini, fim)) chaves.add(`${a}-${m}`);
  for (const chave of chaves) {
    const [a, m] = chave.split("-").map(Number);
    porMes.set(chave, await pontoFechadoDoMes(a, m));
  }

  const inicio = intervalos.reduce((x, i) => (i.ini < x ? i.ini : x), intervalos[0].ini);
  const fim = intervalos.reduce((x, i) => (i.fim > x ? i.fim : x), intervalos[0].fim);
  const marcas = employeeIds.length === 0 ? [] : await prisma.employeeScheduleDay.findMany({
    where: { employeeId: { in: employeeIds }, type: "FALTA", date: { gte: inicio, lte: fim } },
    select: { employeeId: true, date: true },
  });
  const faltasDaEscala = new Map<string, Set<string>>();
  for (const x of marcas) faltasDaEscala.set(x.employeeId, (faltasDaEscala.get(x.employeeId) ?? new Set<string>()).add(iso(x.date)));

  return {
    faltas(employeeId, ini, limite) {
      const de = iso(ini);
      const ate = iso(limite);
      const dias = new Set([...(faltasDaEscala.get(employeeId) ?? [])].filter((d) => d >= de && d <= ate));
      let temFechado = false;
      for (const [a, m] of mesesDoIntervalo(ini, limite)) {
        const ponto = porMes.get(`${a}-${m}`)?.get(employeeId);
        if (!ponto) continue;
        temFechado = true;
        for (const d of ponto.faltaDias) if (d >= de && d <= ate) dias.add(d);
      }
      return temFechado ? dias.size : null;
    },
    horas(employeeId) {
      const ponto = porMes.get(`${mesDoSalario.year}-${mesDoSalario.month}`)?.get(employeeId);
      return ponto ? { horaExtraMin: ponto.extraAPagarMin, noturnoMin: ponto.noturnoMin } : null;
    },
  };
}
