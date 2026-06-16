import * as RadixToast from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

type ToastTone = "success" | "error" | "warning" | "info";

type ToastData = {
  id: string;
  message: string;
  tone: ToastTone;
  duration?: number;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "info", duration = 4000) => {
    const id = String(Date.now());
    setToasts((prev) => [...prev, { id, message, tone, duration }]);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            className={`radix-toast radix-toast-${t.tone}`}
            duration={t.duration}
            onOpenChange={(open) => { if (!open) remove(t.id); }}
          >
            <span className="radix-toast-icon">{toastIcon(t.tone)}</span>
            <RadixToast.Description className="radix-toast-message">{t.message}</RadixToast.Description>
            <RadixToast.Close className="radix-toast-close" aria-label="Fechar">
              <X size={14} />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="radix-toast-viewport" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

function toastIcon(tone: ToastTone) {
  switch (tone) {
    case "success": return <CheckCircle2 size={16} />;
    case "error":   return <XCircle size={16} />;
    case "warning": return <AlertTriangle size={16} />;
    default:        return <Info size={16} />;
  }
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
