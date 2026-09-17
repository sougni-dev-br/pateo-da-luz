// A diferença entre as duas visões do CMV, e de onde ela vem.
//
// A tela mostrava a conta inteira duas vezes lado a lado e, logo abaixo, duas
// tabelas de compras por categoria — uma por visão. Mas a visão contábil é
// exatamente a que já está no topo da página, e as duas tabelas diferem em
// pouquíssimas linhas. O leitor tinha de comparar dezenas de números para
// chegar a uma frase.
//
// Aqui a pergunta é respondida direto: quanto a gerencial difere, quantos
// pontos de receita isso representa, e quais categorias explicam a diferença.

import { Money } from "../../design-system";
import type { ComparacaoDeVisoes as Comparacao } from "../../lib/visoes-do-cmv";
import "./ComparacaoDeVisoes.css";

type Props = {
  rotulo: string;
  cmvGerencial: number;
  percentualGerencial: number | null;
  comparacao: Comparacao;
};

function pontos(v: number): string {
  const abs = Math.abs(v * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return `${v >= 0 ? "+" : "−"}${abs} p.p.`;
}

function percentual(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

export function ComparacaoDeVisoes({ rotulo, cmvGerencial, percentualGerencial, comparacao }: Props) {
  if (comparacao.iguais) {
    return (
      <p className="cmv-visoes-iguais">
        A <strong>{rotulo.toLowerCase()}</strong> dá o mesmo resultado da visão do topo — nenhuma
        categoria entra numa e fica de fora da outra neste período.
      </p>
    );
  }

  const maior = comparacao.diferenca > 0;

  return (
    <div className="cmv-comparacao">
      <div className="cmv-comparacao-cabeca">
        <div className="cmv-comparacao-total">
          <strong><Money value={cmvGerencial} /></strong>
          <span>CMV do ciclo · {percentual(percentualGerencial)} da receita</span>
        </div>
        <div className={`cmv-comparacao-delta ${maior ? "maior" : "menor"}`}>
          <strong>
            {maior ? "+" : "−"}
            <Money value={Math.abs(comparacao.diferenca)} />
          </strong>
          <span>
            {comparacao.diferencaEmPontos == null
              ? "em relação à visão do topo"
              : `${pontos(comparacao.diferencaEmPontos)} · em relação à visão do topo`}
          </span>
        </div>
      </div>

      <ul className="cmv-comparacao-origem">
        {comparacao.categorias.map((c) => (
          <li key={c.categoryName}>
            <span className="cmv-origem-nome">{c.categoryName}</span>
            <span className="cmv-origem-itens">{c.itemsCount} {c.itemsCount === 1 ? "item" : "itens"}</span>
            <span className="cmv-origem-valor">
              {c.diferenca > 0 ? "+" : "−"}
              <Money value={Math.abs(c.diferenca)} />
            </span>
          </li>
        ))}
        {Math.abs(comparacao.naoExplicado) > 0.01 && (
          <li className="cmv-origem-resto">
            <span className="cmv-origem-nome">Fora das compras (estoque ou receita)</span>
            <span className="cmv-origem-itens" />
            <span className="cmv-origem-valor">
              {comparacao.naoExplicado > 0 ? "+" : "−"}
              <Money value={Math.abs(comparacao.naoExplicado)} />
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
