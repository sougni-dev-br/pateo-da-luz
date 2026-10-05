import { ChevronDown, Eye, TriangleAlert } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PlateTheme } from "../../../api/client";

const MM_EM_PX = 96 / 25.4;
const LARGURA_A4_PX = 210 * MM_EM_PX;
const ALTURA_A4_PX = 297 * MM_EM_PX;

export type AlertaPrevia = { curto: string; longo: string } | null;
type Props = { resumo: string; alerta: AlertaPrevia; tema: PlateTheme; vazia: boolean; textoVazia: string; children: ReactNode;
  /** Folha deitada (cardápio em paisagem): a prévia reduz pela largura de 297 mm. */
  deitada?: boolean };

// A folha A4 real, reduzida para caber na coluna: o que se vê é o que sai na impressora.
// No celular começa fechada, para a lista de pratos não ficar lá embaixo da página.
export function PreviaFolhas({ resumo, alerta, tema, vazia, textoVazia, children, deitada = false }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);
  const [abertaNoCelular, setAbertaNoCelular] = useState(false);

  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return undefined;
    const medir = () => {
      if (caixa.clientWidth === 0) return;
      setEscala(Math.min(1, Math.max(0.2, (caixa.clientWidth - 24) / (deitada ? ALTURA_A4_PX : LARGURA_A4_PX))));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    return () => observador.disconnect();
  }, [deitada]);

  return (
    <aside className={`plq-previa${abertaNoCelular ? " plq-previa--aberta" : ""}${vazia ? " plq-previa--vazia" : ""}`} aria-label="Prévia da impressão">
      <button type="button" className="plq-previa-alternar" aria-expanded={abertaNoCelular} onClick={() => setAbertaNoCelular((v) => !v)}>
        <span>
          {abertaNoCelular ? "Esconder prévia" : "Ver prévia"} · {resumo}
          {alerta && <strong className="plq-previa-alternar-alerta"><TriangleAlert size={14} aria-hidden="true" /> {alerta.curto}</strong>}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div className="plq-previa-corpo">
        {vazia ? (
          <div className="plq-previa-vazia">
            <Eye size={22} aria-hidden="true" />
            <strong>A prévia aparece aqui</strong>
            <span>{textoVazia}</span>
          </div>
        ) : <p className="plq-previa-resumo">{resumo}</p>}
        {alerta && (
          <p className="plq-previa-alerta" role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{alerta.longo}</span>
          </p>
        )}
        {!vazia && (
          <p className="plq-previa-dica">
            Na impressora: papel A4, margens “Nenhuma”, escala 100%{tema === "gold" ? " e “Gráficos de plano de fundo” marcado" : ""}. Corte nas linhas tracejadas.
          </p>
        )}
        <div className="plq-previa-caixa" ref={caixaRef} hidden={vazia}>
          <div className="plq-previa-papeis" style={{ zoom: escala }}>{children}</div>
        </div>
      </div>
    </aside>
  );
}
