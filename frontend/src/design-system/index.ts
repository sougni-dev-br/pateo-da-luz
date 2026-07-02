// Barrel do Design System Pateo da Luz.
// Consumidores fazem: import { Money, useHideValues } from "@/design-system"
// (o alias @/ nao existe no repo — usar caminho relativo por enquanto).

export { Money } from "./components/Money";
export type { MoneyProps } from "./components/Money";

export { Percent } from "./components/Percent";
export type { PercentProps } from "./components/Percent";

export { HideValuesProvider, useHideValues } from "./context/HideValuesContext";
export type { HideValuesContextValue } from "./context/HideValuesContext";
