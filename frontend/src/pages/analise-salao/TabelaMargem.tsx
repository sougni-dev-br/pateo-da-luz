import { useState } from "react";
import type { AnaliseMargemLinha } from "../../api/client";
import { decimal1, inteiro } from "./formato";
import { useFormato } from "./useFormato";

type Props = {
  linhas: AnaliseMargemLinha[];
  podeEditar: boolean;
  onDesfazer: (codigo: string, nome: string) => Promise<void>;
};

// Margem por prato: o que cada prato deixa DEPOIS dos ingredientes, ordenado pelo que mais deixa no
// total. Margem e custo são só de ingredientes (a ficha não leva mão de obra, perda de salão nem ocupação).
export function TabelaMargem({ linhas, podeEditar, onDesfazer }: Props) {
  const { reais, reaisCentavos } = useFormato();
  const [erro, setErro] = useState<string | null>(null);

  async function desfazer(codigo: string, nome: string) {
    setErro(null);
    try {
      await onDesfazer(codigo, nome);
    } catch (e: unknown) {
      setErro(`Não foi possível desfazer o vínculo de ${nome}: ${e instanceof Error ? e.message : "tente de novo."}`);
    }
  }

  if (linhas.length === 0) {
    return <p className="analise-nota">Nenhum prato com margem calculada neste período. Vincule os produtos do PDV às fichas na lista abaixo.</p>;
  }

  return (
    <>
      {erro && (
        <p className="meta-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Tabela de margem por prato">
        <table className="mix">
          <caption className="sr-only">Margem por prato do salão, do que mais deixa ao que menos deixa</caption>
          <thead>
            <tr>
              <th scope="col">Prato</th>
              <th scope="col" className="direita">Vendidos</th>
              <th scope="col" className="direita">Preço médio</th>
              <th scope="col" className="direita">Custo da porção</th>
              <th scope="col" className="direita">Margem por prato</th>
              <th scope="col" className="direita">Margem total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const negativa = l.margemUnitaria < 0;
              return (
                <tr key={l.pratoId}>
                  <th scope="row">
                    {l.prato}
                    <span className="venda-sub">
                      {l.produtosPdv.map((p) => (
                        <span key={p.codigo} className="margem-produto">
                          PDV: {p.nome}
                          {podeEditar && (
                            <button type="button" className="insight-link" onClick={() => void desfazer(p.codigo, p.nome)} aria-label={`Desfazer vínculo de ${p.nome}`}>
                              desfazer vínculo
                            </button>
                          )}
                        </span>
                      ))}
                    </span>
                  </th>
                  <td className="direita">
                    {inteiro(l.quantidade)}
                    {l.quantidadeSemCobranca > 0 && <span className="venda-sub">{inteiro(l.quantidadeSemCobranca)} sem cobrança</span>}
                  </td>
                  <td className="direita">{reaisCentavos(l.precoMedio)}</td>
                  <td className="direita">{reaisCentavos(l.custoPorcao)}</td>
                  <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>
                    <strong>{reaisCentavos(l.margemUnitaria)}</strong>
                    <span className="venda-sub">{negativa ? "abaixo do custo · " : ""}{decimal1(l.margemPct * 100)}% do preço · custo {decimal1(l.cmvPct * 100)}%</span>
                  </td>
                  <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>
                    <strong>{reais(l.margemTotal)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
