import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { getNoventaNovePainelDono, type PainelDonoNoventaNove, type Variacao } from "../api/client";
import { Alert, Card, Money, PanelEyebrow, SummaryCard } from "../design-system";
import "./DeliveryFinance.css";

type Props = { year: number; month: number };

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "ago/2026" — usado no lugar de "mês ant.", que não dizia QUAL mês. */
function rotuloDeMes(year: number, month: number): string {
  return `${MESES_CURTOS[month - 1] ?? month}/${year}`;
}

function deslocarMes(year: number, month: number, passos: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + passos;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const MUTED = "var(--color-text-muted, #6b7280)";

/** Percentual em pt-BR: "42,5%" e nao "42.5%" — o resto da tela ja escreve "R$ 36.000,00". */
const pctBR = (valor: number, casas = 1) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * Variação entre dois períodos. Quando não há base de comparação escreve
 * "sem base" — e não "+100%", que era o que o painel do iFood mostrava: a 99 só
 * tem dados desde abril/2026, então todo mês "cresceria" 100% contra o ano
 * passado, um crescimento que ninguém teve.
 */
function Delta({ v }: { v: Variacao }) {
  if (!v.comparavel) {
    return <span style={{ color: MUTED, fontSize: "13px", whiteSpace: "nowrap" }}>sem base</span>;
  }
  if (v.percentual === 0) {
    return <span style={{ color: MUTED, fontSize: "13px" }}>estável</span>;
  }
  const subiu = v.percentual > 0;
  const Icon = subiu ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: subiu ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: "13px", whiteSpace: "nowrap" }}>
      <Icon size={14} /> {subiu ? "+" : ""}{pctBR(v.percentual)}%
    </span>
  );
}

/**
 * Uma linha de comparação por vez, em vez de quatro elementos numa linha só.
 *
 * O layout anterior punha "vs mês anterior / −6,9% / vs ano passado / sem base
 * de comparação" num `flex-wrap`: em tela estreita o texto longo quebrava e
 * "sem base de comparação" ficava debaixo do rótulo errado.
 */
function LinhaComparacao({ rotulo, v }: { rotulo: string; v: Variacao }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px", alignItems: "baseline" }}>
      <span style={{ color: MUTED }}>vs {rotulo}</span>
      <Delta v={v} />
    </div>
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
        <span><b style={{ color: "#16a34a" }}>{pctBR(b.liquidoPercent)}%</b> líquido — o que entrou</span>
        <span><b style={{ color: "#f97316" }}>{pctBR(b.deducaoPercent)}%</b> retido pela 99 (<Money value={b.deducaoValor} />)</span>
      </div>
    </div>
  );
}

/**
 * Do cardápio ao caixa.
 *
 * O painel só falava sobre o BRUTO, e o bruto já é a receita depois do desconto
 * de delivery — daí "ficou com a loja: 89,4%" num canal onde, sobre o preço
 * anunciado, chegam 42,5%. As quatro fatias abaixo somam exatamente o preço de
 * tabela: líquido + retido pela 99 + desconto bancado pela loja + desconto
 * bancado pela plataforma.
 */
