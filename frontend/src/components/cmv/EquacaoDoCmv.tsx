// O CMV como a conta que ele é.
//
// O detalhe da apuração mostrava onze cartões do mesmo tamanho: código, período,
// status, CMV %, margem, estoque inicial, compras, estoque final, CMV real e
// faturamento. Tudo com o mesmo peso, num grid que deixava buraco.
//
// Mas quatro desses números não são independentes — são os termos de uma conta:
//
//     inicial + compras − final = CMV
//
// Mostrá-los como cartões soltos esconde justamente o que explica o resultado.
// Quando o CMV sai estranho, a pergunta seguinte é sempre "qual das três pernas
// está errada?", e a conta responde sozinha.

import { Money } from "../../design-system";
import "./EquacaoDoCmv.css";

type Props = {
  estoqueInicial: number;
  compras: number;
  estoqueFinal: number;
  cmvReal: number;
  faturamento: number;
  cmvPercentual: number | null;
  margemBruta: number | null;
};

function classificar(percentual: number | null): { rotulo: string; tom: string } {
  if (percentual == null) return { rotulo: "sem cálculo", tom: "neutro" };
  if (percentual <= 0.3) return { rotulo: "dentro do esperado", tom: "bom" };
  if (percentual <= 0.35) return { rotulo: "acima do esperado", tom: "atencao" };
  return { rotulo: "muito acima do esperado", tom: "critico" };
}

function percentualTexto(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function Termo({ rotulo, valor, sinal }: { rotulo: string; valor: number; sinal?: string }) {
  return (
    <>
      {sinal && <span className="eq-sinal" aria-hidden="true">{sinal}</span>}
      <span className="eq-termo">
        <strong><Money value={valor} /></strong>
        <small>{rotulo}</small>
      </span>
    </>
  );
}

export function EquacaoDoCmv({
  estoqueInicial, compras, estoqueFinal, cmvReal, faturamento, cmvPercentual, margemBruta
}: Props) {
  const saude = classificar(cmvPercentual);

  return (
    <div className="eq-bloco">
      <div className={`eq-resultado eq-${saude.tom}`}>
        <div className="eq-resultado-valor">
          <strong><Money value={cmvReal} /></strong>
          <span>CMV real do ciclo</span>
        </div>
        <div className="eq-resultado-percentual">
          <strong>{percentualTexto(cmvPercentual)}</strong>
          <span>da receita · {saude.rotulo}</span>
        </div>
      </div>

      {/* A conta na ordem em que se lê, não em ordem alfabética de cartão. */}
      <div className="eq-conta" role="group" aria-label="Composição do CMV">
        <Termo rotulo="estoque inicial" valor={estoqueInicial} />
        <Termo rotulo="compras no ciclo" valor={compras} sinal="+" />
        <Termo rotulo="estoque final" valor={estoqueFinal} sinal="−" />
        <span className="eq-sinal eq-igual" aria-hidden="true">=</span>
        <span className="eq-termo eq-termo-resultado">
          <strong><Money value={cmvReal} /></strong>
          <small>CMV real</small>
        </span>
      </div>

      <div className="eq-rodape">
        <span>Faturamento do ciclo <strong><Money value={faturamento} /></strong></span>
        <span>Margem bruta <strong><Money value={margemBruta} /></strong></span>
      </div>
    </div>
  );
}
