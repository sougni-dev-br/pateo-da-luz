import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { getNoventaNovePainelDono, type PainelDonoNoventaNove, type Variacao } from "../api/client";
import { Alert, Card, Money, PanelEyebrow, SummaryCard } from "../design-system";
import "./DeliveryFinance.css";

type Props = { year: number; month: number };

/**
 * Variação entre dois períodos. Quando não há base de comparação escreve
 * "sem base" — e não "+100%", que era o que o painel do iFood mostrava: a 99 só
 * tem dados desde abril/2026, então todo mês "cresceria" 100% contra o ano
 * passado, um crescimento que ninguém teve.
 */
function Delta({ v }: { v: Variacao }) {
  if (!v.comparavel) {
    return <span style={{ color: "var(--color-text-muted, #6b7280)", fontSize: "13px" }}>sem base de comparação</span>;
  }
  if (v.percentual === 0) {
    return <span style={{ color: "var(--color-text-muted, #6b7280)", fontSize: "13px" }}>estável</span>;
  }
  const subiu = v.percentual > 0;
  const Icon = subiu ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: subiu ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: "13px" }}>
      <Icon size={14} /> {subiu ? "+" : ""}{v.percentual.toFixed(1)}%
    </span>
  );
}

/**
 * Dedução × líquido, em barra. São as duas únicas fatias que realmente somam
 * 100% do bruto — por isso não há aqui o donut de "taxa + promoção + entrega"
 * que o painel do iFood desenha: aqueles valores não são fatias do bruto.
 */
function BarraDeducao({ b }: { b: PainelDonoNoventaNove["breakdown"] }) {
  return (
    <div>
      <div style={{ display: "flex", height: "28px", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--color-border, #e5e7eb)" }}>
        <div style={{ width: `${b.liquidoPercent}%`, background: "#16a34a" }} title={`Líquido ${b.liquidoPercent}%`} />
        <div style={{ width: `${b.deducaoPercent}%`, background: "#f97316" }} title={`Dedução ${b.deducaoPercent}%`} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "13px", flexWrap: "wrap", gap: "8px" }}>
        <span><b style={{ color: "#16a34a" }}>{b.liquidoPercent.toFixed(1)}%</b> líquido — o que entrou</span>
        <span><b style={{ color: "#f97316" }}>{b.deducaoPercent.toFixed(1)}%</b> retido pela 99 (<Money value={b.deducaoValor} />)</span>
      </div>
    </div>
  );
}

