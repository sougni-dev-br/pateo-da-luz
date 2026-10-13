import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { WasteAnalysis } from "../../api/client";
import { Money } from "../../design-system";
import { formatNumber, formatPercent } from "../../utils/format";
import { variacao, type Variacao } from "./analise";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Para desperdício, subir é ruim: a cor segue o efeito, não a direção. */
function Delta({ v }: { v: Variacao }) {
  if (v.tipo === "SEM_BASE") return <span className="waste-delta waste-delta--neutro">sem período anterior para comparar</span>;
  if (v.tipo === "IGUAL") return <span className="waste-delta waste-delta--neutro"><Minus size={13} aria-hidden /> igual ao período anterior</span>;
  const sobe = v.tipo === "SOBE";
  return (
    <span className={sobe ? "waste-delta waste-delta--ruim" : "waste-delta waste-delta--bom"}>
      {sobe ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
      <span className="waste-sr">{sobe ? "Subiu" : "Caiu"}</span> {v.percentual}% vs. período anterior
    </span>
  );
}

type Props = { analise: WasteAnalysis; veCusto: boolean };

/** Os números que respondem "quanto, comparado a quê, em relação ao que a loja vende". */
export function IndicadoresDoPeriodo({ analise, veCusto }: Props) {
  const { total, anterior, periodo, faturamento } = analise;
  const mediaPorDia = total.lancamentos / periodo.dias;
  const valor = total.valor;

  if (!veCusto || valor == null) {
    return (
      <dl className="waste-kpis">
        <div>
          <dt>Lançamentos</dt>
          <dd>{formatNumber(total.lancamentos)}</dd>
          <Delta v={variacao(total.lancamentos, anterior.lancamentos)} />
        </div>
        <div>
          <dt>Média por dia</dt>
          <dd>{mediaPorDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</dd>
          <span className="waste-kpi-sub">em {periodo.dias} {periodo.dias === 1 ? "dia" : "dias"}</span>
        </div>
        <div>
          <dt>Itens diferentes</dt>
          <dd>{formatNumber(analise.produtosTotal)}</dd>
        </div>
      </dl>
    );
  }

  const pontos = faturamento?.percentual != null && faturamento.percentualAnterior != null
    ? Math.round((faturamento.percentual - faturamento.percentualAnterior) * 100) / 100
    : null;

  return (
    <dl className="waste-kpis">
      <div className="waste-kpi-principal">
        <dt>Valor desperdiçado</dt>
        <dd><Money value={valor} /></dd>
        <Delta v={variacao(valor, anterior.valor)} />
        {anterior.valor != null && anterior.valor > 0 && <span className="waste-kpi-sub">Período anterior: {brl(anterior.valor)}</span>}
      </div>
      <div>
        <dt>Do faturamento líquido</dt>
        <dd>{faturamento?.percentual != null ? formatPercent(faturamento.percentual, 2) : "—"}</dd>
        {faturamento && faturamento.liquido > 0 ? (
          <>
            <span className="waste-kpi-sub">de {brl(faturamento.liquido)} em {faturamento.diasComVenda} {faturamento.diasComVenda === 1 ? "dia" : "dias"} com venda</span>
            {pontos != null && pontos !== 0 && (
              <span className={pontos > 0 ? "waste-delta waste-delta--ruim" : "waste-delta waste-delta--bom"}>
                {pontos > 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
                {pontos > 0 ? "+" : "−"}{Math.abs(pontos).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p. vs. anterior
              </span>
            )}
          </>
        ) : (
          <span className="waste-kpi-sub">Sem faturamento lançado neste período.</span>
        )}
      </div>
      <div>
        <dt>Lançamentos</dt>
        <dd>{formatNumber(total.lancamentos)}</dd>
        <Delta v={variacao(total.lancamentos, anterior.lancamentos)} />
        <span className="waste-kpi-sub">{mediaPorDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia · {brl(valor / periodo.dias)} por dia</span>
      </div>
      <div>
        <dt>Por cliente atendido</dt>
        <dd>{faturamento?.porPessoa != null ? brl(faturamento.porPessoa) : "—"}</dd>
        <span className="waste-kpi-sub">
          {faturamento && faturamento.pessoas > 0 ? `${formatNumber(faturamento.pessoas)} clientes no período` : "Sem número de clientes no período."}
        </span>
      </div>
    </dl>
  );
}
