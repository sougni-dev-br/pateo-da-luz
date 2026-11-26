import type { HistoricoMetaCmv } from "../../api/client";

const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const mesCurto = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const nome = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${nome}/${String(a).slice(2)}`;
};

/**
 * Realizado de cada mês em colunas, com a meta do mês como traço: a meta pode mudar de um mês para
 * outro, então cada coluna tem o seu. A cor é o semáforo e o número fica escrito (cor nunca sozinha).
 */
export function HistoricoGrafico({ historico }: { historico: HistoricoMetaCmv[] }) {
  const topo = Math.max(...historico.flatMap((h) => [h.realizadoPercentual ?? 0, h.alvoPercentual ?? 0]), 1) * 1.15;
  const altura = (v: number) => `${(v / topo) * 100}%`;
  return (
    <ol className="mt-hist" aria-label="Realizado de CMV por mês, com a meta de cada mês">
      {historico.map((h) => (
        <li key={h.mes} className="mt-hist-mes">
          <div className="mt-hist-area">
            {h.realizadoPercentual != null && (
              <span className={`mt-hist-coluna mt-${h.status.toLowerCase()}`} style={{ height: altura(h.realizadoPercentual) }}>
                <span className="mt-hist-valor">{pct(h.realizadoPercentual)}</span>
              </span>
            )}
            {h.alvoPercentual != null && (
              <span className="mt-hist-meta" style={{ bottom: altura(h.alvoPercentual) }} title={`Meta ${pct(h.alvoPercentual)}`} />
            )}
          </div>
          <span className="mt-hist-rotulo">{mesCurto(h.mes)}</span>
          <span className="mt-sub">{h.realizadoPercentual == null ? "sem dados" : h.base === "CMV_REAL" ? "CMV real" : "compras"}</span>
          <span className="mt-sr">{h.alvoPercentual != null ? `meta ${pct(h.alvoPercentual)}` : "sem meta"}</span>
        </li>
      ))}
    </ol>
  );
}
