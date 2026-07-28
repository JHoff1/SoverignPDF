import { FileClock, X } from "lucide-react";
import type { RecoverySnapshot } from "../recoveryStore";

export function RecoveryAvailableNotice({
  snapshot,
  busy,
  onOpen,
  onDiscard,
  onDismiss
}: {
  snapshot: RecoverySnapshot;
  busy: boolean;
  onOpen: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-label="Recovered work available"
      className="fixed bottom-5 right-5 z-[210] w-[min(440px,calc(100vw-40px))] rounded-xl border border-amber-400/30 bg-[#2a2112] p-4 text-amber-50 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <FileClock size={20} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Unsaved work was recovered</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/75">
            A local snapshot of <strong>{snapshot.fileName}</strong> is available.
            The PDF you opened will remain in this window.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss recovered work notice"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-100/60 hover:bg-white/10 hover:text-white"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md px-3 py-2 text-xs font-medium text-amber-100/75 hover:bg-white/10 disabled:opacity-50"
          onClick={() => void onDiscard()}
        >
          Discard recovery
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
          onClick={() => void onOpen()}
        >
          {busy ? "Opening…" : "Open in new window"}
        </button>
      </div>
    </div>
  );
}
