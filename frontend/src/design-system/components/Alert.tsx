import { CheckCircle2, Info, XCircle, AlertTriangle } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "error";

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: AlertTone;
  /** Override do ícone padrão do tom. Passa null para suprimir. */
  icon?: ReactNode;
  children: ReactNode;
};

const DEFAULT_ICON: Record<AlertTone, ReactNode> = {
  info: <Info size={18} strokeWidth={2} />,
  success: <CheckCircle2 size={18} strokeWidth={2} />,
  warning: <AlertTriangle size={18} strokeWidth={2} />,
  error: <XCircle size={18} strokeWidth={2} />
};

export function Alert({ tone = "info", icon, className, children, ...rest }: AlertProps) {
  const classes = ["ds-alert", `ds-alert-${tone}`, className].filter(Boolean).join(" ");
  const resolvedIcon = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <div role="status" className={classes} {...rest}>
      {resolvedIcon !== null && <span className="ds-alert-icon">{resolvedIcon}</span>}
      <span className="ds-alert-body">{children}</span>
    </div>
  );
}
