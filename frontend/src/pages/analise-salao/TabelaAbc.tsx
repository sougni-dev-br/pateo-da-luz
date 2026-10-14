import type { AnaliseProdutoAbc } from "../../api/client";
import { decimal1, percentual } from "./formato";
import { useFormato } from "./useFormato";

// Produtos em ordem de receita, com a classe da curva ABC. "Quantidade" pode ser fracionária (peso).
export function TabelaAbc({ itens, legenda }: { itens: AnaliseProdutoAbc[]; legenda: string }) {
  const { reais } = useFormato();
  return (
    <div className="mix-rolagem" tabIndex={0} role="region" aria-label={legenda}>
      <table className="mix tabela-abc">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Produto</th>
            <th scope="col">Grupo</th>
            <th scope="col" className="direita">
              Quantidade
            </th>
            <th scope="col" className="direita">
              Receita
            </th>
            <th scope="col" className="direita">
              % da receita
            </th>
            <th scope="col" className="direita">
              Acumulado
            </th>
            <th scope="col">Classe</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.produto}>
              <td>{i.posicao}</td>
              <th scope="row">{i.produto}</th>
              <td>{i.grupo}</td>
              <td className="direita">{decimal1(i.quantidade)}</td>
              <td className="direita">{reais(i.valor)}</td>
              <td className="direita">{percentual(i.participacao, 1)}</td>
              <td className="direita">{percentual(i.acumulada, 0)}</td>
              <td>
                <span className={`classe-abc classe-abc-${i.classe}`}>{i.classe}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
