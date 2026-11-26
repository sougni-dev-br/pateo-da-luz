import { useState } from "react";
import type { PlanejamentoComentarioApagado } from "../../../api/client";
import { Button } from "../../../design-system";
import type { PedidoDeConfirmacao } from "../Confirmacao";
import { dataEHora } from "./formatoComentario";
import type { ComentariosApi } from "./useComentarios";

// Lixeira do ponto, só para quem administra o Planejamento: os apagados deste ponto com quem e quando apagou, e
// "Restaurar" (com confirmação simples). Começa fechada; o botão diz quantos há.

type Props = {
  apagados: readonly PlanejamentoComentarioApagado[];
  api: ComentariosApi;
  confirmar: (pedido: PedidoDeConfirmacao) => Promise<boolean>;
};

const PEDIDO_DE_RESTAURAR: PedidoDeConfirmacao = {
  titulo: "Restaurar este comentário?",
  texto: "Ele volta ao Comparativo e, se estiver marcado, à impressão.",
  acao: "Restaurar"
};

function ItemDaLixeira({ comentario, api, confirmar }: { comentario: PlanejamentoComentarioApagado } & Omit<Props, "apagados">) {
  const [erro, setErro] = useState<string | null>(null);
  async function restaurar() {
    if (!(await confirmar(PEDIDO_DE_RESTAURAR))) return;
    const resultado = await api.restaurar(comentario);
    if (!resultado.ok) setErro(resultado.mensagem);
  }
  return (
    <li className="plan-coment-item">
      <p className="plan-coment-texto">{comentario.texto}</p>
      <p className="plan-coment-meta">
        <strong>{comentario.autorNome}</strong>
        <time dateTime={comentario.criadoEm}>{dataEHora(comentario.criadoEm)}</time>
        <span>apagado por {comentario.apagadoPorNome} em <time dateTime={comentario.apagadoEm}>{dataEHora(comentario.apagadoEm)}</time></span>
      </p>
      {erro && <p className="plan-coment-erro" role="alert">{erro}</p>}
      <div className="plan-coment-acoes">
        <Button type="button" variant="secondary" onClick={() => void restaurar()}>Restaurar</Button>
      </div>
    </li>
  );
}

export function LixeiraDoPonto({ apagados, api, confirmar }: Props) {
  const [aberta, setAberta] = useState(false);
  if (apagados.length === 0 && !aberta) return null;
  return (
    <section className="plan-coment-lixeira" aria-label="Lixeira deste ponto">
      <Button type="button" variant="secondary" className="plan-coment-lixeira-botao" aria-expanded={aberta} aria-controls="plan-coment-lixeira-lista" onClick={() => setAberta((a) => !a)}>
        Lixeira ({apagados.length})
      </Button>
      {aberta && (
        <ul className="plan-coment-lista" id="plan-coment-lixeira-lista">
          {apagados.length === 0 && <li className="plan-coment-vazio">A lixeira deste ponto está vazia.</li>}
          {apagados.map((c) => <ItemDaLixeira key={c.id} comentario={c} api={api} confirmar={confirmar} />)}
        </ul>
      )}
    </section>
  );
}
