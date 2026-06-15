type ChartItem = {
  label: string;
  value: number;
};

export function SimpleBarChart({ title, items, maxItems = 8 }: { title: string; items: ChartItem[]; maxItems?: number }) {
  const visibleItems = items
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems);
  const max = Math.max(...visibleItems.map((item) => item.value), 1);

  return (
    <div className="simple-chart">
      <div className="simple-chart-header">
        <h3>{title}</h3>
      </div>
      {visibleItems.length === 0 ? (
        <p className="muted">Sem dados suficientes.</p>
      ) : (
        <div className="simple-chart-bars">
          {visibleItems.map((item) => (
            <div className="simple-chart-row" key={item.label} title={`${item.label}: ${item.value}`}>
              <span>{item.label}</span>
              <div className="simple-chart-track">
                <div className="simple-chart-fill" style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }} />
              </div>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
