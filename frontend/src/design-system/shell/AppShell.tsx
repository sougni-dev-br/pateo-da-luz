import { forwardRef } from "react";
import type { ReactNode } from "react";
import "./AppShell.css";

export type AppShellProps = {
  /** Sidebar já renderizada (JSX) — a Fase 4B substitui por <Sidebar />. */
  sidebar: ReactNode;
  /** Topbar da coluna principal. Null durante 4A, chega na 4C. */
  topbar?: ReactNode;
  /** Header mobile (com botão de abrir menu). Renderizado antes do main. */
  mobileHeader?: ReactNode;
  /** Drawer mobile (AnimatePresence). Renderizado antes do main. */
  drawer?: ReactNode;
  children: ReactNode;
};

/**
 * Shell fixo do app: sidebar 264px + coluna principal (main-col) com
 * topbar sticky + content com scroll próprio. Baseado em kit.css.
 * Não gerencia sessão nem rotas — só provê a estrutura visual.
 */
export const AppShell = forwardRef<HTMLElement, AppShellProps>(function AppShell(
  { sidebar, topbar, mobileHeader, drawer, children },
  contentRef
) {
  return (
    <main className="app-shell">
      {mobileHeader}
      {drawer}
      {sidebar}
      <div className="main-col">
        {topbar}
        <section className="content" ref={contentRef}>
          {children}
        </section>
      </div>
    </main>
  );
});
