import { useFormatCurrency } from "../design-system";
import { displayChannel } from "./revenueBits";
import { REVENUE_CHANNELS } from "./revenueAnalytics";
import type { DaySeriesPoint } from "./revenueGroups";

const MIN_POINTS = 2;
const LABEL_EVERY_FROM = 16;
const MAX_LABELS = 12;

const shortDate = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/**
 * Líquido por dia em barras, empilhado por canal quando há mais de um. A linha tracejada é a média dos dias
 * com movimento (mesma convenção do gráfico da Análise do Salão). Menos de 2 dias não tem o que comparar.
 */
export function RevenueDailyChart({ series }: { series: DaySeriesPoint[] }) {
  const fmt = useFormatCurrency();
  const max = Math.max(...series.map((point) => point.total), 0);
  if (series.length < MIN_POINTS || max <= 0) return null;

  const channels = REVENUE_CHANNELS.filter((channel) => series.some((point) => (point.byChannel[channel] ?? 0) > 0));
  const average = series.reduce((sum, point) => sum + point.total, 0) / series.length;
  const labelStep = series.length >= LABEL_EVERY_FROM ? Math.ceil(series.length / MAX_LABELS) : 1;
  const best = series.reduce((a, b) => (b.total > a.total ? b : a));
  const worst = series.reduce((a, b) => (b.total < a.total ? b : a));
  const summary = `Líquido por dia, de ${shortDate(series[0].date)} a ${shortDate(series[series.length - 1].date)}. Média ${fmt(average)}. Maior: ${shortDate(best.date)}, ${fmt(best.total)}. Menor: ${shortDate(worst.date)}, ${fmt(worst.total)}.`;

  return (
    <figure className="revenue-chart">
      <figcaption>
        <ul className="revenue-chart-legend">
          {channels.map((channel, index) => (
            <li key={channel}>
              <i className={`revenue-chart-swatch revenue-chart-seg--${index % 4}`} aria-hidden="true" />
              {displayChannel(channel)}
            </li>
          ))}
          <li>
            <i className="revenue-chart-swatch revenue-chart-swatch--media" aria-hidden="true" />
            média dos dias com movimento ({fmt(average)})
          </li>
        </ul>
      </figcaption>
      <div className="revenue-chart-plot" role="img" aria-label={summary}>
        <span className="revenue-chart-media" style={{ bottom: `${(average / max) * 100}%` }} aria-hidden="true" />
        {series.map((point) => (
          <div key={point.date} className="revenue-chart-col" title={`${shortDate(point.date)} — ${fmt(point.total)}`}>
            <div className="revenue-chart-bar" style={{ height: `${Math.max((point.total / max) * 100, 2)}%` }}>
              {channels.map((channel, index) => {
                const value = point.byChannel[channel] ?? 0;
                return value > 0 ? (
                  <span key={channel} className={`revenue-chart-seg revenue-chart-seg--${index % 4}`} style={{ flexGrow: value }} />
                ) : null;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="revenue-chart-days" aria-hidden="true">
        {series.map((point, index) => (
          <span key={point.date}>{index % labelStep === 0 ? point.date.slice(8, 10) : ""}</span>
        ))}
      </div>
    </figure>
  );
}
