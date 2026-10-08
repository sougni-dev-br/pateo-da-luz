import { AlertTriangle, Trash2 } from "lucide-react";
import { Money, Select } from "../../../design-system";
import {
  custoPrevisto,
  motivoSemCusto,
  normalizarUnidade,
  unidadesPossiveis,
  type ErroDoItem,
  type ItemDaFicha
} from "../../../lib/fichaTecnica";

type Props = {
  item: ItemDaFicha;
  erro?: ErroDoItem;
  repetido: boolean;
  onAlterar: (tempId: string, campo: "quantity" | "unit" | "wasteFactor", valor: string) => void;
  onRemover: (tempId: string) => void;
};

/** Impede que a rodinha do mouse mude o número quando o campo está em foco. */
const soltarNaRodinha = (evento: { currentTarget: HTMLInputElement }) => evento.currentTarget.blur();

export function LinhaDeIngrediente({ item, erro, repetido, onAlterar, onRemover }: Props) {
  const custo = custoPrevisto(item);
  const motivo = motivoSemCusto(item);
  const unidadeAtual = normalizarUnidade(item.unit);
  const idDaNota = `ft-nota-${item.tempId}`;
  const temNota = Boolean(erro || motivo || repetido);

  const opcoes = unidadesPossiveis(item.productUnit, item.conversions).map((unidade) => ({ value: unidade, label: unidade }));
  // Unidade já gravada que não converte continua visível, marcada — sumir com ela mudaria a ficha em silêncio.
  if (unidadeAtual && !opcoes.some((opcao) => opcao.value === unidadeAtual)) {
    opcoes.push({ value: unidadeAtual, label: `${unidadeAtual} (sem conversão)` });
  }

  return (
    <li className={`ft-ingrediente${erro ? " ft-ingrediente--erro" : motivo ? " ft-ingrediente--alerta" : ""}`}>
      <div className="ft-ingrediente-linha">
        <div className="ft-ingrediente-produto">
          <strong>{item.productName}</strong>
          <small>
            {item.unitCost > 0
              ? <>Estoque: <Money value={item.unitCost} />{item.productUnit ? ` / ${item.productUnit}` : ""}</>
              : "Sem custo no estoque"}
          </small>
        </div>

        <label className="ft-campo ft-campo--qtd">
          <span className="ft-campo-rotulo">Quantidade</span>
          <input
            id={`ft-qtd-${item.tempId}`}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={item.quantity}
            aria-label={`Quantidade de ${item.productName}`}
            aria-invalid={erro?.campo === "quantity" ? true : undefined}
            aria-describedby={temNota ? idDaNota : undefined}
            onChange={(evento) => onAlterar(item.tempId, "quantity", evento.target.value)}
            onWheel={soltarNaRodinha}
          />
        </label>

        <div className="ft-campo ft-campo--un">
          <span className="ft-campo-rotulo">Unidade</span>
          <Select
            value={unidadeAtual}
            options={opcoes}
            aria-label={`Unidade de ${item.productName}`}
            onChange={(evento) => onAlterar(item.tempId, "unit", evento.target.value)}
          />
        </div>

        <label className="ft-campo ft-campo--perda">
          <span className="ft-campo-rotulo">Perda %</span>
          <input
            id={`ft-perda-${item.tempId}`}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            max="100"
            value={item.wasteFactor}
            aria-label={`Perda de ${item.productName} em percentual`}
            aria-invalid={erro?.campo === "wasteFactor" ? true : undefined}
            aria-describedby={temNota ? idDaNota : undefined}
            onChange={(evento) => onAlterar(item.tempId, "wasteFactor", evento.target.value)}
            onWheel={soltarNaRodinha}
          />
        </label>

        <div className="ft-ingrediente-custo" aria-label={`Custo de ${item.productName}`}>
          <span className="ft-campo-rotulo">Custo</span>
          {custo != null ? <Money value={custo} /> : <span className="ft-sem-valor" title={motivo ?? undefined}>sem custo</span>}
        </div>

        <button
          type="button"
          className="ft-remover"
          onClick={() => onRemover(item.tempId)}
          aria-label={`Remover ${item.productName} da ficha`}
          title="Remover da ficha"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </div>

      {temNota && (
        <p id={idDaNota} className={`ft-ingrediente-nota${erro ? " ft-ingrediente-nota--erro" : ""}`} role={erro ? "alert" : undefined}>
          <AlertTriangle size={13} aria-hidden />
          {erro?.mensagem ?? motivo ?? "Este produto aparece mais de uma vez na ficha."}
        </p>
      )}
    </li>
  );
}
