// Confirmação no lugar do window.confirm: caixa do próprio sistema, com foco
// preso (dialog nativo), Esc para voltar e o que vai acontecer escrito às claras.
// Uso: const { confirmar, caixa } = useConfirmacao(); … if (!(await confirmar({...}))) return; … {caixa}
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../design-system";

export type PedidoConfirmacao = {
  titulo: string;
  texto?: ReactNode;
  confirmar: string;
  /** Ação que apaga, fecha ou mexe em dinheiro: botão vermelho. */
  perigo?: boolean;
};

export function useConfirmacao() {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { responder: (ok: boolean) => void }) | null>(null);
  const caixaRef = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idTexto = useId();

  useEffect(() => {
    const caixa = caixaRef.current;
    if (pedido && caixa && !caixa.open) caixa.showModal();
  }, [pedido]);

  function confirmar(p: PedidoConfirmacao): Promise<boolean> {
    return new Promise((resolve) => setPedido({ ...p, responder: resolve }));
  }

  function responder(ok: boolean) {
    pedido?.responder(ok);
    caixaRef.current?.close();
    setPedido(null);
  }

  const caixa = pedido ? (
    <dialog ref={caixaRef} className="confirmacao" role="alertdialog" aria-modal="true"
      aria-labelledby={idTitulo} aria-describedby={pedido.texto ? idTexto : undefined}
      onCancel={(e) => { e.preventDefault(); responder(false); }}>
      <h2 id={idTitulo}>{pedido.titulo}</h2>
      {pedido.texto && <div id={idTexto} className="confirmacao-texto">{pedido.texto}</div>}
      <div className="confirmacao-acoes">
        {/* Foco começa em "Voltar": Enter por engano não executa a ação. */}
        <Button variant="secondary" autoFocus onClick={() => responder(false)}>Voltar</Button>
        <Button variant={pedido.perigo ? "danger" : "primary"} onClick={() => responder(true)}>{pedido.confirmar}</Button>
      </div>
    </dialog>
  ) : null;

  return { confirmar, caixa };
}
