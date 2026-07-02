import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useSession } from "../../context/SessionContext";

export type HideValuesContextValue = {
  hidden: boolean;
  toggle: () => void;
};

const HideValuesContext = createContext<HideValuesContextValue | null>(null);

export function HideValuesProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const value = useMemo<HideValuesContextValue>(
    () => ({
      hidden: session.hideSensitiveValues,
      toggle: session.toggleSensitiveValues
    }),
    [session.hideSensitiveValues, session.toggleSensitiveValues]
  );
  return <HideValuesContext.Provider value={value}>{children}</HideValuesContext.Provider>;
}

export function useHideValues(): HideValuesContextValue {
  const context = useContext(HideValuesContext);
  if (!context) {
    throw new Error("useHideValues deve ser usado dentro de HideValuesProvider.");
  }
  return context;
}