export function DeliveryNoventaNovePainel({ year, month }: Props) {
  const [painel, setPainel] = useState<PainelDonoNoventaNove | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    getNoventaNovePainelDono({ year, month })
      .then((dados) => { if (ativo) setPainel(dados); })
      .catch((e: unknown) => { if (ativo) setErro(e instanceof Error ? e.message : "Falha ao carregar o painel."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [year, month]);

  if (carregando) {
    return <p style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>Carregando...</p>;
  }
  if (erro) return <Alert tone="error">{erro}</Alert>;
  if (!painel) return null;

  if (painel.semDados) {
    return (
      <Alert tone="warning" title="Sem vendas da 99 neste período">
        Nenhuma venda faturada foi sincronizada para {String(month).padStart(2, "0")}/{year}.
        Não há o que analisar — e nada aqui é estimado.
      </Alert>
    );
  }

  const b = painel.breakdown;
  const inf = b.informadoPelaPlataforma;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {painel.alerts.map((a, i) => (
        <Alert key={i} tone={a.severity === "danger" ? "error" : a.severity === "warn" ? "warning" : "info"} title={a.title}>
          {a.message}
        </Alert>
      ))}

      {/* Número principal + projeção */}
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 280px" }}>
          <PanelEyebrow>Líquido do mês</PanelEyebrow>
          <div style={{ fontSize: "34px", fontWeight: 700, lineHeight: 1.1 }}>
            <Money value={painel.current.netAmount} />
          </div>
          <div style={{ marginTop: "8px", display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "var(--color-text-muted, #6b7280)" }}>vs mês anterior</span>
            <Delta v={painel.previousMonth.deltaNet} />
            <span style={{ fontSize: "13px", color: "var(--color-text-muted, #6b7280)" }}>vs ano passado</span>
            <Delta v={painel.lastYear.deltaNet} />
          </div>
        </Card>

        <Card style={{ flex: "1 1 280px" }}>
          <PanelEyebrow>{painel.projection.ehProjecao ? "Projeção de fechamento" : "Fechamento do mês"}</PanelEyebrow>
          <div style={{ fontSize: "34px", fontWeight: 700, lineHeight: 1.1 }}>
            <Money value={painel.projection.grossAmount} />
          </div>
          <p style={{ marginTop: "8px", fontSize: "13px", color: "var(--color-text-muted, #6b7280)" }}>
            {painel.projection.nota}
          </p>
        </Card>
      </div>

      <div className="df-kpi-grid">
        <SummaryCard label="Bruto do mês" moneyValue={painel.current.grossAmount}
          detail={`${painel.current.orders} pedidos`} tone="neutral" />
        <SummaryCard label="Ticket médio" moneyValue={painel.current.ticketAverage}
          detail="por pedido" tone="info" />
        <SummaryCard label="Ficou com a loja" value={`${b.liquidoPercent.toFixed(1)}%`}
          detail="do bruto"
          tone={b.liquidoPercent >= 85 ? "success" : b.liquidoPercent >= 75 ? "warning" : "danger"} />
        <SummaryCard label="Retido pela 99" moneyValue={b.deducaoValor}
          detail={`${b.deducaoPercent.toFixed(1)}% do bruto`}
          tone={b.deducaoPercent > 25 ? "danger" : "neutral"} />
      </div>

      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow>Para onde foi o faturamento</PanelEyebrow>
          <div style={{ marginTop: "12px" }}><BarraDeducao b={b} /></div>

          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--color-border, #e5e7eb)" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Informado pela 99 por pedido</div>
            {inf.disponivel ? (
              <>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr><td>Taxa da plataforma</td><td style={{ textAlign: "right" }}><Money value={inf.taxa} /></td></tr>
                    <tr><td>Promoção custeada</td><td style={{ textAlign: "right" }}><Money value={inf.promocao} /></td></tr>
                    <tr><td>Entrega</td><td style={{ textAlign: "right" }}><Money value={inf.entrega} /></td></tr>
                    {inf.outrasTaxas !== 0 && (
                      <tr><td>Outras taxas</td><td style={{ textAlign: "right" }}><Money value={inf.outrasTaxas} /></td></tr>
                    )}
                  </tbody>
                </table>
                <p style={{ marginTop: "10px", fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
                  Estes valores <b>não somam</b> com o retido acima. A promoção, em especial, é calculada
                  sobre o preço de tabela, enquanto o bruto já é a receita depois do desconto.
                </p>
              </>
            ) : (
              <p style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
                Não disponível neste mês — o faturamento veio do relatório do portal, que não traz
                a quebra por taxa, promoção e entrega. A dedução total acima continua correta,
                porque é conferida contra o repasse.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <PanelEyebrow><Trophy size={14} style={{ verticalAlign: "-2px" }} /> Ranking das lojas</PanelEyebrow>
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted, #6b7280)" }}>
                <th>Loja</th><th style={{ textAlign: "right" }}>Bruto</th>
                <th style={{ textAlign: "right" }}>Part.</th><th style={{ textAlign: "right" }}>vs mês ant.</th>
              </tr>
            </thead>
            <tbody>
              {painel.ranking.map((loja) => (
                <tr key={loja.storeId}>
                  <td>{loja.storeLabel}<br />
                    <span style={{ color: "var(--color-text-muted, #6b7280)", fontSize: "12px" }}>{loja.orders} pedidos</span>
                  </td>
                  <td style={{ textAlign: "right" }}><Money value={loja.grossAmount} /></td>
                  <td style={{ textAlign: "right" }}>{loja.sharePercent.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }}><Delta v={loja.deltaVsPreviousMonth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow><CalendarDays size={14} style={{ verticalAlign: "-2px" }} /> Por dia da semana</PanelEyebrow>
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted, #6b7280)" }}>
                <th>Dia</th><th style={{ textAlign: "right" }}>Líquido médio</th>
                <th style={{ textAlign: "right" }}>Pedidos</th><th style={{ textAlign: "right" }}>Dias</th>
              </tr>
            </thead>
            <tbody>
              {painel.weekday.map((d) => (
                <tr key={d.dow}>
                  <td>{d.label}</td>
                  <td style={{ textAlign: "right" }}><Money value={d.avgNet} /></td>
                  <td style={{ textAlign: "right" }}>{d.avgOrders}</td>
                  <td style={{ textAlign: "right", color: "var(--color-text-muted, #6b7280)" }}>{d.dias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <PanelEyebrow>Ticket médio por loja</PanelEyebrow>
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted, #6b7280)" }}>
                <th>Loja</th><th style={{ textAlign: "right" }}>Ticket</th>
                <th style={{ textAlign: "right" }}>vs mês ant.</th>
              </tr>
            </thead>
            <tbody>
              {painel.ticketByStore.map((loja) => (
                <tr key={loja.storeId}>
                  <td>{loja.storeLabel}</td>
                  <td style={{ textAlign: "right" }}><Money value={loja.ticket} /></td>
                  <td style={{ textAlign: "right" }}><Delta v={loja.delta} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {painel.alerts.length === 0 && (
        <p style={{ fontSize: "13px", color: "var(--color-text-muted, #6b7280)", display: "flex", alignItems: "center", gap: "6px" }}>
          <AlertTriangle size={14} /> Nenhum alerta neste mês.
        </p>
      )}
    </div>
  );
}
