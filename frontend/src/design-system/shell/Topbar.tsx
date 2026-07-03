import { Bell, Calendar, ChevronDown, ChevronRight, Eye, EyeOff, Search } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import "./Topbar.css";

export type TopbarProps = {
  /** Partes do breadcrumb. Ultimo item recebe destaque (ink + semibold). */
  breadcrumb: string[];
  /** Texto do seletor de periodo (ex.: "Julho 2026"). */
  period: string;
  /** Estado atual do toggle de valores. */
  hideValues: boolean;
  onToggleValues: () => void;
  /** Valor controlado da busca. Se undefined, o input e uncontrolled. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Contagem no sino (mostra dot vermelho se > 0). */
  notificationCount?: number;
  onBellClick?: () => void;
  onPeriodClick?: () => void;
  /** Slot extra a esquerda das ferramentas (ex.: link "Ajuda"). */
  extras?: ReactNode;
};

export function Topbar({
  breadcrumb,
  period,
  hideValues,
  onToggleValues,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar fornecedor, NF, produto…",
  notificationCount = 0,
  onBellClick,
  onPeriodClick,
  extras
}: TopbarProps) {
  const isSearchControlled = searchValue !== undefined;
  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(event.target.value);
  };
  const searchInputProps = isSearchControlled
    ? { value: searchValue, onChange: handleSearchChange }
    : { defaultValue: "", onChange: handleSearchChange };

  return (
    <div className="ds-topbar" role="banner">
      <nav className="ds-topbar-crumb" aria-label="Localização atual">
        {breadcrumb.map((part, i) => {
          const isLast = i === breadcrumb.length - 1;
          return (
            <span key={`${i}-${part}`} className="ds-topbar-crumb-part">
              {i > 0 && (
                <ChevronRight className="ds-topbar-crumb-sep" size={12} aria-hidden />
              )}
              {isLast ? (
                <strong className="ds-topbar-crumb-current">{part}</strong>
              ) : (
                <span>{part}</span>
              )}
            </span>
          );
        })}
      </nav>

      <label className="ds-topbar-search">
        <Search size={15} strokeWidth={2} aria-hidden />
        <input
          type="search"
          placeholder={searchPlaceholder}
          aria-label="Buscar"
          {...searchInputProps}
        />
      </label>

      <span className="ds-topbar-spacer" />

      {extras}

      <div className="ds-topbar-tools">
        <button
          type="button"
          className="ds-topbar-period"
          onClick={onPeriodClick}
          aria-label={`Período atual: ${period}`}
        >
          <Calendar size={14} strokeWidth={2} className="ds-topbar-period-icon-lead" aria-hidden />
          {period}
          <ChevronDown size={12} strokeWidth={2} className="ds-topbar-period-icon-tail" aria-hidden />
        </button>

        <button
          type="button"
          className={hideValues ? "ds-topbar-icon-pill ds-topbar-icon-pill-on" : "ds-topbar-icon-pill"}
          aria-pressed={hideValues}
          aria-label={hideValues ? "Mostrar valores" : "Ocultar valores"}
          title={hideValues ? "Mostrar valores" : "Ocultar valores"}
          onClick={onToggleValues}
        >
          {hideValues ? (
            <EyeOff size={18} strokeWidth={2} aria-hidden />
          ) : (
            <Eye size={18} strokeWidth={2} aria-hidden />
          )}
        </button>

        <button
          type="button"
          className="ds-topbar-icon-pill"
          aria-label={notificationCount > 0 ? `${notificationCount} notificação(ões)` : "Notificações"}
          title="Notificações"
          onClick={onBellClick}
        >
          <Bell size={18} strokeWidth={2} aria-hidden />
          {notificationCount > 0 && <span className="ds-topbar-icon-pill-dot" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
