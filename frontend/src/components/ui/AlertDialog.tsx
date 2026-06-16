import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle, Trash2 } from "lucide-react";
import { type ReactNode } from "react";

type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning";
  onConfirm: () => void;
};

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "warning",
  onConfirm,
}: AlertDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className="radix-dialog-overlay" />
        <RadixAlertDialog.Content className="radix-dialog-content radix-dialog-sm">
          <div className="confirm-dialog-icon">
            {tone === "danger" ? <Trash2 size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div className="confirm-dialog-content">
            <RadixAlertDialog.Title className="radix-dialog-title">{title}</RadixAlertDialog.Title>
            <RadixAlertDialog.Description className="radix-dialog-description">{description}</RadixAlertDialog.Description>
            <div className="form-actions">
              <RadixAlertDialog.Cancel asChild>
                <button className="secondary-button" type="button">{cancelLabel}</button>
              </RadixAlertDialog.Cancel>
              <RadixAlertDialog.Action asChild>
                <button
                  className={tone === "danger" ? "danger-button" : "primary-button"}
                  type="button"
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </button>
              </RadixAlertDialog.Action>
            </div>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
