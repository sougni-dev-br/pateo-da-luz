import { ArrowLeft } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import "./ListDetailLayout.css";

export type ListDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  /**
   * Mobile (<900px): quando true, mostra o painel de detalhe com botão
   * voltar; quando false, mostra a lista. Desktop mostra os dois sempre.
   */
  detailActive?: boolean;
  /** Chamado pelo botão voltar do mobile. */
  onBack?: () => void;
  /** Rótulo do botão voltar. Default: "Voltar". */
  backLabel?: string;
  className?: string;
};

/**
 * Layout 2-col lista + editor (padrão da tela de Usuários).
 * Desktop: grid 320px + 1fr. Mobile: navegação empilhada controlada
 * por detailActive/onBack.
 */
function ListDetailLayoutRoot({
  list,
  detail,
  detailActive = false,
  onBack,
  backLabel = "Voltar",
  className
}: ListDetailLayoutProps) {
  const classes = [
    "ds-list-detail",
    detailActive && "ds-list-detail-detail-active",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="ds-list-detail-list-pane">{list}</div>
      <div className="ds-list-detail-detail-pane">
        {onBack && (
          <button type="button" className="ds-list-detail-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden />
            {backLabel}
          </button>
        )}
        {detail}
      </div>
    </div>
  );
}

export type ListDetailListProps = HTMLAttributes<HTMLDivElement> & {
  /** Busca/filtros fixos acima da lista rolável. */
  header?: ReactNode;
  /** Ações fixas abaixo da lista (ex.: "Novo usuário"). */
  footer?: ReactNode;
};

function List({ header, footer, className, children, ...rest }: ListDetailListProps) {
  const classes = ["ds-list-detail-list", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {header && <div className="ds-list-detail-list-header">{header}</div>}
      <div className="ds-list-detail-list-scroll" role="list">
        {children}
      </div>
      {footer && <div className="ds-list-detail-list-footer">{footer}</div>}
    </div>
  );
}

export type ListDetailItemProps = {
  title: string;
  subtitle?: string;
  active?: boolean;
  /** Adorno à direita (badge, status). */
  meta?: ReactNode;
  onClick?: () => void;
};

function Item({ title, subtitle, active, meta, onClick }: ListDetailItemProps) {
  const classes = ["ds-list-detail-item", active && "ds-list-detail-item-active"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      role="listitem"
      className={classes}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
    >
      <span className="ds-list-detail-item-text">
        <strong className="ds-list-detail-item-title">{title}</strong>
        {subtitle && <small className="ds-list-detail-item-subtitle">{subtitle}</small>}
      </span>
      {meta && <span className="ds-list-detail-item-meta">{meta}</span>}
    </button>
  );
}

export const ListDetailLayout = Object.assign(ListDetailLayoutRoot, { List, Item });
