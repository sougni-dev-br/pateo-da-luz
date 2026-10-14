import type { AnaliseCardapio } from "../../api/client";
import { inteiro, percentual } from "./formato";
import { useFormato } from "./useFormato";

// "E se mais comandas levassem o item?": o valor de cada ponto percentual a mais, ao preço médio
// que o item já tem. É uma conta de hipótese, não uma meta nem uma previsão: a tela diz isso.
export function SimulacoesDoCardapio({ simulacoes }: { simulacoes: AnaliseCardapio["simulacoes"] }) {
  const { reaisCompacto, reais } = useFormato();
  const comValor = simulacoes.filter((s) => s.valorMes !== null);
  if (comValor.length === 0) return <p className="analise-nota">Poucas comandas no período para simular.</p>;
  const { ponto, comandasPorMes } = comValor[0];

  return (
    <div className="simulacoes">
      <p className="analise-nota">
        Cada <strong>{Math.round(ponto * 100)} ponto percentual a mais</strong> das comandas ({inteiro(comandasPorMes)} por mês neste ritmo) levando o item,
        ao preço médio que ele já tem. <strong>Hipótese, não previsão</strong>: mede receita, não margem, e subir um ponto é mais difícil onde a taxa já é alta.
      </p>
      <ul className="simulacao-lista">
        {comValor.map((s) => (
          <li key={s.item} className="simulacao">
            <span className="simulacao-item">{s.rotulo}</span>
            <strong className="simulacao-valor">{reaisCompacto(s.valorMes as number)}</strong>
            <span className="simulacao-sub">por mês, a cada +1 ponto · preço médio {reais(s.precoMedio)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
