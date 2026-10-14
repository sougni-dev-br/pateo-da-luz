import type { AnaliseMargemBebidas, AnaliseUnidadeDeConsumo } from "../../api/client";
import { KpiCard, PanelEyebrow } from "../../design-system";
import { InsightCard } from "./InsightCard";
import { ListaBebidasAFazer } from "./ListaBebidasAFazer";
import { TabelaMargemBebidas } from "./TabelaMargemBebidas";
import { inteiro, percentual } from "./formato";
import { useFormato } from "./useFormato";
import "./visao.css";

type Props = {
  dados: AnaliseMargemBebidas;
  podeEditar: boolean;
  // insumoId null desfaz o vínculo. Quem chama recarrega o relatório depois.
  onVincular: (codigo: string, nome: string, insumoId: string | null, quantidade?: number, unidade?: AnaliseUnidadeDeConsumo) => Promise<void>;
};

// Margem das bebidas (revenda): preço cobrado no PDV menos o custo de compra do insumo que cada venda consome.
export function MargemBebidasPanel({ dados, podeEditar, onVincular }: Props) {
  const { reais } = useFormato();
  const { cobertura, linhas } = dados;

  if (cobertura.receitaBebidas === 0) {
    return <p className="analise-nota">Nenhuma bebida vendida neste período.</p>;
  }

  const receitaDasLinhas = linhas.reduce((s, l) => s + l.receita, 0);
  const margemDasLinhas = linhas.reduce((s, l) => s + l.margemTotal, 0);
  const margemPonderada = receitaDasLinhas > 0 ? margemDasLinhas / receitaDasLinhas : null;
  const pctSemMargem = cobertura.pctSemVinculo + cobertura.pctCustoIncompleto;

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        Bebida é revenda: <strong>margem = preço médio cobrado no PDV menos o custo de compra</strong> do insumo que cada venda consome (custo médio ATUAL do estoque, aplicado às vendas do período). Não inclui
        perdas, quebra nem mão de obra do bar, e o preço vem do PDV antes dos descontos da comanda.
      </p>

      <div className="analise-kpis analise-kpis-quatro">
        <KpiCard
          label="Bebidas com margem"
          value={percentual(cobertura.pctComMargem, 0)}
          sub={`da receita das bebidas (${reais(cobertura.receitaComMargem)} de ${reais(cobertura.receitaBebidas)})`}
          tone={cobertura.pctComMargem < 0.5 ? "warning" : "neutral"}
        />
        <KpiCard label="Quantas bebidas" value={inteiro(cobertura.bebidasComMargem)} sub={cobertura.bebidasComMargem === 1 ? "bebida vinculada com custo" : "bebidas vinculadas com custo"} />
        <KpiCard
          label="Margem das bebidas com custo"
          value={margemPonderada === null ? "—" : percentual(margemPonderada, 0)}
          sub={margemPonderada === null ? "sem bebida com margem" : `${reais(margemDasLinhas)} depois do custo de compra`}
        />
        <KpiCard label="Sem margem ainda" value={percentual(pctSemMargem, 0)} sub="da receita das bebidas sem vínculo ou sem custo" tone={pctSemMargem > 0.5 ? "warning" : "neutral"} />
      </div>

      {dados.insights.length > 0 && (
        <section aria-labelledby="bebidas-prioridades">
          <PanelEyebrow as="h2" id="bebidas-prioridades">Prioridades: o que a margem das bebidas mostra</PanelEyebrow>
          <ul className="insights">
            {dados.insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="bebidas-tabela">
        <PanelEyebrow as="h2" id="bebidas-tabela">Margem por bebida</PanelEyebrow>
        <TabelaMargemBebidas linhas={linhas} podeEditar={podeEditar} onDesfazer={(codigo, nome) => onVincular(codigo, nome, null)} />
      </section>

      <section aria-labelledby="bebidas-afazer">
        <PanelEyebrow as="h2" id="bebidas-afazer">O que falta para calcular a margem das bebidas, da que mais vende à que menos vende</PanelEyebrow>
        <ListaBebidasAFazer itens={dados.aFazer} total={dados.totalAFazer} insumos={dados.insumosParaVincular} insumosTruncados={dados.insumosTruncados} podeEditar={podeEditar} onVincular={(codigo, nome, insumoId, quantidade, unidade) => onVincular(codigo, nome, insumoId, quantidade, unidade)} />
      </section>
    </div>
  );
}
