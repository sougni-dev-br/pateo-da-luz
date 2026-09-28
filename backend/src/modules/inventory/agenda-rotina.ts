// Rotina do estoquista: a agenda diz o que contar em cada dia, e a contagem
// de verdade acontece numa sessao de contagem ligada ao dia da agenda.
// O status do dia e derivado da sessao na leitura — nao ha um segundo status
// para manter em sincronia quando a sessao e concluida, reaberta ou cancelada.

export type StatusDaRotina = "FEITA" | "EM_ANDAMENTO" | "ATRASADA" | "HOJE" | "PREVISTA";

const DIA_MS = 24 * 60 * 60 * 1000;

// Semana de segunda a domingo; `fim` e exclusivo.
export function semanaDaData(data: Date) {
  const base = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const diasDesdeSegunda = (base.getDay() + 6) % 7;
  const inicio = new Date(base.getFullYear(), base.getMonth(), base.getDate() - diasDesdeSegunda);
  const fim = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 7);
  return { inicio, fim };
}

export function statusDaRotina(dataAgendada: Date, hoje: Date, statusDaSessao: string | null): StatusDaRotina {
  if (statusDaSessao === "CONCLUIDA") return "FEITA";
  if (statusDaSessao === "ABERTA" || statusDaSessao === "EM_ANDAMENTO") return "EM_ANDAMENTO";
  const diferenca = Math.round((diaSemHora(dataAgendada) - diaSemHora(hoje)) / DIA_MS);
  if (diferenca < 0) return "ATRASADA";
  if (diferenca === 0) return "HOJE";
  return "PREVISTA";
}

function diaSemHora(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
}
