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

export { FormField } from "./components/FormField";
export type { FormFieldProps } from "./components/FormField";

export { FormGrid } from "./components/FormGrid";
export type { FormGridProps } from "./components/FormGrid";

export { FormSection } from "./components/FormSection";
export type { FormSectionProps } from "./components/FormSection";

export { Switch } from "./components/Switch";
export type { SwitchProps } from "./components/Switch";

export { Textarea } from "./components/Textarea";
export type { TextareaProps } from "./components/Textarea";

export { Table } from "./components/Table";
export type { TableProps, TableRowProps, TableThProps, TableTdProps } from "./components/Table";

export { IconButton } from "./components/IconButton";
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from "./components/IconButton";

export { RowMenu } from "./components/RowMenu";
export type { RowMenuProps, RowMenuItem, RowMenuSeparator } from "./components/RowMenu";

export { ListDetailLayout } from "./components/ListDetailLayout";
export type {
  ListDetailLayoutProps,
  ListDetailListProps,
  ListDetailItemProps
} from "./components/ListDetailLayout";

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

export { ContentErrorBoundary } from "./shell/ContentErrorBoundary";

export { Sidebar } from "./shell/Sidebar";
export type { SidebarProps, SidebarUser } from "./shell/Sidebar";

export { Topbar } from "./shell/Topbar";
export type { TopbarProps } from "./shell/Topbar";

export { LoginShell } from "./shell/LoginShell";
export type { LoginShellProps } from "./shell/LoginShell";

export { SidebarNav, withFavoritesGroup } from "./shell/SidebarNav";
export type { SidebarNavProps } from "./shell/SidebarNav";

export type { SidebarSection, SidebarSectionGroup } from "./shell/types";
