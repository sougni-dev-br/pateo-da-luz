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
          {/* A linha usa display:contents para as colunas virem do grid de
              fora, mantendo as barras alinhadas entre si. Sem caixa propria
              ela nao exibe title, entao a dica fica nos filhos. */}
          {visibleItems.map((item) => (
            <div className="simple-chart-row" key={item.label}>
              <span title={`${item.label}: ${item.value}`}>{item.label}</span>
              <div className="simple-chart-track" title={`${item.label}: ${item.value}`}>
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
