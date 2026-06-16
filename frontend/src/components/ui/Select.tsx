import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode } from "react";

type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function Select({ value, onValueChange, options, placeholder = "Selecione…", disabled, className }: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger className={`radix-select-trigger ${className ?? ""}`}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="radix-select-icon">
          <ChevronDown size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="radix-select-content" position="popper" sideOffset={4}>
          <RadixSelect.ScrollUpButton className="radix-select-scroll-btn">
            <ChevronUp size={14} />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="radix-select-viewport">
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} value={opt.value} disabled={opt.disabled} className="radix-select-item">
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="radix-select-item-indicator">
                  <Check size={13} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="radix-select-scroll-btn">
            <ChevronDown size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

type SelectGroupProps = {
  label: string;
  options: SelectOption[];
};

export function SelectGroup({ label, options }: SelectGroupProps) {
  return (
    <RadixSelect.Group>
      <RadixSelect.Label className="radix-select-group-label">{label}</RadixSelect.Label>
      {options.map((opt) => (
        <RadixSelect.Item key={opt.value} value={opt.value} disabled={opt.disabled} className="radix-select-item">
          <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
          <RadixSelect.ItemIndicator className="radix-select-item-indicator">
            <Check size={13} />
          </RadixSelect.ItemIndicator>
        </RadixSelect.Item>
      ))}
    </RadixSelect.Group>
  );
}

type SelectGroupedProps = {
  value: string;
  onValueChange: (value: string) => void;
  groups: { label: string; options: SelectOption[] }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
};

export function SelectGrouped({ value, onValueChange, groups, placeholder = "Selecione…", disabled, className, children }: SelectGroupedProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger className={`radix-select-trigger ${className ?? ""}`}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="radix-select-icon"><ChevronDown size={14} /></RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="radix-select-content" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="radix-select-viewport">
            {children}
            {groups.map((group) => (
              <SelectGroup key={group.label} label={group.label} options={group.options} />
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
