import { Loader2, RefreshCw } from "lucide-react";
import type { BuyerSupportItem, OperationalInventory, Product, StockCountSession } from "../../api/client";
import { SimpleBarChart } from "../../components/SimpleBarChart";
import { Button, IconButton, PanelEyebrow, SummaryCard } from "../../design-system";
import { formatDate } from "../../utils/format";
import { countBy } from "./shared";

type ChartItems = { label: string; value: number }[];

export type OverviewSectionProps = {
  className: string;
  loading: boolean;
  onRefresh: () => void;
  products: Product[];
  activeProducts: Product[];
  lowStockItems: BuyerSupportItem[];
  latestCountSession: StockCountSession | null;
  latestClosedInventory: OperationalInventory | null;
  activeCountProgress: number;
  openCountsCount: number;
  productsByCategory: ChartItems;
  productsBySector: ChartItems;
  movementsByType: ChartItems;
  countsByStatus: ChartItems;
  onStartCounting: () => void;
  onOpenInventory: () => void;
};

/**
 * Painel "Visão Geral" do módulo de Estoque. Extraído do Inventory.tsx
 * (Onda 5.B) — o container continua dono do estado; este componente é
 * apresentacional e fica sempre montado (visibilidade via className,
 * mesmo esquema panelClass do container).
 */
export function OverviewSection({
  className,
  loading,
  onRefresh,
  products,
  activeProducts,
  lowStockItems,
  latestCountSession,
  latestClosedInventory,
  activeCountProgress,
  openCountsCount,
  productsByCategory,
  productsBySector,
  movementsByType,
  countsByStatus,
  onStartCounting,
  onOpenInventory
}: OverviewSectionProps) {
  return (
    <section className={className}>
      <div className="section-heading">
        <div>
          <PanelEyebrow>Estoque</PanelEyebrow>
          <h2>Visão Geral</h2>
        </div>
        <IconButton
          icon={loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
          label="Atualizar estoque"
          onClick={onRefresh}
        />
      </div>
      <div className="summary-grid dashboard-summary">
        <SummaryCard label="Produtos cadastrados" value={products.length} />
        <SummaryCard label="Produtos ativos" value={activeProducts.length} tone="success" />
        <SummaryCard label="Estoque baixo" value={lowStockItems.length} tone={lowStockItems.length ? "warning" : "success"} />
        <SummaryCard label="Última contagem" value={latestCountSession?.code ?? "-"} detail={latestCountSession ? formatDate(latestCountSession.referenceDate) : "Nenhuma contagem encontrada"} />
        <SummaryCard label="Último inventário fechado" value={latestClosedInventory?.code ?? "-"} detail={latestClosedInventory ? formatDate(latestClosedInventory.date) : "Nenhum fechamento"} />
        <SummaryCard label="Progresso em aberto" value={`${activeCountProgress}%`} detail={`${openCountsCount} contagem(ns) abertas`} tone={activeCountProgress >= 80 ? "success" : openCountsCount ? "warning" : "info"} />
      </div>
      <div className="quick-actions-row">
        <Button className="large-action" onClick={onStartCounting}>Iniciar Contagem</Button>
        <Button variant="secondary" className="large-action" onClick={onOpenInventory}>Ver Inventário</Button>
      </div>
      <div className="chart-grid">
        <SimpleBarChart title="Produtos por categoria" items={productsByCategory} />
        <SimpleBarChart title="Produtos por setor" items={productsBySector} />
        <SimpleBarChart title="Movimentações dos últimos 30 dias" items={movementsByType} />
        <SimpleBarChart title="Evolução de contagens" items={countsByStatus} />
        <SimpleBarChart title="Produtos com estoque baixo" items={countBy(lowStockItems, (item) => item.sectorName ?? item.categoryName)} />
      </div>
    </section>
  );
}
