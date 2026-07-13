import { useEffect, useMemo, useState } from "react";
import { Store, TrendingDown, TrendingUp, ShoppingBag, Percent, Truck as TruckIcon } from "lucide-react";
import {
  getIfoodStores,
  getIfoodSummary,
  type IfoodPeriodSummary,
  type IfoodStoreView
} from "../api/client";
import { Alert, Card, Money, PanelEyebrow, Select, SummaryCard, Table, Tabs } from "../design-system";
import { DeliveryIfoodPainel } from "./DeliveryIfoodPainel";

type ViewMode = "painel" | "detalhado";
const TAB_ITEMS = [
  { value: "painel", label: "Painel do dono" },
  { value: "detalhado", label: "Detalhado" }
];

// Tela de faturamento delivery iFood — Fase 1 com mock, mesma UI serve pra dados reais.
// Filtro:
//   - Loja (dropdown: 4 lojas + Consolidado)
//   - Mês de competência (últimos 12 meses)
// Blocos:
//   - 4 cards de KPI (bruto, taxa iFood, promoções, líquido)
//   - Detalhamento de taxas iFood
//   - Repasses do período
//   - Tabela dia a dia

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const CONSOLIDATED_KEY = "__all__";

function buildMonthOptions(): Array<{ value: string; label: string }> {
  // Fixado em 2026-07 como referência (não pode usar new Date() em prod pra ficar determinístico
  // com o mock — mas aqui é frontend, então usar new Date() real).
  const now = new Date();
  const options: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    options.push({
      value: `${y}-${String(m).padStart(2, "0")}`,
      label: `${MONTHS_PT[d.getMonth()]} / ${y}`
    });
  }
  return options;
}

function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-");
  return { year: Number(y), month: Number(m) };
}

