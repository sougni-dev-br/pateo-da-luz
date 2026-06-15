import { createContext, useContext } from "react";
import type { AppUser, PermissionAction } from "../api/client";

export type SessionContextValue = {
  user: AppUser | null;
  setUser: (user: AppUser | null) => void;
  hideSensitiveValues: boolean;
  toggleSensitiveValues: () => void;
  canAccessSection: (sectionId: string) => boolean;
  hasPermission: (moduleId: string, action: PermissionAction) => boolean;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession deve ser usado dentro de SessionContext.Provider.");
  }
  return context;
}
