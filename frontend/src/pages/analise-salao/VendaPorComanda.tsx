import type { AnaliseAttachBloco, AnaliseCardapio, AnaliseItemDeAtencao } from "../../api/client";
import { inteiro, percentual, textoPontos } from "./formato";
import { useFormato } from "./useFormato";

const ITENS: Array<{ chave: AnaliseItemDeAtencao; rotulo: string }> = [
  { chave: "bebida", rotulo: "Bebida" },
  { chave: "alcool", rotulo: "Álcool" },
  { chave: "cafe", rotulo: "Café" },
  { chave: "sobremesa", rotulo: "Sobremesa" }
];

// O que cada comanda leva: em que fatia das comandas o item aparece e quanto rende por pessoa, por
// turno e no total. O almoço (buffet) e o jantar (à la carte) vendem coisas diferentes: misturar os
// dois escondia o jantar.
export function VendaPorComanda({ attach }: { attach: AnaliseCardapio["attach"] }) {
  const { reais } = useFormato();
  const colunas: Array<{ chave: string; rotulo: string; bloco: AnaliseAttachBloco }> = [
    ...attach.turnos.filter((t) => t.turno !== "OUTRO").map((t) => ({ chave: t.turno, rotulo: t.rotulo, bloco: t as AnaliseAttachBloco })),
    { chave: "GERAL", rotulo: "Total", bloco: attach.geral }
  ];
  if (attach.geral.comandas === 0) return <p className="analise-nota">Nenhuma comanda com número de pessoas neste período.</p>;

  return (
    <div className="mix-rolagem" tabIndex={0} role="region" aria-label="O que cada comanda leva, por turno">
      <table className="mix venda-comanda">
        <caption className="sr-only">Comandas com bebida, álcool, café e sobremesa, por turno</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            {colunas.map((c) => (
              <th key={c.chave} scope="col" className="direita">
                {c.rotulo}
                <span className="venda-base">{inteiro(c.bloco.comandas)} comandas</span>
              </th>
            ))}
            <th scope="col" className="direita">
              Total vs. anterior
            </th>
          </tr>
        </thead>
        <tbody>
          {ITENS.map(({ chave, rotulo }) => {
            const total = attach.geral.itens[chave];
            return (
              <tr key={chave}>
                <th scope="row">{rotulo}</th>
                {colunas.map((c) => {
                  const t = c.bloco.itens[chave];
                  return (
                    <td key={c.chave} className="direita">
                      <strong>{percentual(t.pctComandas, 1)}</strong>
                      <span className="venda-sub">das comandas · {reais(t.receitaPorPessoa)} por pessoa</span>
                    </td>
                  );
                })}
                <td className="direita venda-variacao">{textoPontos(total.variacaoPontos)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
