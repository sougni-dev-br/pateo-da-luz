import { useEffect, useMemo, useState } from "react";
import { Store, TrendingDown, TrendingUp, ShoppingBag, Percent, Truck as TruckIcon } from "lucide-react";
import {
  getIfoodSummary,
  getNoventaNoveSummary,
  type IfoodPeriodSummary,
  type NoventaNovePeriodSummary
} from "../api/client";
import { Alert, Card, Money, PanelEyebrow, Select, SummaryCard, Table } from "../design-system";

// Aba "Acumulado" — consolida iFood + 99 Food para o dono ver total delivery.
// Regra:
//   - Consolidação SEMPRE no consolidado das lojas (não faz sentido filtrar loja
//     porque uma loja pode ter nomes diferentes entre plataformas).
//   - Consolidação puramente no cliente: chama /summary das duas APIs em
//     paralelo e soma. Não cria endpoint novo — schema-first, refactor pra
//     backend só se performance apertar.
//   - `platformFeeAmount` = taxa iFood + taxa 99 Food (rótulo "Taxa plataformas").

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function buildMonthOptions(): Array<{ value: string; label: string }> {
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type ConsolidatedDaily = {
  date: string;
  orders: number;
  grossAmount: number;
  platformFeeAmount: number;
  promotionAmount: number;
  deliveryFeeAmount: number;
  netAmount: number;
};

type ConsolidatedFee = {
  key: string;
  platform: "IFOOD" | "NOVENTA_NOVE";
  feeType: string;
  description: string | null;
  amount: number;
};

type ConsolidatedSettlement = {
  id: string;
  platform: "IFOOD" | "NOVENTA_NOVE";
  externalId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  paidAt: string | null;
  status: string;
};

type ConsolidatedSummary = {
  totals: {
    orders: number;
    grossAmount: number;
    platformFeeAmount: number;
    promotionAmount: number;
    deliveryFeeAmount: number;
    netAmount: number;
    otherFees: number;
  };
  daily: ConsolidatedDaily[];
  fees: ConsolidatedFee[];
  settlements: ConsolidatedSettlement[];
  breakdownByPlatform: Array<{
    platform: "IFOOD" | "NOVENTA_NOVE";
    label: string;
    orders: number;
    grossAmount: number;
    netAmount: number;
    isMock: boolean;
  }>;
  anyMock: boolean;
};

function consolidate(ifood: IfoodPeriodSummary, nn: NoventaNovePeriodSummary): ConsolidatedSummary {
  const dailyMap = new Map<string, ConsolidatedDaily>();

  const addDaily = (
    date: string,
    orders: number,
    grossAmount: number,
    platformFee: number,
    promo: number,
    deliveryFee: number,
    net: number
  ) => {
    const prev = dailyMap.get(date);
    if (!prev) {
      dailyMap.set(date, { date, orders, grossAmount, platformFeeAmount: platformFee, promotionAmount: promo, deliveryFeeAmount: deliveryFee, netAmount: net });
      return;
    }
    dailyMap.set(date, {
      date,
      orders: prev.orders + orders,
      grossAmount: round2(prev.grossAmount + grossAmount),
      platformFeeAmount: round2(prev.platformFeeAmount + platformFee),
      promotionAmount: round2(prev.promotionAmount + promo),
      deliveryFeeAmount: round2(prev.deliveryFeeAmount + deliveryFee),
      netAmount: round2(prev.netAmount + net)
    });
  };

  for (const row of ifood.daily) {
    addDaily(row.date, row.orders, row.grossAmount, row.ifoodFeeAmount, row.promotionAmount, row.deliveryFeeAmount, row.netAmount);
  }
  for (const row of nn.daily) {
    addDaily(row.date, row.orders, row.grossAmount, row.noventaNoveFeeAmount, row.promotionAmount, row.deliveryFeeAmount, row.netAmount);
  }

  const fees: ConsolidatedFee[] = [
    ...ifood.fees.map((f) => ({ key: `IFOOD:${f.feeType}`, platform: "IFOOD" as const, feeType: f.feeType, description: f.description, amount: f.amount })),
    ...nn.fees.map((f) => ({ key: `NOVENTA_NOVE:${f.feeType}`, platform: "NOVENTA_NOVE" as const, feeType: f.feeType, description: f.description, amount: f.amount }))
  ].sort((a, b) => b.amount - a.amount);

  const settlements: ConsolidatedSettlement[] = [
    ...ifood.settlements.map((s) => ({ id: s.id, platform: "IFOOD" as const, externalId: s.externalId, periodStart: s.periodStart, periodEnd: s.periodEnd, grossAmount: s.grossAmount, totalFees: s.totalFees, netAmount: s.netAmount, paidAt: s.paidAt, status: s.status })),
    ...nn.settlements.map((s) => ({ id: s.id, platform: "NOVENTA_NOVE" as const, externalId: s.externalId, periodStart: s.periodStart, periodEnd: s.periodEnd, grossAmount: s.grossAmount, totalFees: s.totalFees, netAmount: s.netAmount, paidAt: s.paidAt, status: s.status }))
  ].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));

  return {
    totals: {
      orders: ifood.totals.orders + nn.totals.orders,
      grossAmount: round2(ifood.totals.grossAmount + nn.totals.grossAmount),
      platformFeeAmount: round2(ifood.totals.ifoodFeeAmount + nn.totals.noventaNoveFeeAmount),
      promotionAmount: round2(ifood.totals.promotionAmount + nn.totals.promotionAmount),
      deliveryFeeAmount: round2(ifood.totals.deliveryFeeAmount + nn.totals.deliveryFeeAmount),
      netAmount: round2(ifood.totals.netAmount + nn.totals.netAmount),
      otherFees: round2(ifood.totals.otherFees + nn.totals.otherFees)
    },
    daily: Array.from(dailyMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    fees,
    settlements,
    breakdownByPlatform: [
      { platform: "IFOOD", label: "iFood", orders: ifood.totals.orders, grossAmount: ifood.totals.grossAmount, netAmount: ifood.totals.netAmount, isMock: ifood.isMock },
      { platform: "NOVENTA_NOVE", label: "99 Food", orders: nn.totals.orders, grossAmount: nn.totals.grossAmount, netAmount: nn.totals.netAmount, isMock: nn.isMock }
    ],
    anyMock: ifood.isMock || nn.isMock
  };
}

