import { useCallback, useRef, useState, type ReactNode } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../design-system";
import { useDialogoAcessivel } from "./useDialogoAcessivel";

// Confirmação no visual do sistema, no lugar do window.confirm: título que diz a consequência, um texto curto e o
// botão de ação com o verbo ("Descartar", "Excluir"). Esc, X ou Cancelar respondem "não"; o foco volta a quem abriu.

export type PedidoDeConfirmacao = { titulo: string; texto: ReactNode; acao: string; perigo?: boolean };

export function useConfirmacao() {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const resposta = useRef<((ok: boolean) => void) | null>(null);
  useDialogoAcessivel(pedido !== null);

  const confirmar = useCallback((novo: PedidoDeConfirmacao) => new Promise<boolean>((resolver) => {
    resposta.current?.(false);
    resposta.current = resolver;
    setPedido(novo);
  }), []);

  const responder = (ok: boolean) => {
    resposta.current?.(ok);
    resposta.current = null;
    setPedido(null);
  };

  const dialogo = (
    <Dialog open={pedido !== null} onOpenChange={(aberto) => { if (!aberto) responder(false); }} title={pedido?.titulo ?? ""} size="sm">
      <div className="plan-form-dialogo plan-confirmacao">
        <p className="plan-confirmacao-texto">{pedido?.texto}</p>
        <div className="plan-dialogo-acoes">
          <Button type="button" variant="secondary" onClick={() => responder(false)}>Cancelar</Button>
          <Button type="button" variant={pedido?.perigo ? "danger" : "primary"} onClick={() => responder(true)}>{pedido?.acao ?? "Confirmar"}</Button>
        </div>
      </div>
    </Dialog>
  );

  return { confirmar, dialogo };
}
