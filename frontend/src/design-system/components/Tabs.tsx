import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import "./Tabs.css";

export type TabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type TabsProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  tabs: TabItem[];
  value: string;
  onChange?: (value: string) => void;
};

export function Tabs({ tabs, value, onChange, className, onKeyDown, ...rest }: TabsProps) {
  const classes = ["ds-tabs", className].filter(Boolean).join(" ");
  const lista = useRef<HTMLDivElement>(null);
  // Sem nenhuma aba ativa, a primeira continua alcançável pelo Tab.
  const temAtiva = tabs.some((t) => t.value === value);

  // Padrão WAI-ARIA de abas: só a aba ativa entra na ordem do Tab; setas, Home e End movem o foco entre as abas
  // (ativar é Enter/Espaço, o clique do botão), sem disparar uma carga a cada seta.
  function teclar(evento: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(evento);
    if (evento.defaultPrevented) return;
    const botoes = Array.from(lista.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []);
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (atual < 0 || botoes.length === 0) return;
    const destino =
      evento.key === "ArrowRight" ? (atual + 1) % botoes.length
      : evento.key === "ArrowLeft" ? (atual - 1 + botoes.length) % botoes.length
      : evento.key === "Home" ? 0
      : evento.key === "End" ? botoes.length - 1
      : -1;
    if (destino < 0) return;
    evento.preventDefault();
    botoes[destino].focus();
  }

  return (
    <div ref={lista} className={classes} role="tablist" onKeyDown={teclar} {...rest}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (!temAtiva && tab === tabs[0]) ? 0 : -1}
            disabled={tab.disabled}
            className={active ? "ds-tab ds-tab-active" : "ds-tab"}
            onClick={() => onChange?.(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
