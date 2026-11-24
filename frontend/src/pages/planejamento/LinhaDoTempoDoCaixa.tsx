import type { PlanejamentoCaixa } from "../../api/client";
import { NOMES_DOS_MESES_CURTOS } from "./formato";
import { compacto, emMil, Reais } from "./Reais";
import { useLargura } from "./useLargura";
import { useOculto } from "./useOculto";

// Saldo de caixa no fim de cada mês, como uma régua: acima da linha do zero é caixa sobrando, abaixo é dinheiro que
// falta. Cada barra traz o valor; o pior mês é rotulado ("mín. −78 mil") e pintado mais forte, porque é ele que
// define o capital de giro. Mês sem base aparece escrito, nunca como um zero mudo.

type Props = { caixa: PlanejamentoCaixa };
type Coluna = { mes: number; saldo: number | null };

const ALTURA = 188;
const TOPO = 26;
const BASE_DO_GRAFICO = ALTURA - 44;
const ESTREITO = 560;

export function LinhaDoTempoDoCaixa({ caixa }: Props) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const hidden = useOculto();
  const colunas: Coluna[] = caixa.meses.map((m, i) => ({ mes: i + 1, saldo: m?.saldo ?? null }));
  const valores = colunas.map((c) => c.saldo).filter((v): v is number => v !== null);
  const pior = caixa.total.menorSaldo;

  if (valores.length === 0) {
    return <p className="plan-linha-tempo-vazia">O caixa ainda não foi calculado em nenhum mês: confira o mix das formas de pagamento e o CMV.</p>;
  }

  const estreito = largura < ESTREITO;
  const margem = estreito ? 20 : 44;
  const fatia = (largura - margem) / 12;
  const maximo = Math.max(0, ...valores);
  const minimo = Math.min(0, ...valores);
  const faixa = maximo - minimo || 1;
  const y = (v: number) => TOPO + ((maximo - v) / faixa) * (BASE_DO_GRAFICO - TOPO);
  const zero = y(0);
  const larguraDaBarra = Math.max(6, Math.min(44, fatia * 0.56));
  const fonte = estreito ? 9.5 : 11;

  return (
    <figure className="plan-linha-tempo">
      <figcaption className="plan-linha-tempo-titulo">
        <span>Saldo de caixa no fim de cada mês</span>
        <span className="plan-linha-tempo-legenda"><span className="plan-chave plan-chave-sobra" aria-hidden />sobra <span className="plan-chave plan-chave-falta" aria-hidden />falta</span>
      </figcaption>
      <div ref={ref} className="plan-grafico">
        <svg width={largura} height={ALTURA} role="presentation" aria-hidden focusable="false" className="plan-grafico-svg">
          <line x1={margem} x2={largura} y1={zero} y2={zero} className="plan-grafico-zero" />
          <text x={margem - 6} y={zero + 4} textAnchor="end" className="plan-grafico-eixo" fontSize={fonte}>{estreito ? "0" : "R$ 0"}</text>
          {colunas.map(({ mes, saldo }, i) => {
            const centro = margem + fatia * i + fatia / 2;
            const nome = NOMES_DOS_MESES_CURTOS[mes - 1];
            const ehPior = pior !== null && pior.mes === mes && pior.valor < 0;
            const rotuloDoMes = <text x={centro} y={ALTURA - 6} textAnchor="middle" className={`plan-grafico-mes${ehPior ? " plan-grafico-mes-forte" : ""}`} fontSize={fonte}>{nome}</text>;
            if (saldo === null) {
              return (
                <g key={mes}>
                  <text x={centro} y={zero - 6} textAnchor="middle" className="plan-grafico-sem-base" fontSize={fonte - 1}>{estreito ? "—" : "sem base"}</text>
                  {rotuloDoMes}
                </g>
              );
            }
            const topo = Math.min(y(saldo), zero);
            const altura = Math.max(2, Math.abs(y(saldo) - zero));
            const negativo = saldo < 0;
            const classe = ehPior ? "plan-barra-pior" : negativo ? "plan-barra-falta" : "plan-barra-sobra";
            // No celular não cabe um rótulo por mês: ficam o maior saldo e o pior (os outros estão no toque e na legenda).
            const visivel = !estreito || ehPior || saldo === maximo;
            const rotulo = hidden || !visivel ? "" : ehPior && !estreito ? `mín. ${emMil(saldo)}` : compacto(saldo, true);
            const yRotulo = negativo ? topo + altura + fonte + 3 : topo - 5;
            return (
              <g key={mes} className="plan-grafico-coluna">
                <rect x={centro - larguraDaBarra / 2} y={topo} width={larguraDaBarra} height={altura} rx={2} className={`plan-grafico-barra ${classe}${negativo ? " plan-barra-desce" : ""}`}>
                  <title>{`${nome}: ${hidden ? "valor oculto" : emMil(saldo)}`}</title>
                </rect>
                {rotulo && <text x={centro} y={yRotulo} textAnchor="middle" className={`plan-grafico-valor${ehPior ? " plan-grafico-valor-pior" : negativo ? " plan-grafico-valor-falta" : ""}`} fontSize={fonte}>{rotulo}</text>}
                {rotuloDoMes}
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="plan-sr">
        {colunas.map(({ mes, saldo }) => (
          <li key={mes}>
            {NOMES_DOS_MESES_CURTOS[mes - 1]}: {saldo === null ? "sem base, não calculado" : <Reais valor={saldo} />}
            {pior !== null && pior.mes === mes ? ", menor saldo do ano" : ""}
          </li>
        ))}
      </ol>
    </figure>
  );
}
