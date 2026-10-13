import type { AnalisePeriodo } from "../../api/client";

export type PresetPeriodo = "ultimos30" | "ultimos90" | "mesAtual" | "mesAnterior";

export const PRESETS: Array<{ value: PresetPeriodo; label: string }> = [
  { value: "ultimos30", label: "Últimos 30 dias" },
  { value: "ultimos90", label: "Últimos 90 dias" },
  { value: "mesAtual", label: "Mês atual" },
  { value: "mesAnterior", label: "Mês anterior" }
];

// Dia civil do usuário (não o UTC): às 22h de Brasília o "hoje" em UTC já é amanhã.
export function isoLocal(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

export function periodoDoPreset(preset: PresetPeriodo, hoje: Date): AnalisePeriodo {
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const recuar = (dias: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() - dias);
  switch (preset) {
    case "ultimos30":
      return { inicio: isoLocal(recuar(29)), fim: isoLocal(base) };
    case "ultimos90":
      return { inicio: isoLocal(recuar(89)), fim: isoLocal(base) };
    case "mesAtual":
      return { inicio: isoLocal(new Date(base.getFullYear(), base.getMonth(), 1)), fim: isoLocal(base) };
    case "mesAnterior":
      return {
        inicio: isoLocal(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
        fim: isoLocal(new Date(base.getFullYear(), base.getMonth(), 0))
      };
  }
}

// Mesmas regras do servidor (início <= fim, no máximo 366 dias); evita ida e volta à toa.
export function periodoValido({ inicio, fim }: AnalisePeriodo): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(inicio) || !re.test(fim)) return false;
  const de = Date.parse(`${inicio}T00:00:00Z`);
  const ate = Date.parse(`${fim}T00:00:00Z`);
  if (Number.isNaN(de) || Number.isNaN(ate) || ate < de) return false;
  // "2026-02-30" pode ser lido como 02/03 em vez de falhar: confere a data de ida e volta.
  if (new Date(de).toISOString().slice(0, 10) !== inicio || new Date(ate).toISOString().slice(0, 10) !== fim) return false;
  return (ate - de) / 86_400_000 + 1 <= 366;
}

export function pontos(razao: number): number {
  return razao * 100;
}
