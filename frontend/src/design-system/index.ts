// Barrel do Design System Pateo da Luz.
// Consumidores fazem: import { Money, Button, ... } from "../design-system"

export { Money } from "./components/Money";
export type { MoneyProps } from "./components/Money";

export { Percent } from "./components/Percent";
export type { PercentProps } from "./components/Percent";

export { Button } from "./components/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/Button";

export { Card } from "./components/Card";
export type { CardProps } from "./components/Card";

export { StatusBadge } from "./components/StatusBadge";
export type { StatusBadgeProps, StatusTone } from "./components/StatusBadge";

export { Alert } from "./components/Alert";
export type { AlertProps, AlertTone } from "./components/Alert";

export { EmptyState } from "./components/EmptyState";
export type { EmptyStateProps } from "./components/EmptyState";

export { PageHeader } from "./components/PageHeader";
export type { PageHeaderProps } from "./components/PageHeader";

export { Tabs } from "./components/Tabs";
export type { TabsProps, TabItem } from "./components/Tabs";

export { TextField } from "./components/TextField";
export type { TextFieldProps } from "./components/TextField";

export { Select } from "./components/Select";
export type { SelectProps, SelectOption } from "./components/Select";

export { SummaryCard } from "./components/SummaryCard";
export type { SummaryCardProps, SummaryTone } from "./components/SummaryCard";

export { KpiCard } from "./components/KpiCard";
export type { KpiCardProps, KpiTone, KpiDelta, KpiDeltaDirection } from "./components/KpiCard";

export { Sparkline } from "./components/Sparkline";
export type { SparklineProps } from "./components/Sparkline";

export { HideValuesProvider, useHideValues } from "./context/HideValuesContext";
export type { HideValuesContextValue } from "./context/HideValuesContext";

export { AppShell } from "./shell/AppShell";
export type { AppShellProps } from "./shell/AppShell";
