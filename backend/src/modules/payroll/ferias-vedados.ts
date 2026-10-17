// Dias em que as férias NÃO podem começar (CLT art. 134, § 3º): o feriado, o dia de repouso
// semanal remunerado e os dois dias que antecedem qualquer um dos dois. O repouso é o dia da
// semana em que a pessoa costuma folgar na escala (domingo quando a escala não diz); se o
// repouso é domingo, ficam vedados também sexta e sábado. Feriados: os de São Paulo (capital).
import { holidaysForYear } from "./holidays.js";
import { somarDias } from "./ferias-calc.js";

const NOMES_DIA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const diaDaSemana = (iso: string) => new Date(Date.parse(`${iso}T00:00:00.000Z`)).getUTCDay();

/** "AAAA-MM-DD" -> nome do feriado, para todos os dias do intervalo (inclusive as pontas). */
export function feriadosEntre(inicio: string, fim: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (let ano = Number(inicio.slice(0, 4)); ano <= Number(fim.slice(0, 4)); ano++) {
    for (const [mmdd, nome] of holidaysForYear(ano)) {
      const dia = `${ano}-${mmdd}`;
      if (dia >= inicio && dia <= fim) resultado[dia] = nome;
    }
  }
  return resultado;
}

const DOMINGO = [0];

/** Por que as férias não podem começar nesta data; null quando podem. `repousos`: dias da semana (0 = domingo) de repouso. */
export function motivoInicioVedado(dia: string, feriados: Record<string, string>, repousos: number[] = DOMINGO): string | null {
  if (Number.isNaN(Date.parse(`${dia}T00:00:00.000Z`))) return null; // a rota já recusa data inválida antes
  if (feriados[dia]) return `${feriados[dia]} é feriado`;
  const semana = diaDaSemana(dia);
  if (repousos.includes(semana)) return `${NOMES_DIA[semana]} é o dia de repouso semanal`;
  for (const adiante of [1, 2]) {
    const depois = somarDias(dia, adiante);
    if (feriados[depois]) return `faltam ${adiante === 1 ? "1 dia" : "2 dias"} para o feriado ${feriados[depois]}`;
    const repouso = diaDaSemana(depois);
    if (repousos.includes(repouso)) return `${NOMES_DIA[semana]} está a ${adiante === 1 ? "1 dia" : "2 dias"} do repouso semanal (${NOMES_DIA[repouso]})`;
  }
  return null;
}

const SEMANAS_OBSERVADAS = 12;
const MIN_FOLGAS_PARA_CONCLUIR = 4;

/**
 * O(s) dia(s) de repouso da pessoa, lidos das folgas da escala nas últimas semanas: o dia da semana
 * em que ela mais folga (dois dias, no 5x2). Sem folgas suficientes ou sem um dia que se destaque,
 * volta ao domingo, e `inferido` fica falso para a tela dizer que é a regra padrão.
 */
export function repousoDaPessoa(folgas: string[], doisDias: boolean): { repousos: number[]; inferido: boolean } {
  const contagem = new Array<number>(7).fill(0);
  for (const dia of folgas) contagem[diaDaSemana(dia)] += 1;
  const ordem = contagem.map((n, semana) => ({ n, semana })).sort((a, b) => b.n - a.n || a.semana - b.semana);
  const quantos = doisDias ? 2 : 1;
  const escolhidos = ordem.slice(0, quantos).filter((x) => x.n >= MIN_FOLGAS_PARA_CONCLUIR);
  const proximo = ordem[quantos];
  const claro = escolhidos.length === quantos && (!proximo || proximo.n * 2 <= escolhidos[escolhidos.length - 1].n);
  return claro ? { repousos: escolhidos.map((x) => x.semana).sort((a, b) => a - b), inferido: true } : { repousos: DOMINGO, inferido: false };
}

export const SEMANAS_DE_ESCALA_LIDAS = SEMANAS_OBSERVADAS;

