import type { WasteAnalysis } from "../../api/client";
import { formatDate } from "../../utils/format";
import { serieDoGrafico } from "./analise";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = { analise: WasteAnalysis; veCusto: boolean };

type Medivel = { valor: number | null; lancamentos: number };
const medida = (item: Medivel, veCusto: boolean) => (veCusto ? item.valor ?? 0 : item.lancamentos);
const texto = (item: Medivel, veCusto: boolean) =>
  veCusto && item.valor != null ? brl(item.valor) : `${item.lancamentos} ${item.lancamentos === 1 ? "lançamento" : "lançamentos"}`;

/** Quando perde (dia a dia) e em que dia da semana perde mais. Barras em CSS: nada de biblioteca para 30 retângulos. */
export function TendenciaDoPeriodo({ analise, veCusto }: Props) {
  const { barras, porSemana } = serieDoGrafico(analise.porDia);
  const maior = Math.max(...barras.map((b) => medida(b, veCusto)), 0);
  const pico = barras.reduce((a, b) => (medida(b, veCusto) > medida(a, veCusto) ? b : a), barras[0]);
  const rotuloDaBarra = (b: (typeof barras)[number]) => (b.inicio === b.fim ? formatDate(b.inicio) : `${formatDate(b.inicio)} a ${formatDate(b.fim)}`);

  const dias = analise.porDiaDaSemana;
  // Média por ocorrência: sábado com 5 ocorrências no período não pode parecer pior só por ter mais dias.
  const mediaDoDia = (d: (typeof dias)[number]) => (d.ocorrencias > 0 ? medida(d, veCusto) / d.ocorrencias : 0);
  const maiorMedia = Math.max(...dias.map(mediaDoDia), 0);

  return (
    <div className="waste-trend">
      <section className="waste-card" aria-labelledby="waste-serie-titulo">
        <h3 id="waste-serie-titulo">{porSemana ? "Por semana" : "Por dia"}</h3>
        {maior === 0 ? (
          <p className="waste-note">Nenhum valor no período.</p>
        ) : (
          <>
            <div
              className="waste-bars"
              role="img"
              aria-label={`${porSemana ? "Desperdício por semana" : "Desperdício por dia"}. Maior ${porSemana ? "semana" : "dia"}: ${rotuloDaBarra(pico)}, ${texto(pico, veCusto)}.`}
            >
              {barras.map((b) => (
                <span key={b.inicio} className="waste-bar-col" title={`${rotuloDaBarra(b)}: ${texto(b, veCusto)}`}>
                  <span className={b === pico ? "waste-bar-fill waste-bar-fill--pico" : "waste-bar-fill"} style={{ height: medida(b, veCusto) > 0 ? `${Math.max((medida(b, veCusto) / maior) * 100, 3)}%` : "0" }} />
                </span>
              ))}
            </div>
            <div className="waste-bars-axis" aria-hidden>
              <span>{formatDate(barras[0].inicio).slice(0, 5)}</span>
              <span className="waste-bars-max">pico {texto(pico, veCusto)}</span>
              <span>{formatDate(barras[barras.length - 1].fim).slice(0, 5)}</span>
            </div>
            <p className="waste-note">Maior {porSemana ? "semana" : "dia"}: <strong>{rotuloDaBarra(pico)}</strong> · {texto(pico, veCusto)}</p>
          </>
        )}
      </section>

      <section className="waste-card" aria-labelledby="waste-semana-titulo">
        <h3 id="waste-semana-titulo">Por dia da semana</h3>
        {maiorMedia === 0 ? (
          <p className="waste-note">Nenhum valor no período.</p>
        ) : (
          <>
            <ul className="waste-weekdays">
              {dias.map((d) => {
                const media = mediaDoDia(d);
                return (
                  <li key={d.diaDaSemana}>
                    <span className="waste-weekday-name">{d.nome.slice(0, 3)}</span>
                    <span className="waste-weekday-track" aria-hidden><span style={{ width: `${(media / maiorMedia) * 100}%` }} /></span>
                    <span className="waste-weekday-value">
                      {d.ocorrencias === 0 ? "—" : veCusto ? brl(media) : media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="waste-note">Média por dia da semana, no período{veCusto ? "" : " (em lançamentos)"}.</p>
          </>
        )}
      </section>
    </div>
  );
}
