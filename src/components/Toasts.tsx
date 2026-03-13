import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import type { ToastType } from "../context/ToastContext";

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={15} />,
  error: <AlertCircle size={15} />,
  info: <Info size={15} />,
  warning: <AlertTriangle size={15} />,
};

export function Toasts() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => removeToast(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
