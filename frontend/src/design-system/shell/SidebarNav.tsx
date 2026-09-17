import { Star } from "lucide-react";
import type { SidebarSection, SidebarSectionGroup } from "./types";
import "./SidebarNav.css";

/**
 * Prepende um grupo "Favoritos" no topo, com as sections marcadas como
 * favoritas. Retorna a lista original se favoritos = [].
 * Uso: Sidebar internamente + mobile drawer no App.tsx.
 */
export function withFavoritesGroup(
  groups: SidebarSectionGroup[],
  favorites: string[]
): SidebarSectionGroup[] {
  if (favorites.length === 0) return groups;
  const allItems = groups.flatMap((g) => g.items);
  const favItems = allItems.filter((item) => favorites.includes(item.id));
  if (favItems.length === 0) return groups;
  return [{ group: "Favoritos", items: favItems }, ...groups];
}

export type SidebarNavProps = {
  groups: SidebarSectionGroup[];
  activeId: string;
  favorites: string[];
  onNavigate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Contadores opcionais por section.id (ex.: pendingCountSessionCount). */
  badges?: Record<string, number>;
  /** Modo compacto: so icones, sem rotulo visivel e sem estrela. */
  collapsed?: boolean;
};

type ItemProps = {
  section: SidebarSection;
  active: boolean;
  favorite: boolean;
  badge?: number;
  collapsed: boolean;
  onNavigate: () => void;
  onToggleFavorite: () => void;
};

function SidebarNavItem({ section, active, favorite, badge, collapsed, onNavigate, onToggleFavorite }: ItemProps) {
  const Icon = section.icon;
  const rootClass = active ? "ds-sidebar-nav-item ds-sidebar-nav-item-active" : "ds-sidebar-nav-item";
  const starClass = favorite ? "ds-sidebar-nav-star ds-sidebar-nav-star-active" : "ds-sidebar-nav-star";
  return (
    <div className="ds-sidebar-nav-item-wrap">
      <button
        className={rootClass}
        type="button"
        title={section.label}
        // Recolhida, o rotulo sai do DOM: sem aria-label o botao viraria um
        // icone sem nome para o leitor de tela.
        aria-label={collapsed ? section.label : undefined}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon size={18} strokeWidth={2} aria-hidden />
        {!collapsed && <span className="ds-sidebar-nav-item-label">{section.label}</span>}
        {badge != null && badge > 0 && (
          <span
            className="ds-sidebar-nav-item-badge"
            aria-label={`${badge} pendencia(s)`}
            title={`${badge} pendencia(s)`}
          >
            {collapsed ? "" : badge}
          </span>
        )}
      </button>
      {!collapsed && (
        <button
          className={starClass}
          type="button"
          aria-pressed={favorite}
          aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star size={13} fill={favorite ? "currentColor" : "none"} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function SidebarNav({ groups, activeId, favorites, onNavigate, onToggleFavorite, badges = {}, collapsed = false }: SidebarNavProps) {
  return (
    <nav
      className={collapsed ? "ds-sidebar-nav ds-sidebar-nav--collapsed" : "ds-sidebar-nav"}
      aria-label="Navegação principal"
    >
      {groups.map((group) => (
        <div className="ds-sidebar-nav-group" key={group.group}>
          {/* Recolhida, o rotulo do grupo vira um filete: o nome nao cabe, mas a
              separacao entre Financeiro e Estoque continua sendo informacao. */}
          <span className="ds-sidebar-nav-group-label" aria-hidden={collapsed || undefined}>
            {collapsed ? "" : group.group}
          </span>
          {group.items.map((section) => (
            <SidebarNavItem
              key={section.id}
              section={section}
              active={section.id === activeId}
              favorite={favorites.includes(section.id)}
              badge={badges[section.id]}
              collapsed={collapsed}
              onNavigate={() => onNavigate(section.id)}
              onToggleFavorite={() => onToggleFavorite(section.id)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