function DoCardapioAoCaixa({ t }: { t: PainelDonoNoventaNove["precoDeTabela"] }) {
  const retido = t.bruto - t.liquido;
  const pct = (valor: number) => (t.tabela > 0 ? (valor / t.tabela) * 100 : 0);
  const fatias = [
    { rotulo: "Líquido no caixa", valor: t.liquido, cor: "#16a34a" },
    { rotulo: "Retido pela 99", valor: retido, cor: "#f97316" },
    { rotulo: "Desconto bancado pela loja", valor: t.bancadoPelaLoja, cor: "#dc2626" },
    { rotulo: "Desconto bancado pela 99", valor: t.bancadoPelaPlataforma, cor: "#9ca3af" }
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", color: MUTED }}>Preço anunciado no cardápio</span>
        <b style={{ fontSize: "16px" }}><Money value={t.tabela} /></b>
      </div>

      <div style={{ display: "flex", height: "28px", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--color-border, #e5e7eb)", marginTop: "8px" }}>
        {fatias.map((f) => (
          <div key={f.rotulo} style={{ width: `${pct(f.valor)}%`, background: f.cor }} title={`${f.rotulo} — ${pctBR(pct(f.valor))}%`} />
        ))}
      </div>

      <table style={{ width: "100%", fontSize: "13px", marginTop: "12px" }}>
        <tbody>
          {fatias.map((f) => (
            <tr key={f.rotulo}>
              <td>
                <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: f.cor, marginRight: "8px" }} />
                {f.rotulo}
              </td>
              <td style={{ textAlign: "right" }}><Money value={f.valor} /></td>
              <td style={{ textAlign: "right", color: MUTED, width: "56px" }}>{pctBR(pct(f.valor))}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: "12px", fontSize: "13px" }}>
        De cada <b>R$ 100</b> anunciados no cardápio, entram <b>R$ {pctBR(t.liquidoSobreTabelaPercent, 0)}</b> no caixa.
        O desconto levou <b>{pctBR(t.descontoPercent)}%</b> do preço de tabela — e a loja bancou{" "}
        <b><Money value={t.bancadoPelaLoja} /></b> dessa conta.
      </p>

      {t.cobertura.comTabela < t.cobertura.total && (
        <p style={{ marginTop: "8px", fontSize: "12px", color: MUTED }}>
          Medido sobre {t.cobertura.comTabela} dos {t.cobertura.total} pedidos do mês — o resto não veio com
          o preço de tabela. Os percentuais valem para essa parte.
        </p>
      )}
    </div>
  );
}

/**
 * Queda de loja vira um bloco só. Com 4 lojas o painel abria com quatro tarjas
 * vermelhas idênticas empilhadas antes de qualquer número, e o alerta que
 * realmente mudava a decisão ficava enterrado no meio delas.
 */
function QuedasDeLoja({ alertas }: { alertas: PainelDonoNoventaNove["alerts"] }) {
  if (alertas.length === 0) return null;
  return (
    <Alert tone="warning" title={`${alertas.length} loja(s) caíram contra o mês anterior`}>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "13px" }}>
          {alertas.map((a) => a.title.replace(/ caiu$/, "")).join(", ")} — ver detalhe
        </summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px" }}>
          {alertas.map((a) => (
            <li key={a.storeId}><b>{a.title.replace(/ caiu$/, "")}:</b> {a.message}</li>
          ))}
        </ul>
      </details>
    </Alert>
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
    return <p style={{ padding: "24px", textAlign: "center", color: MUTED }}>Carregando...</p>;
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
  const t = painel.precoDeTabela;
  const mesAnterior = deslocarMes(year, month, -1);
  const rotuloMesAnterior = rotuloDeMes(mesAnterior.year, mesAnterior.month);
  const rotuloAnoPassado = rotuloDeMes(year - 1, month);

  const quedasDeLoja = painel.alerts.filter((a) => a.storeId !== null);
  const alertasGerais = painel.alerts.filter((a) => a.storeId === null);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {alertasGerais.map((a, i) => (
        <Alert key={i} tone={a.severity === "danger" ? "error" : a.severity === "warn" ? "warning" : "info"} title={a.title}>
          {a.message}
        </Alert>
      ))}
      <QuedasDeLoja alertas={quedasDeLoja} />

      {/* Número principal + projeção */}
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 280px" }}>
          <PanelEyebrow>Líquido do mês</PanelEyebrow>
          <div style={{ fontSize: "34px", fontWeight: 700, lineHeight: 1.1 }}>
            <Money value={painel.current.netAmount} />
          </div>
          <div style={{ marginTop: "10px", display: "grid", gap: "4px" }}>
            <LinhaComparacao rotulo={rotuloMesAnterior} v={painel.previousMonth.deltaNet} />
            <LinhaComparacao rotulo={rotuloAnoPassado} v={painel.lastYear.deltaNet} />
          </div>
        </Card>

        <Card style={{ flex: "1 1 280px" }}>
          <PanelEyebrow>{painel.projection.ehProjecao ? "Projeção de fechamento" : "Fechamento do mês"}</PanelEyebrow>
          <div style={{ fontSize: "34px", fontWeight: 700, lineHeight: 1.1 }}>
            <Money value={painel.projection.grossAmount} />
          </div>
          <p style={{ marginTop: "8px", fontSize: "13px", color: MUTED }}>
            {painel.projection.nota}
          </p>
        </Card>
      </div>

      <div className="df-kpi-grid">
        <SummaryCard label="Bruto do mês" moneyValue={painel.current.grossAmount}
          detail={`${painel.current.orders} pedidos`} tone="neutral" />
        <SummaryCard label="Ticket médio" moneyValue={painel.current.ticketAverage}
          detail="por pedido" tone="info" />
        {/* O número que responde "o canal vale a pena?" é sobre o preço ANUNCIADO,
            não sobre o bruto — o bruto já é a receita depois do desconto. */}
        {t.disponivel ? (
          <SummaryCard label="Chegou ao caixa" value={`${pctBR(t.liquidoSobreTabelaPercent)}%`}
            detail={`do preço anunciado · ${pctBR(b.liquidoPercent)}% do bruto`}
            tone={t.liquidoSobreTabelaPercent >= 60 ? "success" : t.liquidoSobreTabelaPercent >= 55 ? "warning" : "danger"} />
        ) : (
          <SummaryCard label="Ficou com a loja" value={`${pctBR(b.liquidoPercent)}%`}
            detail="do bruto · preço anunciado indisponível neste mês"
            tone={b.liquidoPercent >= 85 ? "success" : b.liquidoPercent >= 75 ? "warning" : "danger"} />
        )}
        <SummaryCard label="Retido pela 99" moneyValue={b.deducaoValor}
          detail={`${pctBR(b.deducaoPercent)}% do bruto`}
          tone={b.deducaoPercent > 25 ? "danger" : "neutral"} />
      </div>

      <Card>
        <PanelEyebrow>Do cardápio ao caixa</PanelEyebrow>
        <div style={{ marginTop: "12px" }}>
          {t.disponivel ? (
            <DoCardapioAoCaixa t={t} />
          ) : (
            <p style={{ fontSize: "13px", color: MUTED }}>
              Não disponível neste mês — o faturamento veio do relatório do portal, que não traz o preço
              de tabela de cada pedido. Sem ele não dá para dizer quanto do preço anunciado chegou ao
              caixa, e este painel não estima. Os meses com dado de API mostram a conta completa.
            </p>
          )}
        </div>
      </Card>

      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow>Para onde foi o faturamento bruto</PanelEyebrow>
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
                <p style={{ marginTop: "10px", fontSize: "12px", color: MUTED }}>
                  Estes valores <b>não somam</b> com o retido acima. A promoção, em especial, é calculada
                  sobre o preço de tabela, enquanto o bruto já é a receita depois do desconto — ela aparece
                  no lugar certo em "Do cardápio ao caixa".
                </p>
              </>
            ) : (
              <p style={{ fontSize: "12px", color: MUTED }}>
                Não disponível neste mês — o faturamento veio do relatório do portal, que não traz a quebra
                por taxa, promoção e entrega. A dedução total acima continua correta, porque é conferida
                contra o repasse.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <PanelEyebrow><Trophy size={14} style={{ verticalAlign: "-2px" }} /> Ranking das lojas</PanelEyebrow>
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: MUTED }}>
                <th>Loja</th><th style={{ textAlign: "right" }}>Bruto</th>
                <th style={{ textAlign: "right" }}>Part.</th>
                <th style={{ textAlign: "right" }}>vs {rotuloMesAnterior}</th>
              </tr>
            </thead>
            <tbody>
              {painel.ranking.map((loja) => (
                <tr key={loja.storeId}>
                  <td>{loja.storeLabel}<br />
                    <span style={{ color: MUTED, fontSize: "12px" }}>{loja.orders} pedidos</span>
                  </td>
                  <td style={{ textAlign: "right" }}><Money value={loja.grossAmount} /></td>
                  <td style={{ textAlign: "right" }}>{pctBR(loja.sharePercent)}%</td>
                  <td style={{ textAlign: "right" }}><Delta v={loja.deltaVsPreviousMonth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: "10px", fontSize: "12px", color: MUTED }}>
            "vs {rotuloMesAnterior}" compara o <b>líquido</b> da loja com o mesmo mês anterior.
          </p>
        </Card>
      </div>

      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <Card>
          <PanelEyebrow><CalendarDays size={14} style={{ verticalAlign: "-2px" }} /> Por dia da semana</PanelEyebrow>
          {/* Os dois valores do meio são MÉDIA POR DIA, não total do mês. O rótulo
              "Pedidos" fazia parecer o total — 30 pedidos numa terça, quando eram
              30 por terça. */}
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: MUTED }}>
                <th>Dia</th><th style={{ textAlign: "right" }}>Líquido / dia</th>
                <th style={{ textAlign: "right" }}>Pedidos / dia</th><th style={{ textAlign: "right" }}>Dias</th>
              </tr>
            </thead>
            <tbody>
              {painel.weekday.map((d) => (
                <tr key={d.dow}>
                  <td>{d.label}</td>
                  <td style={{ textAlign: "right" }}><Money value={d.avgNet} /></td>
                  <td style={{ textAlign: "right" }}>{d.avgOrders}</td>
                  <td style={{ textAlign: "right", color: MUTED }}>{d.dias}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: "10px", fontSize: "12px", color: MUTED }}>
            Média por ocorrência do dia no mês. "Dias" é quantas vezes o dia aconteceu com venda.
          </p>
        </Card>

        <Card>
          <PanelEyebrow>Ticket médio por loja</PanelEyebrow>
          <table style={{ width: "100%", marginTop: "12px", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: MUTED }}>
                <th>Loja</th><th style={{ textAlign: "right" }}>Ticket</th>
                <th style={{ textAlign: "right" }}>vs {rotuloMesAnterior}</th>
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
        <p style={{ fontSize: "13px", color: MUTED, display: "flex", alignItems: "center", gap: "6px" }}>
          <AlertTriangle size={14} /> Nenhum alerta neste mês.
        </p>
      )}
    </div>
  );
}
