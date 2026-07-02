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
};

type ItemProps = {
  section: SidebarSection;
  active: boolean;
  favorite: boolean;
  badge?: number;
  onNavigate: () => void;
  onToggleFavorite: () => void;
};

function SidebarNavItem({ section, active, favorite, badge, onNavigate, onToggleFavorite }: ItemProps) {
  const Icon = section.icon;
  const rootClass = active ? "ds-sidebar-nav-item ds-sidebar-nav-item-active" : "ds-sidebar-nav-item";
  const starClass = favorite ? "ds-sidebar-nav-star ds-sidebar-nav-star-active" : "ds-sidebar-nav-star";
  return (
    <div className="ds-sidebar-nav-item-wrap">
      <button
        className={rootClass}
        type="button"
        title={section.label}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon size={18} strokeWidth={2} aria-hidden />
        <span className="ds-sidebar-nav-item-label">{section.label}</span>
        {badge != null && badge > 0 && (
          <span
            className="ds-sidebar-nav-item-badge"
            aria-label={`${badge} pendencia(s)`}
            title={`${badge} pendencia(s)`}
          >
            {badge}
          </span>
        )}
      </button>
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
    </div>
  );
}

export function SidebarNav({ groups, activeId, favorites, onNavigate, onToggleFavorite, badges = {} }: SidebarNavProps) {
  return (
    <nav className="ds-sidebar-nav" aria-label="Navegação principal">
      {groups.map((group) => (
        <div className="ds-sidebar-nav-group" key={group.group}>
          <span className="ds-sidebar-nav-group-label">{group.group}</span>
          {group.items.map((section) => (
            <SidebarNavItem
              key={section.id}
              section={section}
              active={section.id === activeId}
              favorite={favorites.includes(section.id)}
              badge={badges[section.id]}
              onNavigate={() => onNavigate(section.id)}
              onToggleFavorite={() => onToggleFavorite(section.id)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
