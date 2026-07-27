import { AppDialog } from "./AppDialog";
import type { PrintOrientation } from "../printDocument";

export function PrintDialog({
  pageCount,
  ranges,
  error,
  orientation,
  busy,
  onRangesChange,
  onOrientationChange,
  onCancel,
  onConfirm
}: {
  pageCount: number;
  ranges: string;
  error: string;
  orientation: PrintOrientation;
  busy: boolean;
  onRangesChange: (value: string) => void;
  onOrientationChange: (value: PrintOrientation) => void;
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
      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-zinc-300">Orientation</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["portrait", "landscape"] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 text-xs capitalize ${
              orientation === value
                ? "border-orange-400/60 bg-orange-500/10 text-orange-100"
                : "border-white/10 bg-black/15 text-zinc-300"
            }`}>
              <input type="radio" name="print-orientation" value={value} checked={orientation === value} onChange={() => onOrientationChange(value)} className="accent-orange-500" />
              {value}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-[11px] leading-5 text-zinc-500">
        Printing is prepared entirely on this device. Your operating system’s print dialog opens after the selected pages are rendered.
      </p>
    </AppDialog>
  );
}
