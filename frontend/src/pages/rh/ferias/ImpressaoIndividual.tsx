import { Printer } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { PessoaFerias } from "../../../api/client";
import { Button } from "../../../design-system";
import { FichaIndividual } from "./FichaIndividual";
import { fichaIndividual } from "./impressao";
import "./impressao.css";

const CLASSE_IMPRIMINDO = "imprimindo-ferias";

type Props = { pessoa: PessoaFerias; hoje: string; onClose: () => void };

/** Imprime a ficha de férias de uma pessoa só (A4 em pé), com prévia. */
export function ImpressaoIndividual({ pessoa, hoje, onClose }: Props) {
  const ficha = useMemo(() => fichaIndividual(pessoa), [pessoa]);
  const rodape = useRef<HTMLElement>(null);

  // Abre com o foco em "Imprimir" (o último botão do rodapé).
  useEffect(() => { rodape.current?.querySelector<HTMLButtonElement>("button:last-of-type")?.focus(); }, []);
  useEffect(() => () => { document.body.classList.remove(CLASSE_IMPRIMINDO); }, []);

  function imprimir() {
    const estiloPagina = document.createElement("style");
    estiloPagina.textContent = "@page { size: A4 portrait; margin: 12mm; }";
    document.head.appendChild(estiloPagina);
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      estiloPagina.remove();
      window.removeEventListener("afterprint", limpar);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
  }

  const folha = <FichaIndividual ficha={ficha} emissao={hoje} />;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="panel modal-panel fe-imp" role="dialog" aria-modal="true" aria-labelledby="fe-imp-ind-titulo"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <header className="fe-imp-topo">
          <div>
            <h2 id="fe-imp-ind-titulo">Imprimir férias de {ficha.nome}</h2>
            <p>Uma folha A4 em pé, com os períodos e as datas combinadas.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar (Esc)</Button>
        </header>
        <div className="fe-imp-corpo fe-imp-corpo--unico">
          <div className="fe-imp-previa" aria-label="Prévia da impressão">
            <span className="fe-imp-legenda">Prévia · {ficha.periodos.length} {ficha.periodos.length === 1 ? "período" : "períodos"}</span>
            <div className="fe-imp-papel fe-imp-papel--retrato">{folha}</div>
          </div>
        </div>
        <footer ref={rodape} className="fe-imp-base">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button leadingIcon={<Printer size={16} />} onClick={imprimir}>Imprimir</Button>
        </footer>
      </section>
      {createPortal(<div className="fe-area-impressao" aria-hidden="true">{folha}</div>, document.body)}
    </div>
  );
}
