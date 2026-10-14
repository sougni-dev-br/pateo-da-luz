import type { AnaliseMargem } from "../../api/client";
import { Alert, KpiCard, PanelEyebrow } from "../../design-system";
import { AvisoHoje } from "./AvisoHoje";
import { InsightCard } from "./InsightCard";
import { ListaAFazer } from "./ListaAFazer";
import { TabelaMargem } from "./TabelaMargem";
import { inteiro, intervalo, percentual } from "./formato";
import { useFormato } from "./useFormato";
import "./visao.css";

type Props = {
  dados: AnaliseMargem;
  podeEditar: boolean;
  // pratoId null desfaz o vínculo. Quem chama recarrega o relatório depois.
  onVincular: (codigo: string, nome: string, pratoId: string | null) => Promise<void>;
};

export function MargemPanel({ dados, podeEditar, onVincular }: Props) {
  const { reais } = useFormato();
  const { cobertura, linhas } = dados;
  const melhor = linhas.reduce<(typeof linhas)[number] | null>((m, l) => (m === null || l.margemTotal > m.margemTotal ? l : m), null);

  if (cobertura.receitaTotal === 0) {
    return (
      <div className="analise-stack">
        <AvisoHoje ativo={dados.hojeFicouDeFora} />
        <Alert tone="info">Ainda não há item vendido neste período. O agente do PDV precisa estar atualizado e o período precisa ser reimportado.</Alert>
      </div>
    );
  }

  if (cobertura.receitaPratos === 0) {
    return (
      <div className="analise-stack">
        <AvisoHoje ativo={dados.hojeFicouDeFora} />
        <Alert tone="info">Neste período só houve venda de buffet e de bebida: não há prato para calcular margem.</Alert>
      </div>
    );
  }

  const receitaDasLinhas = linhas.reduce((s, l) => s + l.receita, 0);
  const margemDasLinhas = linhas.reduce((s, l) => s + l.margemTotal, 0);
  const margemPonderada = receitaDasLinhas > 0 ? margemDasLinhas / receitaDasLinhas : null;
  const pctBuffet = cobertura.receitaTotal > 0 ? cobertura.receitaBuffet / cobertura.receitaTotal : 0;
  const pctBebidas = cobertura.receitaTotal > 0 ? cobertura.receitaBebidas / cobertura.receitaTotal : 0;
  const pctSemMargem = cobertura.pctSemVinculo + cobertura.pctVinculadoSemCusto;

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        <strong>{intervalo(dados.periodo)}</strong> · margem = preço médio cobrado no PDV menos o custo da porção da ficha técnica do salão, <strong>só ingredientes</strong>: não
        inclui mão de obra, perdas nem ocupação, e o preço do item vem do PDV antes dos descontos da comanda. Cada unidade vendida conta como uma porção da ficha: meia porção, combo ou executivo distorcem o número. O <strong>buffet</strong> ({percentual(pctBuffet, 0)} da receita) e as <strong>bebidas</strong> ({percentual(pctBebidas, 0)}) ficam
        fora: a margem do buffet é custo de comida por pessoa, e a da bebida é preço menos custo de compra.
      </p>
      <AvisoHoje ativo={dados.hojeFicouDeFora} />

      <div className="analise-kpis analise-kpis-quatro">
        <KpiCard
          label="Pratos com margem"
          value={percentual(cobertura.pctComMargem, 0)}
          sub={`da receita dos pratos (${reais(cobertura.receitaComMargem)} de ${reais(cobertura.receitaPratos)}), ${percentual(cobertura.pctDaReceitaTotalComMargem, 1)} da receita total`}
          tone={cobertura.pctComMargem < 0.5 ? "warning" : "neutral"}
        />
        <KpiCard label="Quantos pratos" value={inteiro(cobertura.pratosComMargem)} sub={cobertura.pratosComMargem === 1 ? "prato com ficha completa e vínculo" : "pratos com ficha completa e vínculo"} />
        <KpiCard
          label="Margem dos pratos com ficha"
          value={margemPonderada === null ? "—" : percentual(margemPonderada, 0)}
          sub={margemPonderada === null ? "sem prato com margem" : `${reais(margemDasLinhas)} depois dos ingredientes`}
        />
        <KpiCard
          label="Sem margem ainda"
          value={percentual(pctSemMargem, 0)}
          sub="da receita dos pratos sem vínculo ou sem ficha completa"
          tone={pctSemMargem > 0.5 ? "warning" : "neutral"}
        />
      </div>

      {dados.insights.length > 0 && (
        <section aria-labelledby="margem-prioridades">
          <PanelEyebrow id="margem-prioridades">Prioridades: o que a margem mostra</PanelEyebrow>
          <ul className="insights">
            {dados.insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="margem-tabela">
        <PanelEyebrow id="margem-tabela">Margem por prato</PanelEyebrow>
        {melhor && melhor.margemTotal > 0 && (
          <p className="analise-nota">
            O prato que mais deixa no período é <strong>{melhor.prato}</strong>, com {reais(melhor.margemTotal)} depois dos ingredientes.
          </p>
        )}
        <TabelaMargem linhas={linhas} podeEditar={podeEditar} onDesfazer={(codigo, nome) => onVincular(codigo, nome, null)} />
      </section>

      <section aria-labelledby="margem-afazer">
        <PanelEyebrow id="margem-afazer">O que falta para calcular a margem, do que mais vende ao que menos vende</PanelEyebrow>
        <ListaAFazer itens={dados.aFazer} pratos={dados.pratosParaVincular} podeEditar={podeEditar} onVincular={(codigo, nome, pratoId) => onVincular(codigo, nome, pratoId)} />
      </section>
    </div>
  );
}
