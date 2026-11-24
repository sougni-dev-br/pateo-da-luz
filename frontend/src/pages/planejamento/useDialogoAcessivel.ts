import { useEffect, useRef } from "react";

// Complementa o Dialog compartilhado nos diálogos do Planejamento: marca aria-modal e, ao fechar (Esc, X ou
// Cancelar), devolve o foco ao botão que abriu, para quem usa teclado não recomeçar do topo da página.

const ESPERA_DO_RADIX_MS = 40;

export function useDialogoAcessivel(aberto: boolean) {
  const origem = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (aberto) {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) origem.current = document.activeElement;
      const id = window.setTimeout(() => {
        document.querySelectorAll('[role="dialog"]').forEach((d) => d.setAttribute("aria-modal", "true"));
      }, 0);
      return () => window.clearTimeout(id);
    }
    const alvo = origem.current;
    origem.current = null;
    if (!alvo) return undefined;
    // O Radix devolve o foco ao desmontar; esperamos ele terminar para o botão de origem ganhar o foco.
    const id = window.setTimeout(() => { if (alvo.isConnected) alvo.focus(); }, ESPERA_DO_RADIX_MS);
    return () => window.clearTimeout(id);
  }, [aberto]);
}
