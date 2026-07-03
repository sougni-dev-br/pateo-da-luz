import type { LucideIcon } from "lucide-react";

/**
 * Uma entrada de navegacao mostrada na Sidebar / mobile drawer.
 * O tipo intencionalmente NAO inclui path/matchers/showInSidebar —
 * essas sao concerns do App.tsx (que filtra por permissao e faz o
 * routing). A Sidebar so precisa saber o que renderizar e disparar
 * onNavigate(id) quando clicado.
 */
export type SidebarSection = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export type SidebarSectionGroup = {
  group: string;
  items: SidebarSection[];
};
