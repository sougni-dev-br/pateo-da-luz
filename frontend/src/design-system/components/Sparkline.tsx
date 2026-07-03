import "./Sparkline.css";

export type SparklineProps = {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
};

export function Sparkline({ points, width = 80, height = 30, className }: SparklineProps) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const dx = width / (points.length - 1);

  let linePath = "";
  points.forEach((v, i) => {
    const x = i * dx;
    const y = height - ((v - min) / range) * height;
    linePath += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : ` L${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;
  const classes = className ? `ds-sparkline ${className}` : "ds-sparkline";

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={fillPath} className="ds-sparkline-fill" />
      <path d={linePath} className="ds-sparkline-line" />
    </svg>
  );
}
