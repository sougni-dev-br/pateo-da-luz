import { useId } from "react";
import {
  conversaoComUnidadeInvalida,
  descreverConversao,
  fatorLegivel,
  diagnosticarRascunho,
  exemploAoVivo,
  mensagemDoProblema,
  montarConversao,
  type ConversaoDoForm
} from "./embalagens";

type Props = {
  /** Unidades cadastradas: as mesmas que alimentam "Unidade de compra". */
  unidades: Array<{ id: string; code: string; name: string }>;
  /** Unidade em que o estoque é contado (estoque ou, na falta, a padrão). */
  unidadeDeContagem: string;
  conversoes: ConversaoDoForm[];
  origem: string;
  fator: string;
  onOrigem: (valor: string) => void;
  onFator: (valor: string) => void;
  onAdicionar: (conversao: ConversaoDoForm) => void;
  onRemover: (indice: number) => void;
};

export function EmbalagensDeCompra(props: Props) {
  const { unidades, unidadeDeContagem, conversoes, origem, fator, onOrigem, onFator, onAdicionar, onRemover } = props;
  const idOrigem = useId();
  const idFator = useId();
  const tocou = origem !== "" || fator.trim() !== "";
  const problema = diagnosticarRascunho({ origem, fator, contagem: unidadeDeContagem, existentes: conversoes });
  const exemplo = exemploAoVivo(origem, fator, unidadeDeContagem);
  // Só reclama do que a pessoa já começou a preencher; a tela limpa não grita.
  // Fator ainda vazio é só "falta digitar", não erro.
  const faltaSoOFator = problema === "fator-invalido" && fator.trim() === "";
  const mostrarAviso = problema === "sem-contagem" || (tocou && problema !== null && problema !== "sem-origem" && !faltaSoOFator);
  const aviso = mostrarAviso ? mensagemDoProblema(problema, origem, unidadeDeContagem) : "";
  const podeAdicionar = problema === null;
  const invalidas = conversoes.filter(conversaoComUnidadeInvalida);

  return (
    <div className="subsection compact-note embalagens-compra">
      <h3>Embalagens de compra</h3>
      <p className="field-hint">
        Use quando o fornecedor vende em caixa, pacote ou fardo, mas o estoque é contado em outra unidade.
      </p>

      <div className="embalagens-frase">
        <label htmlFor={idOrigem}>Quando a nota vier em</label>
        <select id={idOrigem} value={origem} onChange={(event) => onOrigem(event.target.value)}>
          <option value="">escolha a embalagem</option>
          {unidades.map((u) => <option key={u.id} value={u.code}>{u.code} - {u.name}</option>)}
        </select>
        <label htmlFor={idFator}>entram</label>
        <input
          id={idFator}
          inputMode="decimal"
          value={fator}
          onChange={(event) => onFator(event.target.value)}
        />
        <strong className="embalagens-destino">{unidadeDeContagem || "—"}</strong>
        <span>no estoque.</span>
      </div>

      {exemplo && !aviso && <p className="field-hint embalagens-exemplo" role="status">{exemplo}</p>}
      {aviso && <p className="embalagens-aviso" role="alert">{aviso}</p>}

      <button
        className="secondary-button"
        type="button"
        disabled={!podeAdicionar}
        onClick={() => {
          if (!podeAdicionar) return;
          onAdicionar(montarConversao(origem, fator, unidadeDeContagem));
        }}
      >
        Adicionar embalagem
      </button>

      {invalidas.length > 0 && (
        <p className="embalagens-aviso" role="alert">
          Há {invalidas.length === 1 ? "uma conversão" : `${invalidas.length} conversões`} com unidade inválida (em destaque abaixo).
          Remova e cadastre de novo escolhendo a embalagem na lista; o sistema não vai aceitar salvar com ela.
        </p>
      )}

      {conversoes.length > 0 && (
        <ul className="embalagens-lista" aria-label="Embalagens cadastradas">
          {conversoes.map((conversao, indice) => {
            const invalida = conversaoComUnidadeInvalida(conversao);
            return (
              <li
                key={`${conversao.fromUnit}-${conversao.toUnit}-${indice}`}
                className={invalida ? "embalagem-invalida" : undefined}
              >
                {invalida
                  ? <span>Unidade inválida: “{conversao.fromUnit}” → “{conversao.toUnit}” (fator {fatorLegivel(conversao.factor)}). Remova e cadastre de novo.</span>
                  : <strong>{descreverConversao(conversao)}</strong>}
                <button type="button" onClick={() => onRemover(indice)}>remover</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
