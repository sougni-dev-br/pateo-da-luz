import { useEffect, useMemo, useState } from "react";
// Sem icone nos cards de valor: em 375px o icone rouba largura do numero e
// "R$ 34.500,00" virava "R$ 34.5...".
import { CalendarDays, TrendingDown, TrendingUp } from "lucide-react";
import { getKeetaSummary, type KeetaPeriodSummary, type Variacao } from "../api/client";
import { Alert, Card, Money, PanelEyebrow, Select, SummaryCard } from "../design-system";
import "./DeliveryFinance.css";

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MUTED = "var(--color-text-muted, #6b7280)";

const pctBR = (valor: number, casas = 1) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function buildMonthOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  const options: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MESES_PT[d.getMonth()]} / ${d.getFullYear()}`
    });
  }
  return options;
}

function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-");
  return { year: Number(y), month: Number(m) };
}

/** Mesma regra do painel da 99: sem base de comparação não se inventa +100%. */
function Delta({ v }: { v: Variacao }) {
  if (!v.comparavel) return <span style={{ color: MUTED, fontSize: "13px" }}>sem base</span>;
  if (v.percentual === 0) return <span style={{ color: MUTED, fontSize: "13px" }}>estável</span>;
  const subiu = v.percentual > 0;
  const Icon = subiu ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: subiu ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: "13px", whiteSpace: "nowrap" }}>
      <Icon size={14} /> {subiu ? "+" : ""}{pctBR(v.percentual)}%
    </span>
  );
}

export function DeliveryKeeta() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0]?.value ?? "");
  const [resumo, setResumo] = useState<KeetaPeriodSummary | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const { year, month } = useMemo(() => parseMonthKey(selectedMonth || "2026-09"), [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    let ativo = true;
    setCarregando(true);
    setErro(null);
    getKeetaSummary({ year, month })
      .then((d) => { if (ativo) setResumo(d); })
      .catch((e: unknown) => { if (ativo) setErro(e instanceof Error ? e.message : "Falha ao carregar o faturamento da Keeta."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [selectedMonth, year, month]);

  const rotuloAnterior = resumo
    ? `${MESES_PT[resumo.previousMonth.month - 1]?.slice(0, 3).toLowerCase()}/${resumo.previousMonth.year}`
    : "";

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

      {/* A Keeta é a única plataforma sem integração. Dizer de onde vem o número
          evita a pergunta "por que aqui não tem loja nem repasse como na 99". */}
      <Alert tone="info" title="O faturamento da Keeta vem do portal">
        A Keeta não tem integração com o ERP: os valores abaixo foram importados do portal da
        plataforma, por data de conclusão do pedido, e cada mês foi conferido contra a fatura.
        Por isso não há quebra por loja nem repasse individual — e o lançamento manual da Keeta
        no "Fechar o dia" está desativado, para não somar duas vezes.
      </Alert>

      {erro && <Alert tone="error">{erro}</Alert>}

      {carregando ? (
        <p style={{ padding: "24px", textAlign: "center", color: MUTED }}>Carregando...</p>
      ) : !resumo ? null : resumo.semDados ? (
        <Alert tone="warning" title="Sem faturamento da Keeta neste período">
          Nenhuma venda da Keeta foi importada para {String(month).padStart(2, "0")}/{year}.
          O valor é <b>zero</b>, não uma estimativa.
        </Alert>
      ) : (
        <>
          <div className="df-kpi-grid">
            <SummaryCard label="Faturamento bruto" moneyValue={resumo.totals.grossAmount}
              detail={`${resumo.totals.orders} pedidos`} tone="neutral" />
            <SummaryCard label="Líquido recebido" moneyValue={resumo.totals.netAmount}
              detail={`${pctBR(resumo.totals.netPercent)}% do bruto`} tone="success" />
            <SummaryCard label="Retido pela Keeta" moneyValue={resumo.totals.deductionAmount}
              detail={`${pctBR(resumo.totals.deductionPercent)}% do bruto`}
              tone={resumo.totals.deductionPercent > 25 ? "danger" : "neutral"} />
            <SummaryCard label="Ticket médio" moneyValue={resumo.totals.ticketAverage}
              detail="por pedido" tone="info" />
          </div>

          <Card>
            <PanelEyebrow>Contra {rotuloAnterior}</PanelEyebrow>
            <div style={{ display: "grid", gap: "8px", marginTop: "12px", fontSize: "14px" }}>
              {[
                { rotulo: "Bruto", atual: resumo.totals.grossAmount, anterior: resumo.previousMonth.totals.grossAmount, delta: resumo.previousMonth.deltaGross },
                { rotulo: "Líquido", atual: resumo.totals.netAmount, anterior: resumo.previousMonth.totals.netAmount, delta: resumo.previousMonth.deltaNet }
              ].map((linha) => (
                <div key={linha.rotulo} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
                  <span style={{ color: MUTED }}>{linha.rotulo}</span>
                  <span style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
                    <span style={{ color: MUTED, fontSize: "13px" }}><Money value={linha.anterior} /> →</span>
                    <b><Money value={linha.atual} /></b>
                    <Delta v={linha.delta} />
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
                <span style={{ color: MUTED }}>Pedidos</span>
                <span style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
                  <span style={{ color: MUTED, fontSize: "13px" }}>{resumo.previousMonth.totals.orders} →</span>
                  <b>{resumo.totals.orders}</b>
                  <Delta v={resumo.previousMonth.deltaOrders} />
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <PanelEyebrow><CalendarDays size={14} style={{ verticalAlign: "-2px" }} /> Dia a dia</PanelEyebrow>
            <div style={{ overflowX: "auto", marginTop: "12px" }}>
              <table style={{ width: "100%", fontSize: "13px", minWidth: "420px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: MUTED }}>
                    <th>Dia</th>
                    <th style={{ textAlign: "right" }}>Pedidos</th>
                    <th style={{ textAlign: "right" }}>Bruto</th>
                    <th style={{ textAlign: "right" }}>Líquido</th>
                    <th style={{ textAlign: "right" }}>Retido</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.daily.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</td>
                      <td style={{ textAlign: "right" }}>{d.orders}</td>
                      <td style={{ textAlign: "right" }}><Money value={d.grossAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={d.netAmount} /></td>
                      <td style={{ textAlign: "right", color: MUTED }}><Money value={d.grossAmount - d.netAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