export function DeliveryAcumulado() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0]?.value ?? "");
  const [summary, setSummary] = useState<ConsolidatedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { year, month } = useMemo(() => parseMonthKey(selectedMonth || "2026-07"), [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      getIfoodSummary({ year, month }),
      getNoventaNoveSummary({ year, month })
    ])
      .then(([ifood, nn]) => { if (alive) setSummary(consolidate(ifood, nn)); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Falha ao carregar faturamento consolidado."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [selectedMonth, year, month]);

  const feePercent = summary && summary.totals.grossAmount > 0
    ? (summary.totals.platformFeeAmount / summary.totals.grossAmount) * 100
    : 0;
  const netPercent = summary && summary.totals.grossAmount > 0
    ? (summary.totals.netAmount / summary.totals.grossAmount) * 100
    : 0;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <Card>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "minmax(240px, 1fr)" }}>
          <Select
            label="Mês de competência"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            options={monthOptions}
          />
        </div>
      </Card>

      {summary?.anyMock && (
        <Alert tone="info" title="Dados parciais em modo demonstração">
          Alguma plataforma está com mock ativo (sem sync real ainda).
          Os totais somam o que é real + o que é mock. Assim que ambas
          integrações estiverem persistindo vendas reais, este aviso some.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <p style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>Carregando consolidado...</p>
      ) : summary ? (
        <>
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <SummaryCard
              label="Faturamento bruto (total delivery)"
              moneyValue={summary.totals.grossAmount}
              detail={`${summary.totals.orders} pedidos — iFood + 99 Food`}
              tone="neutral"
              icon={<ShoppingBag size={18} />}
            />
            <SummaryCard
              label="Taxas plataformas"
              moneyValue={summary.totals.platformFeeAmount}
              detail={`${feePercent.toFixed(1)}% do bruto`}
              tone="danger"
              icon={<Percent size={18} />}
            />
            <SummaryCard
              label="Promoções"
              moneyValue={summary.totals.promotionAmount}
              detail="Descontos custeados pela loja"
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
              label="Líquido consolidado"
              moneyValue={summary.totals.netAmount}
              detail={`${netPercent.toFixed(1)}% do bruto`}
              tone="success"
              icon={<TrendingUp size={18} />}
            />
          </div>

          <Card>
            <PanelEyebrow>Divisão por plataforma</PanelEyebrow>
            <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Quanto cada canal contribui</h3>
            <Table>
              <thead>
                <tr>
                  <th>Plataforma</th>
                  <th style={{ textAlign: "right" }}>Pedidos</th>
                  <th style={{ textAlign: "right" }}>Bruto</th>
                  <th style={{ textAlign: "right" }}>Líquido</th>
                  <th style={{ textAlign: "right" }}>% do bruto total</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {summary.breakdownByPlatform.map((row) => {
                  const share = summary.totals.grossAmount > 0
                    ? (row.grossAmount / summary.totals.grossAmount) * 100
                    : 0;
                  return (
                    <tr key={row.platform}>
                      <td><b>{row.label}</b></td>
                      <td style={{ textAlign: "right" }}>{row.orders}</td>
                      <td style={{ textAlign: "right" }}><Money value={row.grossAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={row.netAmount} /></td>
                      <td style={{ textAlign: "right" }}>{share.toFixed(1)}%</td>
                      <td style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
                        {row.isMock ? "mock" : "dados reais"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))" }}>
            <Card>
              <PanelEyebrow>Taxas fixas / marketing / antecipação</PanelEyebrow>
              <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Custos adicionais consolidados</h3>
              <Table>
                <thead>
                  <tr>
                    <th>Plataforma</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.fees.map((fee) => (
                    <tr key={fee.key}>
                      <td>{fee.platform === "IFOOD" ? "iFood" : "99 Food"}</td>
                      <td><b>{fee.feeType}</b></td>
                      <td>{fee.description}</td>
                      <td style={{ textAlign: "right" }}><Money value={fee.amount} /></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--color-border, #e5e7eb)" }}>
                    <td colSpan={3}><b>Total (fora taxa por venda)</b></td>
                    <td style={{ textAlign: "right" }}><b><Money value={summary.totals.otherFees} /></b></td>
                  </tr>
                </tbody>
              </Table>
            </Card>

            <Card>
              <PanelEyebrow>Repasses consolidados</PanelEyebrow>
              <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Ciclos de pagamento — iFood + 99 Food</h3>
              <Table>
                <thead>
                  <tr>
                    <th>Plataforma</th>
                    <th>Período</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Bruto</th>
                    <th style={{ textAlign: "right" }}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.settlements.map((s) => (
                    <tr key={`${s.platform}-${s.id}`}>
                      <td>{s.platform === "IFOOD" ? "iFood" : "99 Food"}</td>
                      <td>{s.periodStart} → {s.periodEnd}</td>
                      <td>{s.status === "PAID" ? "Pago" : "Pendente"}</td>
                      <td style={{ textAlign: "right" }}><Money value={s.grossAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={s.netAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <Card>
            <PanelEyebrow>Vendas dia a dia (consolidado)</PanelEyebrow>
            <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Store size={16} /> Todas as plataformas
            </h3>
            <div style={{ maxHeight: "560px", overflow: "auto" }}>
              <Table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th style={{ textAlign: "right" }}>Pedidos</th>
                    <th style={{ textAlign: "right" }}>Bruto</th>
                    <th style={{ textAlign: "right" }}>Taxa plataformas</th>
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
                      <td style={{ textAlign: "right" }}><Money value={row.platformFeeAmount} /></td>
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
