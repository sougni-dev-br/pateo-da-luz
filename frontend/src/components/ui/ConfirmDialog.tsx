import { AlertTriangle } from "lucide-react";
import { ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "warning",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <section className={`panel confirm-dialog tone-${tone}`}>
        <div className="confirm-dialog-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="confirm-dialog-content">
          <h2 id="confirm-dialog-title">{title}</h2>
          <div className="confirm-dialog-description">{description}</div>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button className={tone === "danger" ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
