import { useRef, type KeyboardEvent, type ReactNode } from "react";

// Abas do Planejamento no padrão WAI-ARIA completo: cada aba aponta para o seu painel (aria-controls) e o painel diz
// qual aba o nomeia (aria-labelledby). Setas, Home e End trocam de aba (ativação automática: trocar é barato aqui).

export type Aba<T extends string> = { valor: T; rotulo: ReactNode; /** Marca a aba com um ponto de atenção (texto lido pelo leitor de tela). */ alerta?: string };

type Props<T extends string> = {
  id: string;
  abas: Aba<T>[];
  valor: T;
  rotulo: string;
  variante?: "primaria" | "segmentada";
  aoMudar: (valor: T) => void;
};

export const idDaAba = (id: string, valor: string) => `${id}-aba-${valor}`;
export const idDoPainel = (id: string, valor: string) => `${id}-painel-${valor}`;

export function Abas<T extends string>({ id, abas, valor, rotulo, variante = "primaria", aoMudar }: Props<T>) {
  const lista = useRef<HTMLDivElement>(null);

  function teclar(evento: KeyboardEvent<HTMLDivElement>) {
    const atual = abas.findIndex((a) => a.valor === valor);
    const ultimo = abas.length - 1;
    const destino =
      evento.key === "ArrowRight" ? (atual + 1) % abas.length
      : evento.key === "ArrowLeft" ? (atual - 1 + abas.length) % abas.length
      : evento.key === "Home" ? 0
      : evento.key === "End" ? ultimo
      : -1;
    if (destino < 0) return;
    evento.preventDefault();
    aoMudar(abas[destino].valor);
    lista.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(idDaAba(id, abas[destino].valor))}`)?.focus();
  }

  return (
    <div ref={lista} role="tablist" aria-label={rotulo} className={`plan-abas plan-abas-${variante}`} onKeyDown={teclar}>
      {abas.map((aba) => {
        const ativa = aba.valor === valor;
        return (
          <button
            key={aba.valor}
            id={idDaAba(id, aba.valor)}
            type="button"
            role="tab"
            aria-selected={ativa}
            aria-controls={idDoPainel(id, aba.valor)}
            tabIndex={ativa ? 0 : -1}
            className="plan-aba"
            onClick={() => aoMudar(aba.valor)}
          >
            <span>{aba.rotulo}</span>
            {aba.alerta && (
              <>
                <span className="plan-aba-alerta" aria-hidden />
                <span className="plan-sr">{` (${aba.alerta})`}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

type PainelProps = { id: string; valor: string; className?: string; children: ReactNode };

export function PainelDaAba({ id, valor, className, children }: PainelProps) {
  return (
    <div role="tabpanel" id={idDoPainel(id, valor)} aria-labelledby={idDaAba(id, valor)} tabIndex={-1} className={["plan-painel", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
