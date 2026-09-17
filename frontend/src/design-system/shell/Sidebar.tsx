import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarNav, withFavoritesGroup } from "./SidebarNav";
import type { SidebarSectionGroup } from "./types";
import "./Sidebar.css";

export type SidebarUser = {
  name: string;
  role: string;
};

export type SidebarProps = {
  /** Grupos e items ja filtrados por permissao pelo caller. */
  groups: SidebarSectionGroup[];
  activeId: string;
  user: SidebarUser;
  favorites: string[];
  onNavigate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Badges numericos por section.id. */
  badges?: Record<string, number>;
  hideValues: boolean;
  onToggleValues: () => void;
  onLogout: () => void;
  /** Se true, mostra DEV badge no rodape (isLocal). */
  showDevBadge?: boolean;
  /** Path do logo. Default /logo-pateo-luz.png. */
  logoPath?: string;
  /** Slogan sob o nome. Default "Gestão eficiente". */
  tagline?: string;
  /** Recolhida a so icones. O estado e' do caller, que o persiste. */
  collapsed?: boolean;
  /** Ausente = sem botao de recolher (ex.: drawer mobile, que ja fecha). */
  onToggleCollapse?: () => void;
};

export function Sidebar({
  groups,
  activeId,
  user,
  favorites,
  onNavigate,
  onToggleFavorite,
  badges,
  hideValues,
  onToggleValues,
  onLogout,
  showDevBadge = false,
  logoPath = "/logo-pateo-luz.png",
  tagline = "Gestão eficiente",
  collapsed = false,
  onToggleCollapse
}: SidebarProps) {
  const displayGroups: SidebarSectionGroup[] = withFavoritesGroup(groups, favorites);

  return (
    <aside
      className={collapsed ? "ds-sidebar ds-sidebar--collapsed" : "ds-sidebar"}
      aria-label="Menu lateral"
    >
      <div className="ds-sidebar-brand">
        <div className="ds-sidebar-brand-logo-wrap">
          <img
            src={logoPath}
            alt="Pateo da Luz"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          <span className="ds-sidebar-brand-logo-fallback">PL</span>
        </div>
        {!collapsed && (
          <div className="ds-sidebar-brand-meta">
            <strong className="ds-sidebar-brand-name">Pateo da Luz</strong>
            <span className="ds-sidebar-brand-tag">{tagline}</span>
          </div>
        )}
        {onToggleCollapse && (
          <button
            className="ds-sidebar-collapse-toggle"
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={collapsed ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>

      <SidebarNav
        groups={displayGroups}
        activeId={activeId}
        favorites={favorites}
        onNavigate={onNavigate}
        onToggleFavorite={onToggleFavorite}
        badges={badges}
        collapsed={collapsed}
      />

      <div className="ds-sidebar-footer">
        {!collapsed && (
          <div className="ds-sidebar-footer-meta">
            <span className="ds-sidebar-footer-meta-name">{user.name}</span>
            <small className="ds-sidebar-footer-meta-role">{user.role}</small>
          </div>
        )}
        <div className="ds-sidebar-footer-actions">
          <button
            className="ds-sidebar-footer-button"
            type="button"
            aria-pressed={hideValues}
            aria-label={collapsed ? (hideValues ? "Mostrar valores" : "Ocultar valores") : undefined}
            title={hideValues ? "Mostrar valores" : "Ocultar valores"}
            onClick={onToggleValues}
          >
            {collapsed ? (hideValues ? "R$" : "•••") : hideValues ? "Mostrar valores" : "Ocultar valores"}
          </button>
          <button
            className="ds-sidebar-footer-button ds-sidebar-footer-button-danger"
            type="button"
            aria-label={collapsed ? "Sair" : undefined}
            title="Sair"
            onClick={onLogout}
          >
            <LogOut size={16} aria-hidden />
            {!collapsed && "Sair"}
          </button>
        </div>
        {showDevBadge && !collapsed && <span className="ds-sidebar-dev-badge">DEV</span>}
      </div>
    </aside>
  );
}
