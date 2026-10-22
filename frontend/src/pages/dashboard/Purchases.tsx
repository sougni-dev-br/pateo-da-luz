import { ArrowRight, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import type { DashboardNatureKey, DashboardRankingView, Purchase } from "../../api/client";
import { Money, Tabs, useFormatCurrency } from "../../design-system";
import { formatDate, formatNumber, formatPercent } from "../../utils/format";
import { DeltaChip } from "./Panels";
import { withRemainder, type Delta, type RankingRow } from "./logic";
import {
  COR_NATUREZA,
  composicao,
  DICA_NATUREZA,
  ROTULO_NATUREZA,
  visaoInicial,
  type VisaoCompras,
} from "./naturezas";
import "./naturezas.css";

type Dimension = "category" | "subcategory" | "supplier" | "product";
type RankingSimples = { rows: RankingRow[]; total?: number };

export type NaturezasDasCompras = {
  byNature: Array<{ nature: DashboardNatureKey; total: number; items: number }>;
  unitemizedTotal: number;
  views: Partial<Record<VisaoCompras, DashboardRankingView>>;
};

type Props = {
  total: number;
  /** null quando o resumo não carregou — aí a legenda de notas some. */
  count: number | null;
  delta: Delta | null;
  reference?: string;
  /** Rankings sem separação (backend anterior à natureza). */
  rankings: Record<Exclude<Dimension, "subcategory">, RankingSimples>;
  /** Separação por natureza; quando vem, manda nos rankings. */
  naturezas?: NaturezasDasCompras;
  emptyAction?: { label: string; onClick: () => void };
};

const TABS: Array<{ value: Dimension; label: string }> = [
  { value: "category", label: "Categoria" },
  { value: "subcategory", label: "Subcategoria" },
  { value: "supplier", label: "Fornecedor" },
  { value: "product", label: "Produto" },
];

function nomeDaVisao(visao: VisaoCompras): string {
  return visao === "TODAS" ? "Todas as compras" : ROTULO_NATUREZA[visao];
}

export function PurchasesPanel({ total, count, delta, reference, rankings, naturezas, emptyAction }: Props) {
  const [dimension, setDimension] = useState<Dimension>("category");
  // Categorias abertas para mostrar as subcategorias (chave inclui a natureza).
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set());
  const prefixoId = useId();
  const alternar = (chave: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  // Até a pessoa escolher, a visão acompanha os dados (abre em Insumos quando o mês tem insumo);
  // depois de escolher, a escolha vale também para os outros meses.
  const [escolha, setVisao] = useState<VisaoCompras | null>(null);
  const visao: VisaoCompras = escolha ?? (naturezas ? visaoInicial(naturezas.byNature) : "TODAS");

  const view = naturezas?.views[visao];
  // A escolha da natureza sobrevive à troca de mês; mês sem aquela natureza mostra lista vazia.
  // Sem a aba no backend (versão anterior) ou sem rankings por natureza, subcategoria cai na categoria.
  const dimensaoValida: Dimension = dimension === "subcategory" && !view?.subcategory ? "category" : dimension;
  const current: RankingSimples = naturezas
    ? view
      ? (view[dimensaoValida] ?? { rows: [], total: 0 })
      : { rows: [], total: 0 }
    : rankings[dimensaoValida === "subcategory" ? "category" : dimensaoValida];
  const rows = withRemainder(current.rows, current.total);
  const base = current.total ?? rows.reduce((s, r) => s + r.total, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const corDaBarra = visao === "TODAS" ? COR_NATUREZA.INSUMO : COR_NATUREZA[visao];
  const legendaNotas = count === null ? "" : count > 0 ? `${formatNumber(count)} nota${count !== 1 ? "s" : ""}` : "Nenhuma compra lançada";

  return (
    <section className="dash-card dash-purchases" aria-labelledby="dash-purchases-title">
      <div className="dash-purchases-head">
        <div>
          <h2 id="dash-purchases-title" className="dash-eyebrow">Compras do mês</h2>
          <p className="dash-stat-value dash-stat-value--lg">{total > 0 ? <Money value={total} /> : "—"}</p>
          <p className="dash-stat-label" title="Notas pela competência do mês (data de recebimento). A tela Compras lista pela data da nota, então nota recebida num mês e datada em outro aparece só aqui.">
            {[legendaNotas && `${legendaNotas} por competência`, reference].filter(Boolean).join(" · ")}
          </p>
        </div>
        <DeltaChip delta={delta} />
      </div>

      {naturezas && naturezas.byNature.length > 0 && (
        <ComposicaoPorNatureza naturezas={naturezas} visao={visao} onChange={setVisao} />
      )}

      {rows.length === 0 ? (
        <div className="dash-empty">
          <p>
            {visao === "TODAS"
              ? "Nenhuma compra registrada neste mês."
              : `Nenhuma compra de ${ROTULO_NATUREZA[visao].toLowerCase()} neste mês.`}
          </p>
          {emptyAction && visao === "TODAS" && (
            <button type="button" className="dash-link-btn" onClick={emptyAction.onClick}>
              {emptyAction.label} <ArrowRight size={14} />
            </button>
          )}
        </div>
      ) : (
        <>
          <Tabs
            className="dash-purchases-tabs"
            tabs={naturezas && Object.values(naturezas.views).some((v) => v?.subcategory) ? TABS : TABS.filter((t) => t.value !== "subcategory")}
            value={dimensaoValida}
            onChange={(v) => setDimension(v as Dimension)}
            aria-label="Distribuir compras por"
          />
          <div
            role="tabpanel"
            aria-label={`${nomeDaVisao(visao)} por ${TABS.find((t) => t.value === dimensaoValida)?.label.toLowerCase()}`}
          >
            <ol className="dash-bars">
              {rows.map((row, i) => {
                const share = base > 0 ? (row.total / base) * 100 : 0;
                const width = max > 0 ? Math.max((row.total / max) * 100, 1.5) : 0;
                const estilo = row.isRemainder ? { width: `${width}%` } : { width: `${width}%`, background: corDaBarra };
                const temSub = dimensaoValida === "category" && !!row.children && row.children.length > 0;
                const chave = `${visao}-${row.name}`;
                const aberta = temSub && abertas.has(chave);
                const idSub = `${prefixoId}-sub-${i}`;
                return (
                  <li
                    key={`${visao}-${dimensaoValida}-${row.group ?? ""}-${row.name}`}
                    className={`dash-bar-row${row.isRemainder ? " is-remainder" : ""}${temSub ? " has-sub" : ""}`}
                  >
                    <span className="dash-bar-rank" aria-hidden>{row.isRemainder ? "" : i + 1}</span>
                    {temSub ? (
                      <button
                        type="button"
                        className="dash-bar-name dash-bar-toggle"
                        aria-expanded={aberta}
                        aria-controls={aberta ? idSub : undefined}
                        title={`${row.name} — ver subcategorias`}
                        onClick={() => alternar(chave)}
                      >
                        <ChevronRight size={14} className="dash-bar-chevron" aria-hidden />
                        <span>{row.name}</span>
                      </button>
                    ) : row.group ? (
                      <span className="dash-bar-name" title={`${row.name} · ${row.group}`}>
                        <span className={row.name === "Sem subcategoria" ? "dash-bar-missing" : undefined}>{row.name}</span>
                        <span className="dash-bar-group"> · {row.group}</span>
                      </span>
                    ) : (
                      <span className="dash-bar-name" title={row.name}>{row.name}</span>
                    )}
                    <span className="dash-bar-value"><Money value={row.total} /></span>
                    <span className="dash-bar-share">{formatPercent(share)}</span>
                    <span className="dash-bar-track" aria-hidden>
                      <span className="dash-bar-fill" style={estilo} />
                    </span>
                    {aberta && (
                      <ul className="dash-sub-list" id={idSub} aria-label={`Subcategorias de ${row.name}`}>
                        {row.children!.map((sub) => {
                          const pctSub = row.total > 0 ? (sub.total / row.total) * 100 : 0;
                          return (
                            <li key={sub.name} className={`dash-sub-row${sub.name === "Sem subcategoria" ? " is-missing" : ""}`}>
                              <span className="dash-sub-name" title={sub.name}>{sub.name}</span>
                              <span className="dash-sub-value"><Money value={sub.total} /></span>
                              <span className="dash-sub-share">{formatPercent(pctSub)}</span>
                              <span className="dash-sub-track" aria-hidden>
                                <span className="dash-sub-fill" style={{ width: `${Math.max(pctSub, 1.5)}%`, background: corDaBarra }} />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
            {dimensaoValida === "category" && rows.some((r) => r.children && r.children.length > 0) && (
              <p className="dash-footnote">Toque numa categoria para ver as subcategorias; o percentual delas é dentro da categoria.</p>
            )}
            {visao !== "TODAS" && dimensaoValida === "supplier" && (
              <p className="dash-footnote">Cada fornecedor soma só os itens desta natureza, não a nota inteira.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Barra com a composição das compras por natureza. A legenda abaixo é também o
 * filtro: escolher uma natureza recorta os rankings. Cor nunca sozinha: cada
 * pílula tem nome e percentual.
 */
function ComposicaoPorNatureza({
  naturezas,
  visao,
  onChange,
}: {
  naturezas: NaturezasDasCompras;
  visao: VisaoCompras;
  onChange: (v: VisaoCompras) => void;
}) {
  const fmt = useFormatCurrency();
  const segmentos = composicao(naturezas.byNature, naturezas.unitemizedTotal);
  const corDe = (chave: string) =>
    chave in COR_NATUREZA && chave !== "SEM_NATUREZA" ? { background: COR_NATUREZA[chave as DashboardNatureKey] } : undefined;

  return (
    <div className="dash-nature">
      <div className="dash-nature-bar" aria-hidden>
        {segmentos.map((s) => (
          <span
            key={s.chave}
            className={`dash-nature-seg dash-nature-seg--${s.chave.toLowerCase()}${visao !== "TODAS" && s.chave !== visao ? " is-dim" : ""}`}
            style={{ flexGrow: s.total, ...corDe(s.chave) }}
            title={`${s.rotulo}: ${fmt(s.total)} (${formatPercent(s.pct)})`}
          />
        ))}
      </div>
      <div className="dash-nature-chips" role="group" aria-label="Filtrar compras por natureza">
        <button type="button" className="dash-nature-chip" aria-pressed={visao === "TODAS"} onClick={() => onChange("TODAS")}>
          Todas
        </button>
        {segmentos.map((s) =>
          s.chave === "SEM_ITENS" ? (
            <span key={s.chave} className="dash-nature-chip is-static" title="Valor das notas que não está em nenhum item (nota sem itemização, frete, acréscimos)">
              <span className="dash-nature-key dash-nature-key--sem_itens" aria-hidden />
              {s.rotulo} <small>{formatPercent(s.pct)}</small>
            </span>
          ) : (
            <button
              key={s.chave}
              type="button"
              className="dash-nature-chip"
              aria-pressed={visao === s.chave}
              title={DICA_NATUREZA[s.chave]}
              onClick={() => onChange(s.chave as DashboardNatureKey)}
            >
              <span className={`dash-nature-key dash-nature-key--${s.chave.toLowerCase()}`} style={corDe(s.chave)} aria-hidden />
              {s.rotulo} <small>{formatPercent(s.pct)}</small>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function RecentPurchases({ purchases, onOpenAll }: { purchases: Purchase[]; onOpenAll: () => void }) {
  return (
    <section className="dash-card dash-recent" aria-labelledby="dash-recent-title">
      <h2 id="dash-recent-title" className="dash-eyebrow">Últimas compras</h2>
      <ul className="dash-recent-list">
        {purchases.map((p) => (
          <li key={p.id} className="dash-recent-row">
            <span className="dash-recent-supplier">{p.supplier?.name ?? "—"}</span>
            <span className="dash-recent-meta">
              {formatDate(p.purchaseDate)}
              {p.invoiceNumber ? ` · NF ${p.invoiceNumber}` : p.purchaseNumber ? ` · #${p.purchaseNumber}` : ""}
            </span>
            <strong className="dash-recent-amount"><Money value={p.totalAmount} /></strong>
          </li>
        ))}
      </ul>
      <button type="button" className="dash-link-btn" onClick={onOpenAll}>
        Ver todas as compras <ArrowRight size={14} />
      </button>
    </section>
  );
}
