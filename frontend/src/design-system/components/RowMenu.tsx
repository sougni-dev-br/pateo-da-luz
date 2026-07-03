import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import "./RowMenu.css";

export type RowMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
};

export type RowMenuSeparator = { separator: true };

export type RowMenuProps = {
  items: (RowMenuItem | RowMenuSeparator)[];
  /** aria-label do trigger. Default: "Mais ações". */
  label?: string;
  align?: "start" | "center" | "end";
};

function isSeparator(item: RowMenuItem | RowMenuSeparator): item is RowMenuSeparator {
  return "separator" in item;
}

/**
 * Menu "..." de ações secundárias em linhas de tabela. Par do IconButton:
 * 1-2 ações primárias ficam como IconButton, o resto entra aqui.
 */
export function RowMenu({ items, label = "Mais ações", align = "end" }: RowMenuProps) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>
        <button type="button" className="ds-row-menu-trigger" aria-label={label} title={label}>
          <MoreHorizontal size={17} aria-hidden />
        </button>
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content className="ds-row-menu-content" align={align} sideOffset={4}>
          {items.map((item, index) => {
            if (isSeparator(item)) {
              return <RadixDropdown.Separator key={index} className="ds-row-menu-separator" />;
            }
            const itemClasses = [
              "ds-row-menu-item",
              item.tone === "danger" && "ds-row-menu-item-danger"
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <RadixDropdown.Item
                key={index}
                className={itemClasses}
                disabled={item.disabled}
                onSelect={item.onClick}
              >
                {item.icon && <span className="ds-row-menu-item-icon">{item.icon}</span>}
                {item.label}
              </RadixDropdown.Item>
            );
          })}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
