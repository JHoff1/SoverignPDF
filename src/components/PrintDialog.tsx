import { AppDialog } from "./AppDialog";

export function PrintDialog({
  pageCount,
  ranges,
  error,
  busy,
  onRangesChange,
  onCancel,
  onConfirm
}: {
  pageCount: number;
  ranges: string;
  error: string;
  busy: boolean;
  onRangesChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AppDialog
      title="Print PDF"
      description={`Choose which of the ${pageCount} pages to send to the system print dialog.`}
      confirmLabel="Open Print Dialog"
      confirmDisabled={!ranges.trim()}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <label className="block text-xs font-medium text-zinc-300" htmlFor="print-page-ranges">
        Pages or ranges
      </label>
      <input
        id="print-page-ranges"
        autoFocus
        value={ranges}
        onChange={(event) => onRangesChange(event.target.value)}
        placeholder="1-3, 5, 8-10"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "print-range-error" : "print-range-help"}
        className={`mt-2 h-10 w-full rounded-md border bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 ${
          error ? "border-red-500/80 focus:border-red-400" : "border-white/15 focus:border-orange-500/70"
        }`}
      />
      {error ? (
        <p id="print-range-error" className="mt-2 text-xs text-red-300">{error}</p>
      ) : (
        <p id="print-range-help" className="mt-2 text-[11px] text-zinc-500">
          Separate pages and ranges with commas—for example, 1-3, 5.
        </p>
      )}
      <p className="mt-4 text-[11px] leading-5 text-zinc-500">
        Printing is prepared entirely on this device. Your operating system’s print dialog opens after the selected pages are rendered, where you can choose orientation and other printer settings.
      </p>
    </AppDialog>
  );
}
