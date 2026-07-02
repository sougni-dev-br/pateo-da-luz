import { isMockUserMode } from "../lib/mockUser";
import "./MockUserBadge.css";

/**
 * Badge fixo top-right avisando que a sessao esta em modo mock-user.
 * Nao aparece em producao (isLocal=false) nem sem ?mock-user=1.
 */
export function MockUserBadge() {
  if (!isMockUserMode()) return null;
  return <span className="mock-user-badge" title="Backend nao esta sendo consultado — respostas mockadas">Mock user</span>;
}
