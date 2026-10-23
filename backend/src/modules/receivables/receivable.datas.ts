// Datas de conta a receber são "dias de calendário" (yyyy-mm-dd), guardadas à meia-noite UTC.
// Nada aqui depende do fuso do servidor: o "hoje" é o de São Paulo e a conta é feita em UTC.

const DIA_MS = 24 * 60 * 60 * 1000;

export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function isDataIsoValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function diaDe(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function paraDataUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function diasEntre(deIso: string, ateIso: string): number {
  return Math.round((paraDataUtc(ateIso).getTime() - paraDataUtc(deIso).getTime()) / DIA_MS);
}

export function somarDias(iso: string, dias: number): string {
  return diaDe(new Date(paraDataUtc(iso).getTime() + dias * DIA_MS));
}

export function competenciaDe(data: Date): { year: number; month: number } {
  return { year: data.getUTCFullYear(), month: data.getUTCMonth() + 1 };
}

/** Primeiro dia do mês e primeiro dia do mês seguinte (fim exclusivo) para um dia yyyy-mm-dd. */
export function limitesDoMes(iso: string): { inicio: Date; fimExclusivo: Date } {
  const [ano, mes] = iso.split("-").map(Number);
  return { inicio: new Date(Date.UTC(ano, mes - 1, 1)), fimExclusivo: new Date(Date.UTC(ano, mes, 1)) };
}
