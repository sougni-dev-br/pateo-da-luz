import { useEffect, useRef, useState } from "react";
import type { PlanejamentoComentario, PlanejamentoComparativo } from "../../../api/client";
import { Button } from "../../../design-system";
import type { PedidoDeConfirmacao } from "../Confirmacao";
import { useOculto } from "../useOculto";
import { avisoDeMudanca, textoDaEpoca } from "./epoca";
import { dataEHora } from "./formatoComentario";
import { FormularioDeComentario } from "./FormularioDeComentario";
import type { ComentariosApi } from "./useComentarios";

type Props = {
  comentario: PlanejamentoComentario;
  /** Comparativo da tela, para dizer se o número do ponto mudou desde que o comentário foi escrito. */
  dados: PlanejamentoComparativo;
  api: ComentariosApi;
  confirmar: (pedido: PedidoDeConfirmacao) => Promise<boolean>;
};

const PEDIDO_DE_APAGAR: PedidoDeConfirmacao = {
  titulo: "Apagar este comentário?",
  texto: "O comentário sai do Comparativo e da impressão. Logo depois de apagar, dá para desfazer.",
  acao: "Apagar",
  perigo: true
};

export const MOTIVO_SEM_APAGAR = "Apagar só nas primeiras 24 horas. Depois disso, peça a quem administra o Planejamento.";

/** "escrito quando estava −36,7% (…)" e, se o número de hoje se afastou, o aviso. Discreto, abaixo do texto. */
function EpocaDoComentario({ comentario, dados }: { comentario: PlanejamentoComentario; dados: PlanejamentoComparativo }) {
  const epoca = textoDaEpoca(comentario, useOculto());
  if (!epoca) return null;
  const mudanca = avisoDeMudanca(comentario, dados);
  return (
    <p className="plan-coment-epoca">
      {epoca}
      {mudanca && <span className="plan-coment-mudou"> · {mudanca}</span>}
    </p>
  );
}

export function ComentarioItem({ comentario, dados, api, confirmar }: Props) {
  const [editando, setEditando] = useState(false);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const acoes = useRef<HTMLDivElement>(null);
  const eraEdicao = useRef(false);

  useEffect(() => {
    if (eraEdicao.current && !editando) acoes.current?.querySelector("button")?.focus();
    eraEdicao.current = editando;
  }, [editando]);

  async function apagar() {
    if (!(await confirmar(PEDIDO_DE_APAGAR))) return;
    const resultado = await api.apagar(comentario);
    if (!resultado.ok) setErroAoApagar(resultado.mensagem);
  }

  if (editando) {
    return (
      <li className="plan-coment-item">
        <FormularioDeComentario
          textoInicial={comentario.texto}
          naImpressaoInicial={comentario.naImpressao}
          rotuloSalvar="Salvar alteração"
          aoSalvar={(texto, naImpressao) => api.editar(comentario, { texto, naImpressao })}
          aoCancelar={() => setEditando(false)}
          aoSalvarComSucesso={() => setEditando(false)}
        />
      </li>
    );
  }
  const quando = dataEHora(comentario.criadoEm);
  return (
    <li className="plan-coment-item" data-fora-da-impressao={!comentario.naImpressao}>
      <p className="plan-coment-texto">{comentario.texto}</p>
      <EpocaDoComentario comentario={comentario} dados={dados} />
      <p className="plan-coment-meta">
        <strong>{comentario.autorNome}</strong>
        <time dateTime={comentario.criadoEm}>{quando}</time>
        {comentario.editadoEm && <span>editado</span>}
        <span className="plan-coment-etiqueta">{comentario.naImpressao ? "Sai na impressão" : "Não sai na impressão"}</span>
        {comentario.anoBase > 0 && <span>escrito numa comparação com {comentario.anoBase}</span>}
      </p>
      {erroAoApagar && <p className="plan-coment-erro" role="alert">{erroAoApagar}</p>}
      {(comentario.podeEditar || comentario.podeApagar) && (
        <div className="plan-coment-acoes" ref={acoes}>
          {comentario.podeEditar && <Button type="button" variant="secondary" onClick={() => setEditando(true)}>Editar</Button>}
          {comentario.podeApagar && <Button type="button" variant="secondary" onClick={() => void apagar()}>Apagar</Button>}
          {comentario.podeEditar && !comentario.podeApagar && <span className="plan-coment-prazo">{MOTIVO_SEM_APAGAR}</span>}
        </div>
      )}
    </li>
  );
}