export function DeliveryIfood() {
  const [view, setView] = useState<ViewMode>("painel");
  const [stores, setStores] = useState<IfoodStoreView[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>(CONSOLIDATED_KEY);
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0]?.value ?? "");
  const [summary, setSummary] = useState<IfoodPeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { year, month } = useMemo(() => parseMonthKey(selectedMonth || "2026-07"), [selectedMonth]);

  useEffect(() => {
    let alive = true;
    void getIfoodStores()
      .then((rows) => { if (alive) setStores(rows.filter((store) => store.active)); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Falha ao carregar lojas."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (view !== "detalhado") return;
    if (!selectedMonth) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const storeIdParam = selectedStore === CONSOLIDATED_KEY ? undefined : selectedStore;
    void getIfoodSummary({ year, month, storeId: storeIdParam })
      .then((data) => { if (alive) setSummary(data); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Falha ao carregar faturamento."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [view, selectedMonth, selectedStore, year, month]);

  const storeOptions = useMemo(() => {
    return [
      { value: CONSOLIDATED_KEY, label: "Consolidado (todas as lojas)" },
      ...stores.map((store) => ({ value: store.id, label: store.nickname }))
    ];
  }, [stores]);

  return (
    <div style={{ display: "grid", gap: "20px", padding: "16px", maxWidth: "1280px", margin: "0 auto" }}>
      <Tabs tabs={TAB_ITEMS} value={view} onChange={(v) => setView(v as ViewMode)} />

      <Card>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: view === "detalhado" ? "minmax(200px, 1fr) minmax(200px, 1fr)" : "minmax(200px, 1fr)" }}>
          {view === "detalhado" && (
            <Select
              label="Loja"
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              options={storeOptions}
            />
          )}
          <Select
            label="Mês de competência"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            options={monthOptions}
          />
        </div>
      </Card>

      {view === "painel" ? (
        <DeliveryIfoodPainel year={year} month={month} />
      ) : (
        <DeliveryIfoodDetalhado
          summary={summary}
          loading={loading}
          error={error}
        />
      )}
    </div>
  );
}

type DetalhadoProps = {
  summary: IfoodPeriodSummary | null;
  loading: boolean;
  error: string | null;
};

function DeliveryIfoodDetalhado({ summary, loading, error }: DetalhadoProps) {
  const feePercent = summary && summary.totals.grossAmount > 0
    ? (summary.totals.ifoodFeeAmount / summary.totals.grossAmount) * 100
    : 0;
  const netPercent = summary && summary.totals.grossAmount > 0
    ? (summary.totals.netAmount / summary.totals.grossAmount) * 100
    : 0;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {summary?.isMock && (
        <Alert tone="info" title="Dados de demonstração">
          Números fictícios (determinísticos por loja + mês). Estrutura final pronta — troca para
          dados reais quando o iFood liberar a credencial da Integradora.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <p style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>Carregando...</p>
      ) : summary ? (
        <>
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <SummaryCard
              label="Faturamento bruto"
              moneyValue={summary.totals.grossAmount}
              detail={`${summary.totals.orders} pedidos`}
              tone="neutral"
              icon={<ShoppingBag size={18} />}
            />
            <SummaryCard
              label="Taxa iFood"
              moneyValue={summary.totals.ifoodFeeAmount}
              detail={`${feePercent.toFixed(1)}% do bruto`}
              tone="danger"
              icon={<Percent size={18} />}
            />
            <SummaryCard
              label="Promoções (custeadas)"
              moneyValue={summary.totals.promotionAmount}
              detail="Desconto aplicado pela loja"
              tone="warning"
              icon={<TrendingDown size={18} />}
            />
            <SummaryCard
              label="Taxas de entrega"
              moneyValue={summary.totals.deliveryFeeAmount}
              detail="Custo entregador"
              tone="warning"
              icon={<TruckIcon size={18} />}
            />
            <SummaryCard
              label="Líquido para a loja"
              moneyValue={summary.totals.netAmount}
              detail={`${netPercent.toFixed(1)}% do bruto`}
              tone="success"
              icon={<TrendingUp size={18} />}
            />
          </div>

          <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))" }}>
            <Card>
              <PanelEyebrow>Detalhamento de taxas</PanelEyebrow>
              <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Custos iFood no período</h3>
              <Table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.fees.map((fee) => (
                    <tr key={fee.feeType}>
                      <td><b>{fee.feeType}</b></td>
                      <td>{fee.description}</td>
                      <td style={{ textAlign: "right" }}><Money value={fee.amount} /></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--color-border, #e5e7eb)" }}>
                    <td colSpan={2}><b>Total (fora taxa por venda)</b></td>
                    <td style={{ textAlign: "right" }}><b><Money value={summary.totals.otherFees} /></b></td>
                  </tr>
                </tbody>
              </Table>
            </Card>

            <Card>
              <PanelEyebrow>Repasses</PanelEyebrow>
              <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Ciclos de pagamento iFood</h3>
              <Table>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Bruto</th>
                    <th style={{ textAlign: "right" }}>Taxas</th>
                    <th style={{ textAlign: "right" }}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.settlements.map((settle) => (
                    <tr key={settle.id}>
                      <td>{settle.periodStart} → {settle.periodEnd}</td>
                      <td>{settle.status === "PAID" ? "Pago" : "Pendente"}</td>
                      <td style={{ textAlign: "right" }}><Money value={settle.grossAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={settle.totalFees} /></td>
                      <td style={{ textAlign: "right" }}><Money value={settle.netAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <Card>
            <PanelEyebrow>Vendas dia a dia</PanelEyebrow>
            <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Store size={16} /> {summary.storeLabel}
            </h3>
            <div style={{ maxHeight: "560px", overflow: "auto" }}>
              <Table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th style={{ textAlign: "right" }}>Pedidos</th>
                    <th style={{ textAlign: "right" }}>Bruto</th>
                    <th style={{ textAlign: "right" }}>Taxa iFood</th>
                    <th style={{ textAlign: "right" }}>Promoção</th>
                    <th style={{ textAlign: "right" }}>Entrega</th>
                    <th style={{ textAlign: "right" }}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.daily.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td style={{ textAlign: "right" }}>{row.orders}</td>
                      <td style={{ textAlign: "right" }}><Money value={row.grossAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={row.ifoodFeeAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={row.promotionAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={row.deliveryFeeAmount} /></td>
                      <td style={{ textAlign: "right" }}><b><Money value={row.netAmount} /></b></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </>
      ) : (
        <p style={{ padding: "24px" }}>Sem dados para o período.</p>
      )}
    </div>
  );
}
