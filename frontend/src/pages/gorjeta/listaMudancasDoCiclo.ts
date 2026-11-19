import type { TipMudanca } from "../../api/client";
import { pts } from "./gorjetaUtils";

// Mudanças de função e pontos que valem dentro do ciclo da gorjeta, para quem fecha o mês ver o
// que mexeu no cálculo sem abrir o histórico de cada pessoa. A situação inicial (primeiro
// registro da pessoa) não é mudança.
export type MudancaDoCiclo = TipMudanca & {
  /** Registrada depois do fim do ciclo (com vigência dentro dele): vale conferir com quem lançou. */
  retroativa: boolean;
  /** "Promoção: 3,5 → 4 pts" / "Troca de função: Garçom → Cumim" / "Entrou na gorjeta". */
  resumo: string;
};

const dia = (iso: string) => iso.slice(0, 10);
const DIA_LOCAL = "America/Sao_Paulo";
// O dia em que a mudança foi digitada, no fuso de quem usa (a hora vem em UTC).
const diaLocal = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: DIA_LOCAL });

function resumoDe(m: TipMudanca): string {
  switch (m.tipo) {
    case "ENTRADA": return "Entrou na gorjeta";
    case "SAIDA": return "Saiu da gorjeta";
    case "TROCA_DE_FUNCAO":
      return `Troca de função: ${m.funcaoAntes ?? "sem função"} → ${m.funcaoDepois ?? "sem função"}${m.baseAntes != null && m.baseDepois != null ? ` (${pts(m.baseAntes)} → ${pts(m.baseDepois)} pts)` : ""}`;
    case "PROMOCAO": return `Promoção: ${pts(m.baseAntes ?? 0)} → ${pts(m.baseDepois ?? 0)} pts`;
    case "REDUCAO": return `Redução: ${pts(m.baseAntes ?? 0)} → ${pts(m.baseDepois ?? 0)} pts`;
    default: return "Alteração no cadastro da gorjeta";
  }
}

export function mudancasDoCiclo(mudancas: TipMudanca[], periodStart: string, periodEnd: string): MudancaDoCiclo[] {
  const ini = dia(periodStart);
  const fim = dia(periodEnd);
  return mudancas
    .filter((m) => m.tipo !== "INICIAL" && dia(m.validFrom) >= ini && dia(m.validFrom) <= fim)
    .map((m) => ({ ...m, retroativa: diaLocal(m.registradoEm) > fim, resumo: resumoDe(m) }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR") || a.validFrom.localeCompare(b.validFrom));
}
