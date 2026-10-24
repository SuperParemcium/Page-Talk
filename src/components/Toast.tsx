import { Check, CircleAlert, Info, X } from "lucide-react";

export interface ToastState {
  id: number;
  message: string;
  type?: "success" | "error" | "info";
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  const Icon = toast.type === "error" ? CircleAlert : toast.type === "success" ? Check : Info;
  return (
    <div className={`toast toast-${toast.type || "info"}`} role="status">
      <Icon size={16} strokeWidth={2} />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  );
}
