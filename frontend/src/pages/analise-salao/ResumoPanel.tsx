import type { AnaliseResumo, AnaliseVariacao } from "../../api/client";
import { Alert, KpiCard, PanelEyebrow } from "../../design-system";
import { AlertaSemVenda } from "./AlertaSemVenda";
import { AvisoHoje } from "./AvisoHoje";
import { decimal1, direcao, inteiro, intervalo, percentual, sentido, textoVariacao } from "./formato";
import { GraficoDiario } from "./GraficoDiario";
import { InsightCard, type SecaoDaAnalise } from "./InsightCard";
import { useFormato } from "./useFormato";
import "./visao.css";

const TEXTO_PERIODO_CURTO =
  "Períodos de menos de 14 dias não são comparados com o anterior: o dia da semana pesa demais (sexta a domingo contra terça a quinta) e a variação seria efeito do calendário. Escolha 14 dias ou mais para ver a comparação.";
const TEXTO_BASE_NAO_CONFIAVEL =
  "O período anterior tem poucos dias com movimento (ou nenhum), então não serve de comparação. Os números abaixo valem só para o período escolhido.";

// Sem base (anterior zerado) não há variação relativa: sem selo, em vez de "sem base ... vs. anterior".
const delta = (v: AnaliseVariacao | null) => (v && v.pct !== null ? { text: `${textoVariacao(v)} vs. anterior`, direction: direcao(v) } : null);

function VariacaoEmTexto({ v, subirEBom }: { v: AnaliseVariacao | null; subirEBom: boolean }) {
  if (!v) return null;
  return <span className={`variacao variacao-${sentido(v, subirEBom)}`}>{textoVariacao(v)} vs. anterior</span>;
}

export function ResumoPanel({ dados, onAbrir }: { dados: AnaliseResumo; onAbrir: (secao: SecaoDaAnalise) => void }) {
  const { reaisCompacto } = useFormato();
  const { atual, comparacao, cobertura, serie } = dados;

  if (cobertura.vendasComDetalhe === 0) {
    return (
      <div className="analise-stack">
        <AvisoHoje ativo={dados.hojeFicouDeFora} />
        <AlertaSemVenda dados={dados}>
          Ainda não há venda detalhada neste período. O agente do PDV precisa estar atualizado e o período precisa ser reimportado para o
          histórico aparecer aqui.
        </AlertaSemVenda>
      </div>
    );
  }

  // Dia sem pessoas (fechado) não tem ticket: fica fora da linha em vez de despencar para zero.
  const ticketPorDia = serie.filter((d) => d.pessoas > 0).map((d) => d.faturamento / d.pessoas);
  const perdaTom = atual.perdaPct >= 0.03 ? "danger" : atual.perdaPct >= 0.015 ? "warning" : "neutral";

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        <strong>{intervalo(dados.periodo)}</strong> · {cobertura.diasComMovimento} de {cobertura.diasNoPeriodo} dias com movimento ·{" "}
        {dados.anteriorConfiavel ? <>comparado a {intervalo(dados.periodoAnterior)}</> : "sem período anterior para comparar"}
      </p>
      <p className="analise-nota">
        Faturamento e ticket vêm do total das comandas, que inclui a taxa de serviço. O Cardápio e a Margem usam o preço dos itens, sem a taxa de serviço e antes dos descontos da comanda: por isso os totais não batem de propósito.
      </p>
      <AvisoHoje ativo={dados.hojeFicouDeFora} />
      {!dados.anteriorConfiavel && <Alert tone="info">{dados.motivoSemComparacao === "periodo-curto" ? TEXTO_PERIODO_CURTO : TEXTO_BASE_NAO_CONFIAVEL}</Alert>}

      <div className="analise-kpis analise-kpis-quatro">
        <KpiCard
          label="Faturamento por dia"
          moneyValue={atual.faturamentoPorDia}
          sub={`${reaisCompacto(atual.faturamento)} no período, ${inteiro(atual.comandas)} comandas`}
          delta={delta(comparacao?.faturamentoPorDia ?? null)}
          sparkline={serie.map((d) => d.faturamento)}
        />
        <KpiCard
          label="Pessoas por dia"
          value={decimal1(atual.pessoasPorDia)}
          sub={`${inteiro(atual.pessoas)} pessoas atendidas`}
          delta={delta(comparacao?.pessoasPorDia ?? null)}
          sparkline={serie.map((d) => d.pessoas)}
        />
        <KpiCard
          label="Ticket por pessoa"
          moneyValue={atual.ticketPessoa}
          sub={`ticket por comanda ${reaisCompacto(atual.ticketComanda)}`}
          delta={delta(comparacao?.ticketPessoa ?? null)}
          sparkline={ticketPorDia}
        />
        <KpiCard
          label="Perda potencial"
          value={percentual(atual.perdaPct)}
          tone={perdaTom}
          sub={
            <>
              {reaisCompacto(atual.perdaValor)} do faturamento (até {reaisCompacto(atual.perdaTetoValor)} se nenhuma refação for real). É uma estimativa: nem
              todo valor aqui é dinheiro perdido.
              {comparacao && (
                <>
                  {" "}
                  <VariacaoEmTexto v={comparacao.perdaPct} subirEBom={false} />
                </>
              )}
            </>
          }
        />
      </div>

      <section aria-labelledby="prioridades-titulo">
        <PanelEyebrow id="prioridades-titulo">Prioridades: o que mudou e o que fazer</PanelEyebrow>
        {dados.insights.length === 0 ? (
          <p className="analise-nota">Nada fora do normal neste período: movimento, ticket e perdas estão dentro do esperado.</p>
        ) : (
          <ul className="insights">
            {dados.insights.map((i) => (
              <InsightCard key={i.id} insight={i} onAbrir={onAbrir} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ritmo-titulo">
        <PanelEyebrow id="ritmo-titulo">Ritmo do período</PanelEyebrow>
        <GraficoDiario serie={serie} />
      </section>
    </div>
  );
}
