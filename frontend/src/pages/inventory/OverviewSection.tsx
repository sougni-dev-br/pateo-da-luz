import { Loader2, RefreshCw } from "lucide-react";
import type { BuyerSupportItem, OperationalInventory, ProductSummary, StockCountSession } from "../../api/client";
import { SimpleBarChart } from "../../components/SimpleBarChart";
import { Button, IconButton, SummaryCard } from "../../design-system";
import { formatDate } from "../../utils/format";
import { countBy } from "./shared";

type ChartItems = { label: string; value: number }[];

export type OverviewSectionProps = {
  className: string;
  loading: boolean;
  onRefresh: () => void;
  /** Totais do banco para produtos que controlam estoque. Null enquanto carrega. */
  productSummary: ProductSummary | null;
  lowStockItems: BuyerSupportItem[];
  latestCountSession: StockCountSession | null;
  latestClosedInventory: OperationalInventory | null;
  activeCountProgress: number;
  openCountsCount: number;
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
  productSummary,
  lowStockItems,
  latestCountSession,
  latestClosedInventory,
  activeCountProgress,
  openCountsCount,
  movementsByType,
  countsByStatus,
  onStartCounting,
  onOpenInventory
}: OverviewSectionProps) {
  const carregando = productSummary == null;
  return (
    <section className={className}>
      {/* O titulo "Visão Geral" ja esta no topo da pagina; aqui repetia. Ficam
          as acoes, que sobem para a primeira linha. */}
      <div className="section-heading inv-overview-heading-row">
        <div className="quick-actions-row">
          <Button onClick={onStartCounting}>Iniciar contagem</Button>
          <Button variant="secondary" onClick={onOpenInventory}>Ver inventário</Button>
        </div>
        <IconButton
          icon={loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
          label="Atualizar estoque"
          onClick={onRefresh}
        />
      </div>
      {/* "Produtos ativos" saiu: a lista ja vinha so com ativos e o numero
          era sempre igual ao de cadastrados. */}
      <div className="summary-grid dashboard-summary inv-overview-summary">
        <SummaryCard
          label="Produtos com controle de estoque"
          value={carregando ? "..." : productSummary.ativos}
          detail={carregando ? undefined : productSummary.inativos > 0 ? `${productSummary.inativos} inativo(s) fora da conta` : "todos ativos"}
        />
        <SummaryCard
          label="Estoque baixo"
          value={lowStockItems.length}
          detail="zerados ou abaixo do mínimo"
          tone={lowStockItems.length ? "warning" : "success"}
        />
        <SummaryCard label="Última contagem" value={latestCountSession?.code ?? "-"} detail={latestCountSession ? formatDate(latestCountSession.referenceDate) : "Nenhuma contagem encontrada"} />
        <SummaryCard label="Último inventário fechado" value={latestClosedInventory?.code ?? "-"} detail={latestClosedInventory ? formatDate(latestClosedInventory.date) : "Nenhum fechamento"} />
        <SummaryCard label="Progresso em aberto" value={`${activeCountProgress}%`} detail={`${openCountsCount} contagem(ns) abertas`} tone={activeCountProgress >= 80 ? "success" : openCountsCount ? "warning" : "info"} />
      </div>
      <div className="chart-grid">
        <SimpleBarChart title="Produtos por categoria" items={productSummary?.porCategoria ?? []} />
        <SimpleBarChart title="Produtos por setor" items={productSummary?.porSetor ?? []} />
        <SimpleBarChart title="Produtos com estoque baixo, por setor" items={countBy(lowStockItems, (item) => item.sectorName ?? item.categoryName)} />
        {/* Nao eram "ultimos 30 dias": e o periodo escolhido em Movimentacoes. */}
        <SimpleBarChart title="Movimentações por tipo (período de Movimentações)" items={movementsByType} />
        <SimpleBarChart title="Contagens por status" items={countsByStatus} />
      </div>
    </section>
  );
}
