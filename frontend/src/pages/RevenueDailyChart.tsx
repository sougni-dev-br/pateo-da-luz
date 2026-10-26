import { useFormatCurrency } from "../design-system";
import { displayChannel } from "./revenueBits";
import type { DaySeriesPoint } from "./revenueGroups";

type Props = { series: DaySeriesPoint[]; channelOrder: string[] };

const MIN_POINTS = 2;
const LABEL_EVERY_FROM = 16;

function dayNumber(ymd: string) {
  return ymd.slice(8, 10);
}

function shortDate(ymd: string) {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Líquido por dia, empilhado por canal. Com menos de 2 dias não há o que comparar, então não aparece. */
export function RevenueDailyChart({ series, channelOrder }: Props) {
  const fmt = useFormatCurrency();
  if (series.length < MIN_POINTS) return null;

  const max = Math.max(...series.map((point) => point.total), 0);
  if (max <= 0) return null;

  const channels = channelOrder.filter((channel) => series.some((point) => (point.byChannel[channel] ?? 0) > 0));
  const labelStep = series.length >= LABEL_EVERY_FROM ? Math.ceil(series.length / 12) : 1;
  const best = series.reduce((a, b) => (b.total > a.total ? b : a));
  const summary = `Líquido por dia, de ${shortDate(series[0].date)} a ${shortDate(series[series.length - 1].date)}. Melhor dia: ${shortDate(best.date)}, ${fmt(best.total)}.`;

  return (
    <figure className="revenue-chart">
      <figcaption>Líquido por dia</figcaption>
      <div className="revenue-chart-plot" role="img" aria-label={summary}>
        {series.map((point, index) => (
          <div
            key={point.date}
            className="revenue-chart-col"
            title={`${shortDate(point.date)} — ${fmt(point.total)}`}
          >
            <div className="revenue-chart-bar" style={{ height: `${Math.max((point.total / max) * 100, 2)}%` }}>
              {channels.map((channel, channelIndex) => {
                const value = point.byChannel[channel] ?? 0;
                if (value <= 0) return null;
                return (
                  <span
                    key={channel}
                    className={`revenue-chart-seg revenue-chart-seg--${channelIndex % 4}`}
                    style={{ flexGrow: value }}
                  />
                );
              })}
            </div>
            <span className="revenue-chart-label">{index % labelStep === 0 ? dayNumber(point.date) : ""}</span>
          </div>
        ))}
      </div>
      <ul className="revenue-chart-legend">
        {channels.map((channel, index) => (
          <li key={channel}>
            <span className={`revenue-chart-swatch revenue-chart-seg--${index % 4}`} aria-hidden="true" />
            {displayChannel(channel)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
