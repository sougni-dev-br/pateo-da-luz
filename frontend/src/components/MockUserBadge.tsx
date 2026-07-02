import { createPortal } from "react-dom";
import { isMockUserMode } from "../lib/mockUser";
import "./MockUserBadge.css";

/**
 * Badge fixo top-right avisando que a sessao esta em modo mock-user.
 * Nao aparece em producao (isLocal=false) nem sem ?mock-user=1.
 *
 * Portalizado em document.body para escapar de qualquer stacking context
 * criado por providers/AppShell (transform, overflow, z-index de irmaos).
 * Garante que fique visivel sobre a UI toda.
 */
export function MockUserBadge() {
  if (!isMockUserMode()) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <span className="mock-user-badge" title="Backend nao esta sendo consultado — respostas mockadas">
      Mock user
    </span>,
    document.body
  );
}
