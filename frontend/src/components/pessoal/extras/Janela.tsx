import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton, PanelEyebrow } from "../../../design-system";

type Props = {
  eyebrow?: string;
  titulo: ReactNode;
  onFechar: () => void;
  // Enquanto grava, Esc e o X não fecham (senão a tela some com o pedido no ar).
  ocupado?: boolean;
  // Formulário preenchido: pergunta antes de descartar pelo Esc ou pelo X.
  confirmarDescarte?: boolean;
  children: ReactNode;
};

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Janela padrão das telas de Extras:
// - Esc fecha só a de cima (a de cadastro de pessoa abre sobre a de lançamento);
// - o foco entra na janela, o Tab fica preso nela e volta a quem a abriu ao fechar.
export function Janela({ eyebrow = "Extras", titulo, onFechar, ocupado = false, confirmarDescarte = false, children }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLElement>(null);
  // Quem tinha o foco ANTES da janela: lido no primeiro desenho, porque o
  // autoFocus de um campo interno já o roubou quando os efeitos rodam.
  const anterior = useRef<HTMLElement | null | undefined>(undefined);
  if (anterior.current === undefined) anterior.current = document.activeElement as HTMLElement | null;
  const fechar = useRef(onFechar);
  fechar.current = () => {
    if (confirmarDescarte && !window.confirm("Descartar o que foi preenchido?")) return;
    onFechar();
  };

  // Foco: entra no primeiro campo (se nenhum filho já pediu autoFocus) e volta
  // para o botão que abriu a janela quando ela fecha.
  useEffect(() => {
    const voltarPara = anterior.current;
    const el = painel.current;
    if (el && !el.contains(document.activeElement)) {
      const primeiro = [...el.querySelectorAll<HTMLElement>(FOCAVEIS)].find((f) => !f.closest(".extras-janela-topo"));
      (primeiro ?? el).focus();
    }
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
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ocupado]);

  return (
    <div ref={ref} className="modal-backdrop sobre-topo" role="dialog" aria-modal="true" aria-labelledby={id}>
      <section ref={painel} className="panel modal-panel extras-modal" tabIndex={-1}>
        <div className="extras-janela-topo">
          <div>
            <PanelEyebrow>{eyebrow}</PanelEyebrow>
            <h2 id={id}>{titulo}</h2>
          </div>
          <IconButton label="Fechar (Esc)" icon={<X size={18} />} size="sm" onClick={() => fechar.current()} disabled={ocupado} />
        </div>
        {children}
      </section>
    </div>
  );
}
