// Dias de férias que a grade da Escala sombreia. Duas origens:
//   FOLHA        — férias já lançadas na folha (PayrollItem FERIAS);
//   PROGRAMACAO  — férias combinadas em RH > Férias (FeriasProgramacao), mesmo antes de irem para a folha.
// Se o mesmo dia está nas duas, vale a FOLHA (é o lançamento definitivo).

export type OrigemDasFerias = "FOLHA" | "PROGRAMACAO";
export type DiaDeFerias = { employeeId: string; day: number; origem: OrigemDasFerias };
export type IntervaloDeFerias = { employeeId: string; inicio: Date; fim: Date };

const DIA_MS = 86_400_000;
/** Fim do gozo (inclusive) de uma programação: início + dias − 1. */
export const fimDoGozo = (inicio: Date, dias: number): Date => new Date(inicio.getTime() + (dias - 1) * DIA_MS);

export function diasDeFeriasNoMes(folha: IntervaloDeFerias[], programadas: IntervaloDeFerias[], monthStart: Date, nextMonthStart: Date): DiaDeFerias[] {
  const ultimoDia = new Date(nextMonthStart.getTime() - DIA_MS);
  const dias = new Map<string, DiaDeFerias>();
  const somar = (intervalos: IntervaloDeFerias[], origem: OrigemDasFerias) => {
    for (const f of intervalos) {
      if (f.fim < monthStart || f.inicio > ultimoDia) continue;
      const de = f.inicio < monthStart ? monthStart : f.inicio;
      const ate = f.fim > ultimoDia ? ultimoDia : f.fim;
      for (let dia = de.getUTCDate(); dia <= ate.getUTCDate(); dia++) {
        const chave = `${f.employeeId}|${dia}`;
        if (!dias.has(chave)) dias.set(chave, { employeeId: f.employeeId, day: dia, origem });
      }
    }
  };
  somar(folha, "FOLHA");
  somar(programadas, "PROGRAMACAO");
  return [...dias.values()];
}
