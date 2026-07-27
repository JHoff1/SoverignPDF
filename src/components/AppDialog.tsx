import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function AppDialog({
  title,
  description,
  confirmLabel,
  confirmDisabled = false,
  busy = false,
  showCancel = true,
  secondaryLabel,
  onSecondary,
  wide = false,
  onCancel,
  onConfirm,
  children
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  showCancel?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
  wide?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-white/15 bg-[#202329] shadow-2xl`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled && !busy) void onConfirm();
        }}
      >
        <div className="flex items-start gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="app-dialog-title" className="text-base font-semibold text-zinc-100">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
          </div>
          <button type="button" aria-label="Close dialog" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={busy} onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          {secondaryLabel && onSecondary && (
            <button type="button" className="h-9 rounded-md bg-red-500/15 px-4 text-xs font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-40" disabled={busy} onClick={() => void onSecondary()}>
              {secondaryLabel}
            </button>
          )}
          {showCancel && (
            <button type="button" className="h-9 rounded-md px-4 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="h-9 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40" disabled={confirmDisabled || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
