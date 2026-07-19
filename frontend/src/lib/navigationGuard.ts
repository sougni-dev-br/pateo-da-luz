import { createContext, useContext, useEffect, type MutableRefObject } from "react";

// Retorna true se pode navegar/sair; false se o usuário cancelou.
export type NavGuardFn = () => boolean;

// O App é dono do ref; o contexto apenas o expõe às páginas filhas.
// A navegação do menu (App.handleNavigate) consulta ref.current antes de sair.
export const NavigationGuardContext = createContext<MutableRefObject<NavGuardFn | null>>({ current: null });

/**
 * Enquanto `active` for true, registra um guard que pede confirmação antes de a
 * navegação do menu sair da página atual. Limpa ao desmontar ou quando `active`
 * volta a false. Use em telas com edições não salvas (ex.: Escala).
 */
export function useNavigationGuard(active: boolean, confirmMessage: string): void {
  const ref = useContext(NavigationGuardContext);
  useEffect(() => {
    if (!active) {
      ref.current = null;
      return;
    }
    ref.current = () => window.confirm(confirmMessage);
    return () => { ref.current = null; };
  }, [active, confirmMessage, ref]);
}
