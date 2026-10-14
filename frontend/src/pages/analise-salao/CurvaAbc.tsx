import type { AnaliseCardapio } from "../../api/client";
import { inteiro, percentual } from "./formato";
import { useFormato } from "./useFormato";

const LARGURA = 600;
const ALTURA = 180;

// Pareto: barras = receita de cada produto (do maior para o menor); linha = receita acumulada. As
// linhas tracejadas marcam os limites das classes A (80%) e B (95%). É um desenho de apoio: os
// números estão na tabela logo abaixo e no resumo por classe.
export function CurvaAbc({ abc, totalProdutos }: { abc: AnaliseCardapio["abc"]; totalProdutos: number }) {
  const { reais } = useFormato();
  const itens = abc.itens;
  if (itens.length === 0) return null;
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  const passo = LARGURA / itens.length;
  const x = (i: number) => i * passo + passo / 2;
  const y = (razao: number) => ALTURA - razao * ALTURA;
  const linha = itens.map((i, k) => `${k === 0 ? "M" : "L"}${x(k).toFixed(1)},${y(i.acumulada).toFixed(1)}`).join(" ");

  return (
    <div className="abc">
      <ul className="abc-classes">
        {abc.classes.map((c) => (
          <li key={c.classe} className={`abc-classe abc-classe-${c.classe}`}>
            <span className="abc-letra">{c.classe}</span>
            <span>
              <strong>{inteiro(c.produtos)} produtos</strong> fazem {percentual(c.participacao)} da receita
              <span className="abc-valor"> ({reais(c.valor)})</span>
            </span>
          </li>
        ))}
      </ul>
      <svg
        className="abc-grafico"
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Curva ABC dos ${itens.length} produtos que mais vendem, de um total de ${totalProdutos}`}
      >
        {itens.map((i, k) => (
          <rect key={i.produto} className={`abc-barra abc-barra-${i.classe}`} x={k * passo + passo * 0.15} width={passo * 0.7} y={ALTURA - (i.valor / maximo) * ALTURA * 0.55} height={(i.valor / maximo) * ALTURA * 0.55}>
            <title>{`${i.posicao}. ${i.produto}: ${reais(i.valor)} (${percentual(i.participacao, 1)})`}</title>
          </rect>
        ))}
        <line className="abc-limite" x1="0" x2={LARGURA} y1={y(abc.limiteA)} y2={y(abc.limiteA)} />
        <line className="abc-limite" x1="0" x2={LARGURA} y1={y(abc.limiteB)} y2={y(abc.limiteB)} />
        <path className="abc-acumulada" d={linha} fill="none" />
      </svg>
      <p className="abc-legenda" aria-hidden>
        <span>
          <i className="abc-linha-amostra" /> receita acumulada
        </span>
        <span>
          <i className="abc-limite-amostra" /> {percentual(abc.limiteA, 0)} e {percentual(abc.limiteB, 0)}
        </span>
        <span>{inteiro(itens.length)} produtos que mais vendem, de {inteiro(totalProdutos)}</span>
      </p>
    </div>
  );
}
