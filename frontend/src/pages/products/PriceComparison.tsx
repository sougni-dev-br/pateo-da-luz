import { Clock, TrendingDown, TrendingUp } from "lucide-react";
import type { ProductHistory } from "../../api/client";
import { Money, Sparkline, StatusBadge } from "../../design-system";
import { formatDate, formatNumber, formatPercent } from "../../utils/format";
import "./PriceComparison.css";

type Comparison = ProductHistory["priceComparison"];
type SupplierPrice = Comparison["suppliers"][number];

// Acima disso, o fornecedor custa caro o bastante para a diferenca merecer cor.
const DESTAQUE_DIFERENCA_PERCENT = 15;
// Mudanca pequena de preco entre duas compras e ruido; so avisa a partir daqui.
const MUDANCA_RELEVANTE_PERCENT = 5;
const LARGURA_MINIMA_BARRA = 0.06;

type Props = {
  comparison: Comparison | undefined;
};

function sinal(valor: number): string {
  return valor > 0 ? "+" : valor < 0 ? "−" : "";
}

function haQuantoTempo(dias: number): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/** A resposta que o comprador procura antes de pedir: de quem, a quanto, e se o preco ainda vale. */
function BestPrice({ best, unit, savings }: { best: SupplierPrice; unit: string | null; savings: Comparison["savings"] }) {
  return (
    <div className="pc-best" aria-label="Melhor preço hoje">
      <span className="pc-best-label">Melhor preço hoje</span>
      <p className="pc-best-main">
        <strong><Money value={best.lastPrice} />{unit ? `/${unit}` : ""}</strong>
        <span className="pc-best-who">com {best.supplierName}</span>
      </p>
      <p className={best.isStale ? "pc-best-note is-warning" : "pc-best-note"}>
        {best.isStale && <Clock size={13} strokeWidth={2} aria-hidden="true" />}
        {best.isStale
          ? `Preço de ${haQuantoTempo(best.daysSinceLast)}: confirme com o fornecedor antes de pedir.`
          : `Último preço pago ${haQuantoTempo(best.daysSinceLast)}.`}
      </p>
      {savings && (
        <p className="pc-best-note">
          Nos últimos {savings.windowDays} dias, {savings.purchases} {savings.purchases === 1 ? "compra saiu" : "compras saíram"} acima desse preço:{" "}
          <strong><Money value={savings.amount} /> a mais</strong> ({formatPercent(savings.percent)} do gasto).
        </p>
      )}
    </div>
  );
}

function SupplierChange({ row }: { row: SupplierPrice }) {
  if (row.changePercent == null || row.previousPrice == null) return null;
  if (Math.abs(row.changePercent) < MUDANCA_RELEVANTE_PERCENT) return null;
  const subiu = row.changePercent > 0;
  return (
    <span className={subiu ? "pc-change is-up" : "pc-change is-down"}>
      {subiu ? <TrendingUp size={12} strokeWidth={2.2} aria-hidden="true" /> : <TrendingDown size={12} strokeWidth={2.2} aria-hidden="true" />}
      <span>{subiu ? "Subiu" : "Caiu"} {formatPercent(Math.abs(row.changePercent))} desde a compra anterior (<Money value={row.previousPrice} />)</span>
    </span>
  );
}

function SupplierRow({ row, cheapest, highest, unit, canCompare }: {
  row: SupplierPrice;
  cheapest: number;
  highest: number;
  unit: string | null;
  canCompare: boolean;
}) {
  const diff = row.lastPrice - cheapest;
  const diffPercent = cheapest > 0 ? (diff / cheapest) * 100 : 0;
  const isNotable = !row.isCheapest && diffPercent >= DESTAQUE_DIFERENCA_PERCENT;
  const fill = highest > 0 ? Math.max(row.lastPrice / highest, LARGURA_MINIMA_BARRA) : LARGURA_MINIMA_BARRA;
  const varies = new Set(row.recent).size > 1;
  const rowClass = ["pc-row", row.isCheapest && canCompare ? "is-cheapest" : "", isNotable ? "is-notable" : ""].filter(Boolean).join(" ");
  const quantidade = row.lastQuantity != null && unit ? ` · pediu ${formatNumber(row.lastQuantity)} ${unit}` : "";

  return (
    <li className={rowClass}>
      <div className="pc-who">
        <span className="pc-name" title={row.supplierName}>{row.supplierName}</span>
        {row.isCheapest && canCompare && <StatusBadge tone="success">Mais barato</StatusBadge>}
        {row.isStale && <StatusBadge tone="warning">Preço antigo</StatusBadge>}
        <span className="pc-meta">
          Última compra {haQuantoTempo(row.daysSinceLast)} ({formatDate(row.lastDate)}){quantidade}
        </span>
        <SupplierChange row={row} />
        {row.purchases > 1 && (
          <span className="pc-meta">
            {row.minPrice === row.avgPrice
              ? `${row.purchases} compras, sempre o mesmo preço`
              : <>{row.purchases} compras · menor <Money value={row.minPrice} /> · médio <Money value={row.avgPrice} /></>}
          </span>
        )}
      </div>

      <div className="pc-trend" aria-hidden="true">
        <span className="pc-bar"><span className="pc-bar-fill" style={{ transform: `scaleX(${fill})` }} /></span>
        {varies && <Sparkline points={row.recent} width={64} height={22} />}
      </div>

      <div className="pc-price">
        <span className="pc-line">
          <strong><Money value={row.lastPrice} /></strong>
          {unit && <span className="pc-unit">/{unit}</span>}
        </span>
        {canCompare && (
          <span className="pc-delta">
            {row.isCheapest
              ? "menor preço atual"
              : <span className="pc-nowrap">{sinal(diff)}<Money value={Math.abs(diff)} /> ({sinal(diffPercent)}{formatPercent(Math.abs(diffPercent))})</span>}
          </span>
        )}
      </div>
    </li>
  );
}

export function PriceComparison({ comparison }: Props) {
  if (!comparison || comparison.suppliers.length === 0) return null;

  const { suppliers, unit, savings, ignoredOtherUnit } = comparison;
  const canCompare = suppliers.length > 1;
  const cheapest = Math.min(...suppliers.map((s) => s.lastPrice));
  const highest = Math.max(...suppliers.map((s) => s.lastPrice));

  return (
    <section className="subsection pc" aria-labelledby="pc-title">
      <header className="pc-head">
        <h3 id="pc-title">Preço por fornecedor</h3>
        <p className="pc-sub">
          {unit ? `Valores por ${unit}, ` : ""}do último preço pago a cada fornecedor.
          {!canCompare && " Só um fornecedor até agora, então ainda não há o que comparar."}
        </p>
      </header>

      {canCompare && <BestPrice best={suppliers[0]} unit={unit} savings={savings} />}

      <ul className="pc-list">
        {suppliers.map((row) => (
          <SupplierRow key={row.supplierName} row={row} cheapest={cheapest} highest={highest} unit={unit} canCompare={canCompare} />
        ))}
      </ul>

      {ignoredOtherUnit > 0 && (
        <p className="pc-foot">
          {ignoredOtherUnit === 1
            ? "1 compra ficou de fora porque está em outra unidade"
            : `${ignoredOtherUnit} compras ficaram de fora porque estão em outra unidade`}
          {" "}(por exemplo, caixa sem conversão cadastrada). Cadastre a conversão no produto para incluir.
        </p>
      )}
    </section>
  );
}
