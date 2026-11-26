import { useEffect, useRef, useState } from "react";
import type { PlanejamentoComentario } from "../../../api/client";
import { Button } from "../../../design-system";
import type { PedidoDeConfirmacao } from "../Confirmacao";
import { dataEHora } from "./formatoComentario";
import { FormularioDeComentario } from "./FormularioDeComentario";
import type { ComentariosApi } from "./useComentarios";

type Props = {
  comentario: PlanejamentoComentario;
  api: ComentariosApi;
  confirmar: (pedido: PedidoDeConfirmacao) => Promise<boolean>;
};

const PEDIDO_DE_APAGAR: PedidoDeConfirmacao = {
  titulo: "Apagar este comentário?",
  texto: "O comentário some do Comparativo e da impressão. Isso não pode ser desfeito.",
  acao: "Apagar",
  perigo: true
};

export function ComentarioItem({ comentario, api, confirmar }: Props) {
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
        </div>
      )}
    </li>
  );
}
