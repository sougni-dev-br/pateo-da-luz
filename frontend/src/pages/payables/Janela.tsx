import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton, PanelEyebrow } from "../../design-system";

type Props = {
  eyebrow: string;
  titulo: ReactNode;
  onFechar: () => void;
  /** Enquanto grava, Esc e o X não fecham (senão a janela some com o pedido no ar). */
  ocupado?: boolean;
  largura?: "estreita" | "media" | "larga";
  children: ReactNode;
};

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Janela das telas de Contas a Pagar (mesmo comportamento da Janela de Extras):
// Esc fecha, o Tab fica preso dentro e o foco volta para quem abriu.
export function Janela({ eyebrow, titulo, onFechar, ocupado = false, largura = "media", children }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLElement>(null);
  // Lido no primeiro desenho: o autoFocus de um campo interno já roubou o foco quando os efeitos rodam.
  const anterior = useRef<HTMLElement | null | undefined>(undefined);
  if (anterior.current === undefined) anterior.current = document.activeElement as HTMLElement | null;
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    const voltarPara = anterior.current;
    const el = painel.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => { voltarPara?.focus?.(); };
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const abertas = document.querySelectorAll('[role="dialog"]');
      if (abertas[abertas.length - 1] !== ref.current) return;
      if (e.key === "Escape" && !ocupado) {
        e.stopPropagation();
        fechar.current();
        return;
      }
      if (e.key !== "Tab" || !painel.current) return;
      const focaveis = [...painel.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((f) => f.offsetParent !== null);
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === painel.current)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ocupado]);

  return (
    <div ref={ref} className="modal-backdrop pg-backdrop" role="dialog" aria-modal="true" aria-labelledby={id}>
      <section ref={painel} className={`panel modal-panel pg-janela pg-janela--${largura}`} tabIndex={-1}>
        <header className="pg-janela-topo">
          <div>
            <PanelEyebrow>{eyebrow}</PanelEyebrow>
            <h2 id={id}>{titulo}</h2>
          </div>
          <IconButton label="Fechar (Esc)" icon={<X size={18} />} size="sm" onClick={() => fechar.current()} disabled={ocupado} />
        </header>
        {children}
      </section>
    </div>
  );
}
