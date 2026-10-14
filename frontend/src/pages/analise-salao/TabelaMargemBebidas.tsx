import { useRef, useState } from "react";
import type { AnaliseMargemBebidasLinha } from "../../api/client";
import { decimal1, inteiro } from "./formato";
import { useFormato } from "./useFormato";

type Props = {
  linhas: AnaliseMargemBebidasLinha[];
  podeEditar: boolean;
  onDesfazer: (codigo: string, nome: string) => Promise<void>;
};

// Margem de revenda: o que cada bebida deixa depois do custo de COMPRA do insumo vinculado.
export function TabelaMargemBebidas({ linhas, podeEditar, onDesfazer }: Props) {
  const { reais, reaisCentavos } = useFormato();
  const [erro, setErro] = useState<string | null>(null);
  // Códigos com desfazer em andamento: um clique repetido não manda outra requisição.
  const emAndamento = useRef(new Set<string>());

  async function desfazer(codigo: string, nome: string) {
    if (emAndamento.current.has(codigo)) return;
    emAndamento.current.add(codigo);
    setErro(null);
    try {
      await onDesfazer(codigo, nome);
    } catch (e: unknown) {
      setErro(`Não foi possível desfazer o vínculo de ${nome}: ${e instanceof Error ? e.message : "tente de novo."}`);
    } finally {
      emAndamento.current.delete(codigo);
    }
  }

  if (linhas.length === 0) {
    return <p className="analise-nota">Nenhuma bebida com margem calculada neste período. Vincule as bebidas aos insumos na lista abaixo.</p>;
  }

  return (
    <>
      {erro && (
        <p className="meta-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Tabela de margem das bebidas">
        <table className="mix">
          <caption className="sr-only">Margem de revenda das bebidas, da que mais deixa à que menos deixa</caption>
          <thead>
            <tr>
              <th scope="col">Bebida</th>
              <th scope="col" className="direita">Vendidas</th>
              <th scope="col" className="direita">Preço médio</th>
              <th scope="col" className="direita">Custo de compra</th>
              <th scope="col" className="direita">Margem por venda</th>
              <th scope="col" className="direita">Margem total</th>
              <th scope="col">Vínculo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const negativa = l.margemUnitaria < 0;
              return (
                <tr key={l.codigo}>
                  <th scope="row">{l.nome}</th>
                  <td className="direita">
                    {inteiro(l.quantidade)}
                    {l.quantidadeSemCobranca > 0 && <span className="venda-sub">{inteiro(l.quantidadeSemCobranca)} sem cobrança</span>}
                  </td>
                  <td className="direita">{reaisCentavos(l.precoMedio)}</td>
                  <td className="direita">{reaisCentavos(l.custoPorVenda)}</td>
                  <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>
                    <strong>{reaisCentavos(l.margemUnitaria)}</strong>
                    <span className="venda-sub">{negativa ? "abaixo do custo · " : ""}{decimal1(l.margemPct * 100)}% do preço · custo {decimal1(l.cmvPct * 100)}%</span>
                  </td>
                  <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>
                    <strong>{reais(l.margemTotal)}</strong>
                  </td>
                  <td>
                    <span className="margem-produto">
                      Consome {l.consumo}
                      {podeEditar && (
                        <button type="button" className="insight-link" onClick={() => void desfazer(l.codigo, l.nome)} aria-label={`Desfazer vínculo de ${l.nome}`}>
                          desfazer vínculo
                        </button>
                      )}
                    </span>
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
