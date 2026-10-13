// Regras do aviso de desperdício por WhatsApp, sem banco nem rede.

type EntradaDoAlerta = {
  /** Limite diário em R$; `null` ou 0 = alerta desligado. */
  limite: number | null;
  /** Valor desperdiçado no dia do lançamento, sem os cancelados. */
  totalDoDia: number;
  diaDoLancamento: string;
  /** Hoje em São Paulo (AAAA-MM-DD). */
  hoje: string;
  /** Último dia em que o aviso foi enviado. */
  ultimoAlerta: string | null;
};

/**
 * Um aviso por dia, e só para o dia corrente: lançamento de dia que já passou (retroativo) não
 * acorda ninguém por algo que não dá mais para evitar.
 */
export function decidirAlerta(e: EntradaDoAlerta): boolean {
  if (e.limite == null || !(e.limite > 0)) return false;
  if (e.diaDoLancamento !== e.hoje) return false;
  if (e.totalDoDia < e.limite) return false;
  return e.ultimoAlerta !== e.hoje;
}

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function mensagemDoAlerta(e: { total: number; limite: number; lancamentos: number; principalMotivo: string | null }): string {
  const lancamentos = `${e.lancamentos} ${e.lancamentos === 1 ? "lançamento" : "lançamentos"}`;
  const motivo = e.principalMotivo ? `, principalmente ${e.principalMotivo.toLowerCase()}` : "";
  return [
    "⚠️ Desperdício de hoje passou do limite",
    `${reais.format(e.total)} em ${lancamentos}${motivo} (limite diário ${reais.format(e.limite)}).`,
    "Veja o detalhe em Estoque › Desperdício.",
  ].join("\n");
}
