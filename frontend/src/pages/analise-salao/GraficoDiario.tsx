import type { AnaliseSerieDia } from "../../api/client";
import { agruparSerie, mediaDasBarras } from "./agruparSerie";
import { dataCurta, inteiro, intervalo } from "./formato";
import { useFormato } from "./useFormato";

// Faturamento por dia em barras. Dia sem venda aparece como marca fina (não some): dia parado é
// informação. A linha tracejada é a média dos dias com movimento (ou das semanas completas).
export function GraficoDiario({ serie }: { serie: AnaliseSerieDia[] }) {
  const { reaisCompacto } = useFormato();
  if (serie.length === 0) return null;
  const { barras, semanal } = agruparSerie(serie);
  const maximo = Math.max(1, ...barras.map((b) => b.faturamento));
  const media = mediaDasBarras(barras);
  // Semana cortada pelas pontas não serve de "maior" nem de "menor": só tem parte dos dias.
  const comMovimento = barras.filter((b) => !b.parado && !b.parcial);
  const melhor = comMovimento.reduce<(typeof barras)[number] | null>((a, b) => (a === null || b.faturamento > a.faturamento ? b : a), null);
  const pior = comMovimento.reduce<(typeof barras)[number] | null>((a, b) => (a === null || b.faturamento < a.faturamento ? b : a), null);
  const unidade = semanal ? "semanas" : "dias";
  const primeiro = serie[0].data;
  const ultimo = serie[serie.length - 1].data;
  const comAno = primeiro.slice(0, 4) !== ultimo.slice(0, 4);
  const faixa = intervalo({ inicio: primeiro, fim: ultimo });

  return (
    <figure className="grafico-diario">
      <figcaption className="grafico-legenda">
        {!semanal && (
          <>
            <span>
              <i className="grafico-amostra grafico-amostra-dia" aria-hidden /> dia útil
            </span>
            <span>
              <i className="grafico-amostra grafico-amostra-fim" aria-hidden /> sábado e domingo
            </span>
          </>
        )}
        {semanal && barras.some((b) => b.parcial) && (
          <span>
            <i className="grafico-amostra grafico-amostra-parcial" aria-hidden /> semana parcial (fora da média)
          </span>
        )}
        <span>
          <i className="grafico-amostra grafico-amostra-media" aria-hidden />{" "}
          {semanal ? `média das semanas completas (${reaisCompacto(media)})` : `média dos dias com movimento (${reaisCompacto(media)})`}
        </span>
      </figcaption>
      {/* O gráfico é só visual: o resumo em texto leva a mesma informação a quem usa leitor de tela. */}
      <p className="sr-only">
        {`Média ${reaisCompacto(media)}.`}
        {melhor && pior && ` Maior: ${melhor.rotulo}, ${reaisCompacto(melhor.faturamento)}. Menor com movimento: ${pior.rotulo}, ${reaisCompacto(pior.faturamento)}.`}
      </p>
      <div className="grafico-area" role="img" aria-label={`Faturamento de ${faixa}, ${barras.length} ${unidade}`}>
        <span className="grafico-media" style={{ bottom: `${(media / maximo) * 100}%` }} aria-hidden />
        {barras.map((b) => (
          <span
            key={b.chave}
            className={`grafico-barra${b.fimDeSemana ? " grafico-barra-fim" : ""}${b.parado ? " grafico-barra-parada" : ""}${b.parcial ? " grafico-barra-parcial" : ""}`}
            style={{ height: b.parado ? undefined : `${Math.max(2, (b.faturamento / maximo) * 100)}%` }}
            title={b.parado ? `${b.rotulo}: sem vendas` : `${b.rotulo}: ${reaisCompacto(b.faturamento)} · ${inteiro(b.pessoas)} pessoas`}
          />
        ))}
      </div>
      {!semanal && (
        <div className="grafico-iniciais" aria-hidden>
          {barras.map((b) => (
            <span key={b.chave} className={b.fimDeSemana ? "grafico-inicial-fim" : undefined}>
              {b.inicial}
            </span>
          ))}
        </div>
      )}
      <div className="grafico-eixo" aria-hidden>
        <span>{dataCurta(primeiro, comAno)}</span>
        <span>{dataCurta(ultimo, comAno)}</span>
      </div>
    </figure>
  );
}
