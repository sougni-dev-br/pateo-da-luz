import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
};

export function Dialog({ open, onOpenChange, title, description, children, size = "md" }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="radix-dialog-overlay" />
        <RadixDialog.Content className={`radix-dialog-content radix-dialog-${size}`}>
          <div className="radix-dialog-header">
            <RadixDialog.Title className="radix-dialog-title">{title}</RadixDialog.Title>
            {description
              ? <RadixDialog.Description className="radix-dialog-description">{description}</RadixDialog.Description>
              : <VisuallyHidden.Root><RadixDialog.Description>{title}</RadixDialog.Description></VisuallyHidden.Root>
            }
            <RadixDialog.Close className="radix-dialog-close" aria-label="Fechar">
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div className="radix-dialog-body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
