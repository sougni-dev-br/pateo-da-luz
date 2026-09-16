// A que ciclo uma contagem pertence.
//
// O restaurante nao fecha o CMV por competencia estrita: a contagem que encerra
// o ciclo cai nos primeiros dias do mes seguinte sempre que o ultimo dia esta
// ocupado. Em agosto/2026 houve evento no dia 31 e o ciclo so foi contado em 01
// e 02/09 — as sete contagens nasceram marcadas como ciclo 9/2026, e agosto
// ficou sem inventario final.
//
// Por isso o ciclo e um campo proprio, e nao o mes da data: quem conta no dia 02
// esta quase sempre fechando o mes que acabou.

/** Ate que dia do mes uma contagem ainda e, por padrao, do ciclo anterior. */
export const DIAS_DE_VIRADA = 5;

export type Ciclo = { mes: number; ano: number };

/**
 * O ciclo que a tela sugere para uma data. Nos primeiros dias do mes a aposta e
 * o mes que acabou; do dia 6 em diante, o proprio mes.
 *
 * E so um padrao — a tela deixa trocar, porque contagem no dia 02 para o proprio
 * mes existe (uma conferencia pontual, por exemplo).
 */
export function cicloSugerido(dataIso: string): Ciclo {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  if (!ano || !mes || !dia) {
    const hoje = new Date();
    return { mes: hoje.getMonth() + 1, ano: hoje.getFullYear() };
  }
  if (dia > DIAS_DE_VIRADA) return { mes, ano };
  return mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano };
}

/** true quando o ciclo escolhido nao e o mes da propria data — a tela avisa. */
export function cicloDivergeDaData(dataIso: string, ciclo: Ciclo): boolean {
  const [ano, mes] = dataIso.split("-").map(Number);
  return ciclo.ano !== ano || ciclo.mes !== mes;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function rotuloDoCiclo(ciclo: Ciclo): string {
  return `${MESES[ciclo.mes - 1] ?? ciclo.mes}/${ciclo.ano}`;
}

/** Opcoes do seletor: o mes da data e os dois anteriores, que cobrem o uso real. */
export function opcoesDeCiclo(dataIso: string): Ciclo[] {
  const [ano, mes] = dataIso.split("-").map(Number);
  if (!ano || !mes) return [];
  const base = { mes, ano };
  const anterior = mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano };
  const retrasado = anterior.mes === 1 ? { mes: 12, ano: anterior.ano - 1 } : { mes: anterior.mes - 1, ano: anterior.ano };
  return [base, anterior, retrasado];
}
