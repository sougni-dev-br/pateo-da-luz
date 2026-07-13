import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp, Trophy, CalendarDays, Percent } from "lucide-react";
import { getIfoodInsights, type PainelDonoInsights } from "../api/client";
import { Alert, Card, Money, PanelEyebrow, SummaryCard } from "../design-system";
import "./DeliveryFinance.css";

type Props = {
  year: number;
  month: number;
};

function DeltaTag({ value }: { value: number }) {
  if (value === 0) return <span style={{ color: "var(--color-text-muted, #6b7280)", fontSize: "13px" }}>= 0%</span>;
  const positive = value > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const color = positive ? "#16a34a" : "#dc2626";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color, fontWeight: 600, fontSize: "13px" }}>
      <Icon size={14} /> {positive ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function CostDonut({ breakdown }: { breakdown: PainelDonoInsights["breakdown"] }) {
  const segments = [
    { key: "ifood", label: "Taxa iFood", value: breakdown.ifoodFeePercent, color: "#f97316" },
    { key: "promo", label: "Promoções", value: breakdown.promotionPercent, color: "#eab308" },
    { key: "delivery", label: "Entrega", value: breakdown.deliveryFeePercent, color: "#8b5cf6" },
    { key: "other", label: "Outras taxas", value: breakdown.otherFeesPercent, color: "#f43f5e" },
    { key: "net", label: "Líquido", value: breakdown.netPercent, color: "#16a34a" }
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let cumulative = 0;
  const radius = 60;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <g transform="translate(80 80) rotate(-90)">
          {segments.map((seg) => {
            const dash = (seg.value / total) * circumference;
            const el = (
              <circle
                key={seg.key}
                r={radius}
                cx="0"
                cy="0"
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-cumulative}
              />
            );
            cumulative += dash;
            return el;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="26" fontWeight="700" fill="#16a34a">
          {breakdown.netPercent.toFixed(0)}%
        </text>
        <text x="80" y="94" textAnchor="middle" fontSize="11" fill="var(--color-text-muted, #6b7280)">
          líquido
        </text>
      </svg>
      <div style={{ display: "grid", gap: "6px", fontSize: "13px" }}>
        {segments.map((seg) => (
          <div key={seg.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "12px", height: "12px", background: seg.color, borderRadius: "3px" }} />
            <span style={{ minWidth: "110px" }}>{seg.label}</span>
            <b>{seg.value.toFixed(1)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekdayHeatmap({ weekday }: { weekday: PainelDonoInsights["weekday"] }) {
  const max = Math.max(...weekday.map((w) => w.avgNet), 1);
  const best = weekday.reduce((a, b) => (a.avgNet > b.avgNet ? a : b));
  const worst = weekday.reduce((a, b) => (a.avgNet < b.avgNet ? a : b));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
        {weekday.map((day) => {
          const intensity = day.avgNet / max;
          const isBest = day.dow === best.dow;
          const isWorst = day.dow === worst.dow;
          return (
            <div
              key={day.dow}
              style={{
                padding: "10px 6px",
                borderRadius: "6px",
                textAlign: "center",
                background: `rgba(22, 163, 74, ${0.15 + intensity * 0.7})`,
                border: isBest ? "2px solid #16a34a" : isWorst ? "2px solid #dc2626" : "2px solid transparent",
                color: "#111"
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 600, opacity: 0.7 }}>{day.label}</div>
              <div style={{ fontSize: "13px", fontWeight: 700, marginTop: "4px" }}>
                <Money value={day.avgNet} />
              </div>
              <div style={{ fontSize: "10px", opacity: 0.7 }}>{day.avgOrders} ped/dia</div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)", margin: "10px 0 0 0" }}>
        Melhor dia: <b>{best.label}</b> · Pior dia: <b>{worst.label}</b>. Considere concentrar promoções nos dias fracos.
      </p>
    </div>
  );
}

function Simulator({ current, breakdown }: { current: PainelDonoInsights["current"]; breakdown: PainelDonoInsights["breakdown"] }) {
  const [promoReduction, setPromoReduction] = useState(0);
  const [priceIncrease, setPriceIncrease] = useState(0);

  const gross = current.grossAmount * (1 + priceIncrease / 100);
  const currentPromoValue = (current.grossAmount * breakdown.promotionPercent) / 100;
  const newPromoValue = currentPromoValue * (1 - promoReduction / 100);
  const currentIfoodFee = (current.grossAmount * breakdown.ifoodFeePercent) / 100;
  const currentDeliveryFee = (current.grossAmount * breakdown.deliveryFeePercent) / 100;
  const currentOtherFees = (current.grossAmount * breakdown.otherFeesPercent) / 100;
  const newIfoodFee = currentIfoodFee * (gross / current.grossAmount);
  const newNet = gross - newIfoodFee - newPromoValue - currentDeliveryFee - currentOtherFees;
  const delta = newNet - current.netAmount;

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <label style={{ display: "grid", gap: "4px", fontSize: "13px" }}>
        <span>Reduzir promoções em <b>{promoReduction}%</b></span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={promoReduction}
          onChange={(e) => setPromoReduction(Number(e.target.value))}
        />
      </label>
      <label style={{ display: "grid", gap: "4px", fontSize: "13px" }}>
        <span>Aumentar preço médio em <b>{priceIncrease}%</b></span>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={priceIncrease}
          onChange={(e) => setPriceIncrease(Number(e.target.value))}
        />
      </label>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "12px",
        background: delta >= 0 ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
        borderRadius: "6px"
      }}>
        <div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>Líquido projetado</div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}><Money value={newNet} /></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>Ganho vs atual</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: delta >= 0 ? "#16a34a" : "#dc2626" }}>
            {delta >= 0 ? "+" : ""}<Money value={delta} />
          </div>
        </div>
      </div>
      <p style={{ fontSize: "11px", color: "var(--color-text-muted, #6b7280)", margin: 0 }}>
        Simulação linear. Não considera queda de volume ao aumentar preço. Use como referência inicial.
      </p>
    </div>
  );
}

export function DeliveryIfoodPainel({ year, month }: Props) {
  const [insights, setInsights] = useState<PainelDonoInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void getIfoodInsights({ year, month })
      .then((data) => { if (alive) setInsights(data); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Falha ao carregar."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, month]);

  const alertToneMap = useMemo(() => ({
    info: "info" as const,
    warn: "warning" as const,
    danger: "error" as const
  }), []);

  if (loading) return <p style={{ padding: "24px", textAlign: "center" }}>Carregando painel...</p>;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!insights) return null;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {insights.isMock && (
        <Alert tone="info" title="Dados de demonstração">
          Números fictícios até a credencial real do iFood entrar. Todos os cálculos e alertas estão prontos.
        </Alert>
      )}

      {/* Big number — flexbox pra colapsar em coluna no mobile */}
      <Card>
        <div style={{
          display: "flex",
          gap: "20px",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap"
        }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <PanelEyebrow>Líquido do mês</PanelEyebrow>
            <div style={{
              fontSize: "clamp(30px, 6vw, 42px)",
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: "4px"
            }}>
              <Money value={insights.current.netAmount} />
            </div>
            <div style={{ display: "flex", gap: "16px", marginTop: "10px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "13px" }}>
                <span style={{ color: "var(--color-text-muted, #6b7280)" }}>vs mês anterior:</span>{" "}
                <DeltaTag value={insights.previousMonth.deltaNetPercent} />
              </div>
              <div style={{ fontSize: "13px" }}>
                <span style={{ color: "var(--color-text-muted, #6b7280)" }}>vs ano passado:</span>{" "}
                <DeltaTag value={insights.lastYear.deltaNetPercent} />
              </div>
            </div>
          </div>
          <div style={{
            flex: "0 1 260px",
            minWidth: "180px",
            textAlign: "right"
          }}>
            <PanelEyebrow>Projeção fechamento</PanelEyebrow>
            <div style={{
              fontSize: "clamp(20px, 4vw, 24px)",
              fontWeight: 700,
              marginTop: "4px"
            }}>
              <Money value={insights.projection.netAmount} />
            </div>
            <div style={{
              fontSize: "11px",
              color: "var(--color-text-muted, #6b7280)",
              maxWidth: "260px",
              marginTop: "4px",
              marginLeft: "auto"
            }}>
              {insights.projection.note}
            </div>
          </div>
        </div>
      </Card>

      {/* Alertas */}
      {insights.alerts.length > 0 && (
        <div style={{ display: "grid", gap: "10px" }}>
          {insights.alerts.map((alert, idx) => (
            <Alert key={idx} tone={alertToneMap[alert.severity]} title={alert.title}>
              {alert.message}
            </Alert>
          ))}
        </div>
      )}
      {insights.alerts.length === 0 && (
        <Alert tone="success" title="Tudo dentro do esperado">
          Nenhum alerta disparado nos indicadores monitorados.
        </Alert>
      )}

      {/* KPIs secundários */}
      <div className="df-kpi-grid">
        <SummaryCard
          label="Bruto do mês"
          moneyValue={insights.current.grossAmount}
          detail={`${insights.current.orders} pedidos`}
          tone="neutral"
        />
        <SummaryCard
          label="Ticket médio"
          moneyValue={insights.current.ticketAverage}
          detail="por pedido"
          tone="info"
        />
        <SummaryCard
          label="Margem líquida"
          value={`${insights.breakdown.netPercent.toFixed(1)}%`}
          detail="do bruto"
          tone={insights.breakdown.netPercent >= 60 ? "success" : insights.breakdown.netPercent >= 50 ? "warning" : "danger"}
          icon={<Percent size={18} />}
        />
        <SummaryCard
          label="Taxa iFood"
          value={`${insights.breakdown.ifoodFeePercent.toFixed(1)}%`}
          detail="do bruto"
          tone={insights.breakdown.ifoodFeePercent > 25 ? "danger" : "neutral"}
        />
      </div>

      {/* Ranking + Custo donut */}
      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow>Ranking das lojas</PanelEyebrow>
          <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
            <Trophy size={16} /> Quem está performando
          </h3>
          <div style={{ display: "grid", gap: "8px" }}>
            {insights.ranking.map((store, idx) => (
              <div key={store.storeId} style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                gap: "12px",
                alignItems: "center",
                padding: "10px",
                borderRadius: "6px",
                background: idx === 0 ? "rgba(22, 163, 74, 0.08)" : "transparent",
                border: "1px solid var(--color-border, #e5e7eb)"
              }}>
                <span style={{ fontWeight: 700, fontSize: "18px", opacity: 0.7 }}>{idx + 1}º</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{store.storeLabel}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
                    {store.sharePercent.toFixed(1)}% do total
                  </div>
                </div>
                <div style={{ textAlign: "right", fontWeight: 700 }}><Money value={store.netAmount} /></div>
                <DeltaTag value={store.deltaVsPreviousMonthPercent} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <PanelEyebrow>Onde o dinheiro está indo</PanelEyebrow>
          <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>De cada R$ 100 faturados</h3>
          <CostDonut breakdown={insights.breakdown} />
        </Card>
      </div>

      {/* Weekday + Simulador */}
      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow>Dias da semana</PanelEyebrow>
          <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
            <CalendarDays size={16} /> Líquido médio por dia
          </h3>
          <WeekdayHeatmap weekday={insights.weekday} />
        </Card>

        <Card>
          <PanelEyebrow>Simulador "e se...?"</PanelEyebrow>
          <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Testar cenários</h3>
          <Simulator current={insights.current} breakdown={insights.breakdown} />
        </Card>
      </div>

      {/* Ticket médio por loja */}
      <Card>
        <PanelEyebrow>Ticket médio por loja</PanelEyebrow>
        <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>Evolução vs mês anterior</h3>
        <div className="df-kpi-grid" style={{ gap: "8px" }}>
          {insights.ticketByStore.map((store) => (
            <div key={store.storeId} style={{
              padding: "12px",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "6px"
            }}>
              <div style={{ fontSize: "13px", color: "var(--color-text-muted, #6b7280)" }}>{store.storeLabel}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                <span style={{ fontWeight: 700, fontSize: "18px" }}><Money value={store.ticket} /></span>
                <DeltaTag value={store.deltaPercent} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
