import type { AnaliseMixLinha } from "../../api/client";
import { inteiro, percentual, textoPontos } from "./formato";
import { useFormato } from "./useFormato";

// Participação de cada categoria na receita dos itens, com a variação em pontos percentuais contra o
// período anterior. Mudar de lugar não é bom nem ruim por si: a variação aparece neutra.
export function MixDeCategorias({ linhas, comparar }: { linhas: AnaliseMixLinha[]; comparar: boolean }) {
  const { reais } = useFormato();
  if (linhas.length === 0) return <p className="analise-nota">Nenhum item vendido neste período.</p>;
  const maior = Math.max(0.0001, ...linhas.map((l) => l.participacao));

  return (
    <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Receita por categoria">
      <table className="mix">
        <caption className="sr-only">Receita por categoria</caption>
        <thead>
          <tr>
            <th scope="col">Categoria</th>
            <th scope="col">Participação na receita</th>
            <th scope="col" className="direita">
              Receita
            </th>
            <th scope="col" className="direita">
              Produtos
            </th>
            <th scope="col" className="direita">
              Preço médio
            </th>
            {comparar && (
              <th scope="col" className="direita">
                vs. anterior
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nome}>
              <th scope="row">{l.nome}</th>
              <td>
                <span className="mix-barra">
                  <span className="mix-trilho" aria-hidden>
                    <span className="mix-preenchimento" style={{ width: `${(l.participacao / maior) * 100}%` }} />
                  </span>
                  <strong>{percentual(l.participacao)}</strong>
                </span>
              </td>
              <td className="direita">{reais(l.valor)}</td>
              <td className="direita">{inteiro(l.produtos)}</td>
              <td className="direita">{reais(l.precoMedio)}</td>
              {comparar && <td className="direita mix-variacao">{textoPontos(l.variacaoPontos)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
