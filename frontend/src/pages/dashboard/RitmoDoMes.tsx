import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useFormatCurrency, useHideValues } from "../../design-system";
import { cumulative, type RevenueDay, type RevenueKey } from "./logic";

type Props = {
  current: RevenueDay[];
  previous: RevenueDay[];
  daysInMonth: number;
  /** Dias do mês anterior — a linha dele vai até o fim, mesmo em fevereiro. */
  previousDaysInMonth: number;
  /** Até que dia desenhar a linha do mês (hoje, no mês em andamento). */
  currentUntil: number;
  currentLabel: string;
  previousLabel: string;
  valueKey?: RevenueKey;
};

const HEIGHT = 168;
const PAD = { top: 12, right: 12, bottom: 22, left: 52 };

function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(value) >= 1_000) return `R$ ${Math.round(value / 1_000).toLocaleString("pt-BR")} mil`;
  return `R$ ${Math.round(value)}`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value / 4) ?? 10;
  return Math.ceil(value / (step * magnitude)) * step * magnitude;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Faturamento acumulado do mês contra o mês anterior, dia a dia. Responde de
 * relance "estou à frente ou atrás do mês passado neste mesmo ponto?" — o que
 * o número solto do total não responde no meio do mês.
 */
export function RitmoDoMes({
  current, previous, daysInMonth: currentDays, previousDaysInMonth, currentUntil, currentLabel, previousLabel, valueKey = "netAmount",
}: Props) {
  const fmt = useFormatCurrency();
  const { hidden } = useHideValues();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const daysInMonth = Math.max(currentDays, previousDaysInMonth);
  const curPoints = useMemo(() => cumulative(current, valueKey, currentUntil), [current, valueKey, currentUntil]);
  const prevPoints = useMemo(() => cumulative(previous, valueKey, previousDaysInMonth), [previous, valueKey, previousDaysInMonth]);

  const maxValue = niceMax(Math.max(curPoints[curPoints.length - 1]?.value ?? 0, prevPoints[prevPoints.length - 1]?.value ?? 0));
  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + ((day - 1) / Math.max(daysInMonth - 1, 1)) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / maxValue) * plotH;
  const path = (points: { day: number; value: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const ticks = [0, 0.5, 1].map((f) => f * maxValue);
  const dayTicks = [1, 10, 20, currentDays];

  function dayFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - PAD.left) / plotW;
    return Math.min(Math.max(Math.round(ratio * (daysInMonth - 1)) + 1, 1), daysInMonth);
  }

  function handleKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setHoverDay((d) => Math.min(Math.max((d ?? currentUntil) + step, 1), daysInMonth));
  }

  const hoverCur = hoverDay !== null ? curPoints[hoverDay - 1] : undefined;
  const hoverPrev = hoverDay !== null ? prevPoints[hoverDay - 1] : undefined;
  const lastCur = curPoints[curPoints.length - 1];
  const tooltipLeft = hoverDay !== null ? Math.min(Math.max(x(hoverDay), 90), width - 90) : 0;

  return (
    <figure className="dash-ritmo">
      <figcaption className="dash-ritmo-legend">
        <span className="dash-ritmo-key dash-ritmo-key--current">{currentLabel}</span>
        <span className="dash-ritmo-key dash-ritmo-key--previous">{previousLabel}</span>
        <span className="dash-ritmo-hint">acumulado no mês</span>
      </figcaption>
      <div ref={wrapRef} className="dash-ritmo-plot">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Faturamento acumulado de ${currentLabel} comparado a ${previousLabel}. Use as setas para percorrer os dias.`}
            tabIndex={0}
            onPointerMove={(e) => setHoverDay(dayFromPointer(e))}
            onPointerLeave={() => setHoverDay(null)}
            onKeyDown={handleKey}
            onBlur={() => setHoverDay(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="dash-ritmo-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                {!hidden && (
                  <text className="dash-ritmo-axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{compactMoney(t)}</text>
                )}
              </g>
            ))}
            {dayTicks.map((d) => (
              <text key={d} className="dash-ritmo-axis" x={x(d)} y={HEIGHT - 6} textAnchor="middle">{d}</text>
            ))}
            <path className="dash-ritmo-line dash-ritmo-line--previous" d={path(prevPoints)} />
            {curPoints.length > 0 && <path className="dash-ritmo-line dash-ritmo-line--current" d={path(curPoints)} />}
            {lastCur && hoverDay === null && (
              <circle className="dash-ritmo-dot" cx={x(lastCur.day)} cy={y(lastCur.value)} r={4} />
            )}
            {hoverDay !== null && (
              <g pointerEvents="none">
                <line className="dash-ritmo-cross" x1={x(hoverDay)} x2={x(hoverDay)} y1={PAD.top} y2={PAD.top + plotH} />
                {hoverPrev && <circle className="dash-ritmo-dot dash-ritmo-dot--previous" cx={x(hoverDay)} cy={y(hoverPrev.value)} r={4} />}
                {hoverCur && <circle className="dash-ritmo-dot" cx={x(hoverDay)} cy={y(hoverCur.value)} r={4} />}
              </g>
            )}
          </svg>
        )}
        {hoverDay !== null && (
          <div className="dash-ritmo-tooltip" style={{ left: tooltipLeft }} aria-live="polite">
            <span className="dash-ritmo-tooltip-day">Até o dia {hoverDay}</span>
            <span className="dash-ritmo-tooltip-row dash-ritmo-key--current">
              <strong>{hoverCur ? fmt(hoverCur.value, { decimals: 0 }) : "—"}</strong> {currentLabel}
            </span>
            <span className="dash-ritmo-tooltip-row dash-ritmo-key--previous">
              <strong>{hoverPrev ? fmt(hoverPrev.value, { decimals: 0 }) : "—"}</strong> {previousLabel}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}
