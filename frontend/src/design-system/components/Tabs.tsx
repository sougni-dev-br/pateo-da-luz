import type { HTMLAttributes, ReactNode } from "react";
import "./Tabs.css";

export type TabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type TabsProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  tabs: TabItem[];
  value: string;
  onChange?: (value: string) => void;
};

export function Tabs({ tabs, value, onChange, className, ...rest }: TabsProps) {
  const classes = ["ds-tabs", className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="tablist" {...rest}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            className={active ? "ds-tab ds-tab-active" : "ds-tab"}
            onClick={() => onChange?.(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
