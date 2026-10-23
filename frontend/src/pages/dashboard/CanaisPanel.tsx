import { Money } from "../../design-system";
import { formatPercent } from "../../utils/format";
import type { DashboardChannelRevenue } from "../../api/client";

const diaMes = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

export type SituacaoDoLancamento = { texto: string; tone: "ok" | "late" | "none" };

/**
 * Último lançamento do canal em texto. "Atrasado" só vem do servidor no mês corrente;
 * em mês passado a linha mostra apenas o último dia lançado.
 */
export function descreverUltimoLancamento(canal: DashboardChannelRevenue): SituacaoDoLancamento {
  if (canal.ultimoDia) {
    const quando = `Último lançamento ${diaMes(canal.ultimoDia)}`;
    if (canal.situacao === "ATRASADO") {
      const dias = canal.diasDesdeUltimo;
      return { texto: `${quando} · atrasado${dias ? ` há ${dias} dias` : ""}`, tone: "late" };
    }
    return { texto: quando, tone: "ok" };
  }
  if (canal.diaFuturo) {
    return { texto: `Lançamento mensal parcial, gravado em ${diaMes(canal.diaFuturo)}`, tone: canal.situacao === "ATRASADO" ? "late" : "ok" };
  }
  return { texto: "Sem lançamento neste mês", tone: "none" };
}

/**
 * O total do mês aberto nos canais: sem isso, um canal parado só aparecia como um total menor.
 * A soma dos canais fecha com o líquido do card (as linhas fora dos quatro canais vão em "Outros").
 */
export function CanaisPanel({ channels }: { channels: DashboardChannelRevenue[] }) {
  const maior = Math.max(...channels.map((c) => c.netAmount), 0);
  return (
    <section className="dash-card dash-canais" aria-labelledby="dash-canais-title">
      <h2 id="dash-canais-title" className="dash-eyebrow">Faturamento por canal</h2>
      <ul className="dash-canais-list">
        {channels.map((canal) => {
          const situacao = descreverUltimoLancamento(canal);
          return (
            <li key={canal.canal} className="dash-canal-row">
              <span className="dash-canal-name">{canal.canal}</span>
              <span className="dash-canal-value">
                {canal.count > 0 ? <Money value={canal.netAmount} /> : "—"}
              </span>
              <span className="dash-canal-share">{canal.sharePercent !== null && canal.count > 0 ? formatPercent(canal.sharePercent) : ""}</span>
              <span className="dash-canal-track" aria-hidden>
                <span className="dash-canal-fill" style={{ width: maior > 0 ? `${Math.max((canal.netAmount / maior) * 100, 0)}%` : "0%" }} />
              </span>
              <span className={`dash-canal-status dash-canal-status--${situacao.tone}`}>{situacao.texto}</span>
            </li>
          );
        })}
      </ul>
      <p className="dash-footnote">Faturamento líquido de cada canal na competência. Canal sem lançamento recente costuma ser dado que ainda não entrou.</p>
    </section>
  );
}
