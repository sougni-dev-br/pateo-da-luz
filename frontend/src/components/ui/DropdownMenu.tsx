import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { type ReactNode } from "react";

type DropdownItem = {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "danger" | "default";
  checked?: boolean;
};

type DropdownSeparator = { separator: true };

type DropdownMenuProps = {
  trigger: ReactNode;
  items: (DropdownItem | DropdownSeparator)[];
  align?: "start" | "center" | "end";
};

function isSeparator(item: DropdownItem | DropdownSeparator): item is DropdownSeparator {
  return "separator" in item;
}

export function DropdownMenu({ trigger, items, align = "end" }: DropdownMenuProps) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content className="radix-dropdown-content" align={align} sideOffset={4}>
          {items.map((item, i) => {
            if (isSeparator(item)) {
              return <RadixDropdown.Separator key={i} className="radix-dropdown-separator" />;
            }
            return (
              <RadixDropdown.Item
                key={i}
                className={`radix-dropdown-item${item.tone === "danger" ? " radix-dropdown-item-danger" : ""}`}
                disabled={item.disabled}
                onSelect={item.onClick}
              >
                {item.icon && <span className="radix-dropdown-item-icon">{item.icon}</span>}
                {item.label}
                {item.checked !== undefined && item.checked && (
                  <span className="radix-dropdown-item-check"><Check size={13} /></span>
                )}
              </RadixDropdown.Item>
            );
          })}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

export const DropdownMenuRoot = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;
export const DropdownMenuContent = RadixDropdown.Content;
export const DropdownMenuItem = RadixDropdown.Item;
export const DropdownMenuSeparator = RadixDropdown.Separator;
export const DropdownMenuLabel = RadixDropdown.Label;
export const DropdownMenuSub = RadixDropdown.Sub;
export const DropdownMenuSubTrigger = RadixDropdown.SubTrigger;
export const DropdownMenuSubContent = RadixDropdown.SubContent;
export { ChevronRight };
