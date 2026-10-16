// Regras legais que a tela aplica antes de gravar (o servidor repete as que recusam).
// Datas em "AAAA-MM-DD" (UTC). `feriados` vem da API: dia → nome.
import { somaDias } from "./feriasFormato";

export type Feriados = Record<string, string>;

const NOMES_DIA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
/** "AAAA-MM-DD" que existe de verdade (o campo de data devolve coisas como "20266-10-16" enquanto se digita). */
export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}
export const diaDaSemana = (iso: string) => new Date(Date.parse(`${iso}T00:00:00.000Z`)).getUTCDay();
export const nomeDoDia = (iso: string) => NOMES_DIA[diaDaSemana(iso)];

/** Dias de aviso por escrito antes das férias (CLT, art. 135). */
export const DIAS_DE_AVISO = 30;
/** O pagamento das férias é feito até este número de dias antes do início (CLT, art. 145). */
export const DIAS_ANTES_PARA_PAGAR = 2;
export const MIN_DIAS_PARTE_MAIOR = 14;
export const MAX_PARTES = 3;

const dia = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);

const DOMINGO = [0];

/**
 * Por que as férias não podem começar nesta data (CLT, art. 134, § 3º): o feriado, o dia de repouso
 * semanal da pessoa (`repousos`, 0 = domingo) e os dois dias antes de qualquer um dos dois. null quando podem.
 */
export function motivoInicioVedado(inicio: string, feriados: Feriados, repousos: number[] = DOMINGO): string | null {
  if (!dataValida(inicio)) return null;
  if (feriados[inicio]) return `${feriados[inicio]} é feriado`;
  if (repousos.includes(diaDaSemana(inicio))) return `${nomeDoDia(inicio)} é o dia de repouso semanal`;
  for (const adiante of [1, 2]) {
    const depois = somaDias(inicio, adiante);
    if (feriados[depois]) return `faltam ${dia(adiante)} para o feriado ${feriados[depois]}`;
    if (repousos.includes(diaDaSemana(depois))) return `${nomeDoDia(inicio)} está a ${dia(adiante)} do repouso semanal (${nomeDoDia(depois)})`;
  }
  return null;
}

/** A própria data se puder; senão o primeiro dia permitido logo depois (no máximo 14 dias à frente). */
export function proximoInicioValido(inicio: string, feriados: Feriados, repousos: number[] = DOMINGO): string {
  for (let i = 0; i < 14; i++) {
    const candidato = somaDias(inicio, i);
    if (!motivoInicioVedado(candidato, feriados, repousos)) return candidato;
  }
  return inicio;
}

export const prazoParaPagar = (inicio: string) => somaDias(inicio, -DIAS_ANTES_PARA_PAGAR);
export const prazoParaAvisar = (inicio: string) => somaDias(inicio, -DIAS_DE_AVISO);

const NOMES_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** "dom e sáb" — para dizer na tela qual é o repouso considerado. */
export const repousosPorExtenso = (repousos: number[]) => repousos.map((n) => NOMES_CURTOS[n]).join(" e ");
