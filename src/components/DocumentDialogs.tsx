import type { RecoverySnapshot } from "../recoveryStore";
import { AppDialog } from "./AppDialog";

export function PasswordDialog({
  value,
  incorrect,
  onChange,
  onCancel,
  onConfirm
}: {
  value: string;
  incorrect: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AppDialog title="Password required" description={incorrect ? "That password was not accepted. Check it and try again." : "This PDF is encrypted. Enter its password to open it locally."} confirmLabel="Unlock PDF" confirmDisabled={!value} onCancel={onCancel} onConfirm={onConfirm}>
      <label className="block text-xs font-medium text-zinc-300" htmlFor="pdf-password">PDF password</label>
      <input id="pdf-password" autoFocus type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={incorrect} className={`mt-2 h-10 w-full rounded-md border bg-[#15171b] px-3 text-sm text-zinc-100 outline-none ${incorrect ? "border-red-500/80" : "border-white/15 focus:border-orange-500/70"}`} />
      <p className="mt-2 text-[11px] leading-5 text-zinc-500">The password remains only in memory for this window. It is never saved, logged, or transmitted.</p>
    </AppDialog>
  );
}

export function RecoveryDialog({
  snapshot,
  busy,
  onRecover,
  onDiscard,
  onCancel
}: {
  snapshot: RecoverySnapshot;
  busy: boolean;
  onRecover: () => void;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <AppDialog title="Recover unsaved work?" description={`VerityPDF found a local recovery snapshot from ${new Date(snapshot.updatedAt).toLocaleString()}.`} confirmLabel="Recover" secondaryLabel="Discard snapshot" busy={busy} onSecondary={onDiscard} onCancel={onCancel} onConfirm={onRecover}>
      <p className="text-xs leading-5 text-zinc-300">Recover changes to <strong>{snapshot.fileName}</strong>. The snapshot is stored only on this device.</p>
    </AppDialog>
  );
}

export function UnsavedCloseDialog({
  busy,
  onSave,
  onDiscard,
  onCancel
}: {
  busy: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <AppDialog title="Save changes before closing?" description="This window contains changes that have not been saved." confirmLabel="Save and close" secondaryLabel="Discard and close" busy={busy} onSecondary={onDiscard} onCancel={onCancel} onConfirm={onSave}>
      <p className="text-xs leading-5 text-zinc-300">Cancel keeps this window open. Discard removes its local recovery snapshot.</p>
    </AppDialog>
  );
}

export function OverwriteDialog({
  fileName,
  automaticBackups,
  busy,
  onCancel,
  onConfirm
}: {
  fileName: string;
  automaticBackups: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AppDialog title="Overwrite current PDF?" description={`Save changes directly to ${fileName}?`} confirmLabel="Overwrite PDF" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <p className="text-xs leading-5 text-zinc-300">{automaticBackups ? "The existing file will be preserved first as a timestamped backup in the same folder." : "The existing file will be replaced. Automatic backups are currently disabled."}</p>
    </AppDialog>
  );
}

export function SaveNameDialog({
  mode,
  saveAs = false,
  desktop,
  value,
  busy,
  hasBytes = true,
  onChange,
  onCancel,
  onConfirm
}: {
  mode: "save" | "split";
  saveAs?: boolean;
  desktop: boolean;
  value: string;
  busy: boolean;
  hasBytes?: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const split = mode === "split";
  return (
    <AppDialog
      title={split ? "Save Extracted PDF" : saveAs ? "Save PDF As" : "Save PDF"}
      description={split
        ? desktop
          ? "Name the new document, then choose where to save it. Your original PDF will remain unchanged."
          : "Name the extracted document before downloading it. Your original PDF will remain unchanged."
        : desktop
          ? "Choose the file name here. You will choose its local folder in the system picker next."
          : "Choose the file name for the PDF downloaded to this device."}
      confirmLabel={split ? desktop ? "Choose Location" : "Download PDF" : "Continue"}
      confirmDisabled={!value.trim() || !hasBytes}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <label className="block text-xs font-medium text-zinc-300" htmlFor={`${mode}-file-name`}>File name</label>
      <input id={`${mode}-file-name`} autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={split ? "document-extract.pdf" : "document.pdf"} className="mt-2 h-10 w-full rounded-md border border-white/15 bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/70" />
      <p className="mt-2 text-[11px] text-zinc-500">A .pdf extension will be added automatically when omitted.</p>
    </AppDialog>
  );
}

export function SplitRangeDialog({
  pageCount,
  value,
  error,
  busy,
  onChange,
  onCancel,
  onConfirm
}: {
  pageCount: number;
  value: string;
  error: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AppDialog title="Split or Extract Pages" description={`Choose the pages to export into a new PDF. This document contains ${pageCount} pages.`} confirmLabel="Export Pages" confirmDisabled={!value.trim()} busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <label className="block text-xs font-medium text-zinc-300" htmlFor="split-page-ranges">Pages or ranges</label>
      <input id="split-page-ranges" autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder="1-3, 5, 8-10" aria-invalid={Boolean(error)} aria-describedby={error ? "split-range-error" : "split-range-help"} className={`mt-2 h-10 w-full rounded-md border bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 ${error ? "border-red-500/80 focus:border-red-400" : "border-white/15 focus:border-orange-500/70"}`} />
      {error ? <p id="split-range-error" className="mt-2 text-xs text-red-300">{error}</p> : <p id="split-range-help" className="mt-2 text-[11px] text-zinc-500">Separate pages and ranges with commas—for example, 1-3, 5.</p>}
    </AppDialog>
  );
}
