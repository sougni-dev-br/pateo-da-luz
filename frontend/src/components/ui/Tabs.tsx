import * as RadixTabs from "@radix-ui/react-tabs";
import { type ReactNode } from "react";

type Tab = { value: string; label: ReactNode; content: ReactNode; disabled?: boolean };

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  tabs: Tab[];
  className?: string;
};

export function Tabs({ value, onValueChange, tabs, className }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RadixTabs.List className="tabs">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={value === tab.value ? "active" : ""}
          >
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value}>
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export const TabsRoot = RadixTabs.Root;
export const TabsList = RadixTabs.List;
export const TabsTrigger = RadixTabs.Trigger;
export const TabsContent = RadixTabs.Content;
