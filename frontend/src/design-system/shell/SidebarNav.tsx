import { ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SidebarSection, SidebarSectionGroup } from "./types";
import "./SidebarNav.css";

const CLOSED_GROUPS_KEY = "pateo:sidebar:grupos-fechados";

/**
 * Prepende um grupo "Favoritos" no topo e MOVE para ele as sections marcadas
 * como favoritas (o item sai do grupo de origem, sem aparecer duas vezes).
 * Grupos que ficarem vazios somem. Retorna a lista original se favoritos = [].
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
  const rest = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => !favorites.includes(item.id)) }))
    .filter((g) => g.items.length > 0);
  return [{ group: "Favoritos", items: favItems }, ...rest];
}

/** Sem acento e sem caixa: "analise" encontra "Análise". */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Mantem so os items cujo rotulo contem a busca; descarta grupos vazios. */
export function filterGroupsByQuery(groups: SidebarSectionGroup[], query: string): SidebarSectionGroup[] {
  const needle = normalizeSearchText(query);
  if (!needle) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((item) => normalizeSearchText(item.label).includes(needle)) }))
    .filter((g) => g.items.length > 0);
}

function readClosedGroups(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CLOSED_GROUPS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(closed: string[]): void {
  try {
    window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(closed));
  } catch {
    // Storage bloqueado (janela privada): o estado vale so para a sessao.
  }
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
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const searching = normalizeSearchText(query) !== "";
  const visibleGroups = searching ? filterGroupsByQuery(groups, query) : groups;
  const activeGroup = groups.find((g) => g.items.some((item) => item.id === activeId))?.group;

  // Navegou para um item (clique, favorito, link): o grupo dele abre sozinho.
  useEffect(() => {
    if (!activeGroup) return;
    setClosedGroups((current) => {
      if (!current.includes(activeGroup)) return current;
      const next = current.filter((g) => g !== activeGroup);
      writeClosedGroups(next);
      return next;
    });
  }, [activeGroup]);

  // Ctrl+K foca a busca (Cmd+K no Mac). Recolhida a so icones nao ha campo.
  useEffect(() => {
    if (collapsed) return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed]);

  function toggleGroup(group: string) {
    setClosedGroups((current) => {
      const next = current.includes(group) ? current.filter((g) => g !== group) : [...current, group];
      writeClosedGroups(next);
      return next;
    });
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter") {
      const first = visibleGroups[0]?.items[0];
      if (!first) return;
      setQuery("");
      event.currentTarget.blur();
      onNavigate(first.id);
    }
  }

  return (
    <nav
      className={collapsed ? "ds-sidebar-nav ds-sidebar-nav--collapsed" : "ds-sidebar-nav"}
      aria-label="Navegação principal"
    >
      {!collapsed && (
        <div className="ds-sidebar-nav-search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Buscar no menu"
            aria-label="Buscar no menu"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {!searching && <kbd aria-hidden>Ctrl K</kbd>}
        </div>
      )}
      {searching && visibleGroups.length === 0 && (
        <p className="ds-sidebar-nav-empty" role="status">
          Nenhum item encontrado.
        </p>
      )}
      {visibleGroups.map((group) => {
        // Recolhida a so icones nao ha acordeao; buscando, tudo que casou aparece.
        const open = collapsed || searching || !closedGroups.includes(group.group);
        const closedPending = open ? 0 : group.items.reduce((sum, item) => sum + (badges[item.id] ?? 0), 0);
        const panelId = `ds-sidebar-group-${group.group.replace(/\s+/g, "-")}`;
        return (
          <div className="ds-sidebar-nav-group" key={group.group}>
            {collapsed ? (
              // Recolhida, o rotulo do grupo vira um filete: o nome nao cabe, mas a
              // separacao entre Financeiro e Estoque continua sendo informacao.
              <span className="ds-sidebar-nav-group-label" aria-hidden />
            ) : searching ? (
              <span className="ds-sidebar-nav-group-label">{group.group}</span>
            ) : (
              <button
                className="ds-sidebar-nav-group-label ds-sidebar-nav-group-toggle"
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggleGroup(group.group)}
              >
                <span>{group.group}</span>
                {closedPending > 0 && (
                  <span className="ds-sidebar-nav-item-badge" aria-label={`${closedPending} pendencia(s)`}>
                    {closedPending}
                  </span>
                )}
                <ChevronDown size={13} aria-hidden className="ds-sidebar-nav-group-chevron" />
              </button>
            )}
            {open && (
              <div className="ds-sidebar-nav-group-items" id={panelId}>
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
