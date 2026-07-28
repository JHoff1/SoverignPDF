import { Bug, ExternalLink, FileCheck2, Monitor, Moon, Sun, WifiOff } from "lucide-react";
import type { TextStyle } from "../editor/useDocumentEditor";
import type { RecoverySnapshot } from "../recoveryStore";
import type { AppPreferences } from "../preferences";
import { AppDialog } from "./AppDialog";

export type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";

export function PreferencesDialog({
  preferences,
  textStyle,
  desktopPlatform,
  status,
  onPreferencesChange,
  onTextStyleChange,
  onOpenDefaultApps,
  onClearLocalData,
  onChooseSaveFolder,
  recoverySnapshots,
  onRestoreRecovery,
  onDeleteRecovery,
  onReportIssue,
  onClose
}: {
  preferences: AppPreferences;
  textStyle: TextStyle;
  desktopPlatform: DesktopPlatform;
  status: string;
  onPreferencesChange: (preferences: AppPreferences) => void;
  onTextStyleChange: (style: TextStyle) => void;
  onOpenDefaultApps: () => void | Promise<void>;
  onClearLocalData: () => void;
  onChooseSaveFolder: () => void | Promise<void>;
  recoverySnapshots: RecoverySnapshot[];
  onRestoreRecovery: (snapshot: RecoverySnapshot) => void;
  onDeleteRecovery: (snapshot: RecoverySnapshot) => void | Promise<void>;
  onReportIssue: () => void | Promise<void>;
  onClose: () => void;
}) {
  const updatePreferences = (updates: Partial<AppPreferences>) =>
    onPreferencesChange({ ...preferences, ...updates });

  return (
    <AppDialog
      title="Preferences"
      description="Configure appearance, workspace, saving, privacy, and editing defaults."
      confirmLabel="Done"
      showCancel={false}
      wide
      comfortable
      onCancel={onClose}
      onConfirm={onClose}
    >
      <section className="rounded-lg border border-white/10 bg-black/15 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">Appearance</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Follow your operating system automatically or keep a consistent app theme.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([
            ["system", "System", Monitor],
            ["dark", "Dark", Moon],
            ["light", "Light", Sun]
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={preferences.theme === value}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition ${
                preferences.theme === value
                  ? "border-orange-400/50 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
              onClick={() => updatePreferences({ theme: value })}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-zinc-500">
          Sidebar width, annotation-properties width, zoom, and page-fit mode are remembered automatically.
        </p>
        <div className="mt-3 border-t border-white/10 pt-3">
          <PreferenceCheckbox
            label="Restore interrupted sessions"
            description="Reopen your document after a crash, forced shutdown, or other interrupted session. Documents closed normally are not reopened."
            checked={preferences.restoreSession}
            onChange={(restoreSession) => updatePreferences({ restoreSession })}
          />
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
            <FileCheck2 size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100">Default PDF application</h3>
            {desktopPlatform === "windows" && <p className="mt-1 text-xs leading-5 text-zinc-400">SovereignPDF is registered as a PDF editor when installed. Windows requires you to approve the default app in Settings.</p>}
            {desktopPlatform === "macos" && <p className="mt-1 text-xs leading-5 text-zinc-400">In Finder, select a PDF and choose File → Get Info. Under Open with, select SovereignPDF, then choose Change All.</p>}
            {desktopPlatform === "linux" && <p className="mt-1 text-xs leading-5 text-zinc-400">After installing the package, right-click a PDF, choose Properties or Open With, select SovereignPDF, and make it the default.</p>}
            {desktopPlatform === "unknown" && <p className="mt-1 text-xs leading-5 text-zinc-400">Choose SovereignPDF for PDF files in your operating system’s default application settings.</p>}
          </div>
        </div>
        {desktopPlatform === "windows" && (
          <button type="button" className="mt-4 h-9 rounded-md bg-sky-500/15 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-500/25" onClick={() => void onOpenDefaultApps()}>
            Open Windows Default Apps
          </button>
        )}
        {status && <p className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-300">{status}</p>}
      </section>

      <section className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <WifiOff size={18} className="mt-0.5 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-zinc-100">Privacy and local data</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-400">Network access is disabled. Documents, recent file paths, and preferences stay on this computer.</p>
            <p className="mt-2 text-[11px] text-zinc-500">
              {preferences.recentFiles.length
                ? `${preferences.recentFiles.length} recent local file path${preferences.recentFiles.length === 1 ? "" : "s"} remembered.`
                : "No recent file paths are currently remembered."}
            </p>
            <button type="button" className="mt-3 h-9 rounded-md border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20" onClick={onClearLocalData}>
              Clear recent files and settings
            </button>
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-300">
            <Bug size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-zinc-100">Help improve SovereignPDF</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Report a bug or request a feature on GitHub. This opens your system browser only when you choose it; no document information or diagnostics are sent automatically.
            </p>
            <button
              type="button"
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-orange-500/15 px-3 text-xs font-semibold text-orange-100 hover:bg-orange-500/25"
              onClick={() => void onReportIssue()}
            >
              <ExternalLink size={14} />
              Report an issue on GitHub
            </button>
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">Recovery snapshots</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          SovereignPDF keeps up to five local revisions for each document window.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          {recoverySnapshots.length ? recoverySnapshots.map((snapshot) => {
            const stale = Date.now() - snapshot.updatedAt > 7 * 24 * 60 * 60 * 1000;
            return (
              <div
                key={`${snapshot.id}-${snapshot.updatedAt}`}
                className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-zinc-200">
                      {snapshot.fileName}
                    </span>
                    {stale && (
                      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                        Stale
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {new Date(snapshot.updatedAt).toLocaleString()} · {snapshot.annotations.length} annotation{snapshot.annotations.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  className="h-7 rounded-md bg-orange-500/10 px-2 text-[10px] font-semibold text-orange-200 hover:bg-orange-500/20"
                  onClick={() => onRestoreRecovery(snapshot)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="h-7 rounded-md bg-red-500/10 px-2 text-[10px] font-semibold text-red-200 hover:bg-red-500/20"
                  onClick={() => void onDeleteRecovery(snapshot)}
                >
                  Delete
                </button>
              </div>
            );
          }) : (
            <p className="px-3 py-6 text-center text-xs text-zinc-500">
              No unsaved recovery snapshots are stored.
            </p>
          )}
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">Saving</h3>
        <div className="mt-3 space-y-3">
          <PreferenceCheckbox label="Confirm before overwriting" description="Ask before Save replaces the currently opened file." checked={preferences.confirmOverwrite} onChange={(confirmOverwrite) => updatePreferences({ confirmOverwrite })} />
          <PreferenceCheckbox label="Create automatic backup copies" description="Before overwriting, preserve the previous PDF beside it with a timestamped backup name." checked={preferences.automaticBackups} onChange={(automaticBackups) => updatePreferences({ automaticBackups })} />
          <PreferenceCheckbox label="Flatten annotations by default" description="Embed text, pen, highlight, and images as permanent PDF page content. If disabled, current overlay markup is omitted from the saved PDF." checked={preferences.flattenAnnotations} onChange={(flattenAnnotations) => updatePreferences({ flattenAnnotations })} />
          <PreferenceCheckbox label="Show export summary before saving" description="Review annotation flattening, secure redactions, forms, metadata, and estimated output size before writing a PDF." checked={preferences.showExportSummary} onChange={(showExportSummary) => updatePreferences({ showExportSummary })} />
          <div>
            <span className="block text-xs font-medium text-zinc-200">Default Save As folder</span>
            <div className="mt-2 flex gap-2">
              <input aria-label="Default Save As folder" value={preferences.defaultSaveFolder} onChange={(event) => updatePreferences({ defaultSaveFolder: event.target.value })} placeholder="Use the last system folder" className="h-9 min-w-0 flex-1 rounded-md border border-white/15 bg-[#15171b] px-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-orange-500/70" />
              <button type="button" className="h-9 rounded-md bg-white/10 px-3 text-xs font-medium text-zinc-200 hover:bg-white/15" onClick={() => void onChooseSaveFolder()}>Browse</button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">Editing defaults</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-zinc-300">Text</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select aria-label="Default text font" value={textStyle.fontFamily} onChange={(event) => onTextStyleChange({ ...textStyle, fontFamily: event.target.value as TextStyle["fontFamily"] })} className="h-9 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200">
                <option value="helvetica">Arial</option><option value="times">Times</option><option value="courier">Courier</option>
              </select>
              <input aria-label="Default text size" type="number" min="6" max="96" value={textStyle.size} onChange={(event) => onTextStyleChange({ ...textStyle, size: Math.min(96, Math.max(6, Number(event.target.value) || 6)) })} className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200" />
              <input aria-label="Default text color" type="color" value={textStyle.color} onChange={(event) => onTextStyleChange({ ...textStyle, color: event.target.value })} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-300">Pen</p>
            <div className="mt-2 flex items-center gap-2">
              <input aria-label="Default pen color" type="color" value={preferences.penStyle.color} onChange={(event) => updatePreferences({ penStyle: { ...preferences.penStyle, color: event.target.value } })} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
              <label className="text-[11px] text-zinc-500">Width</label>
              <input aria-label="Default pen width" type="number" min="1" max="20" value={preferences.penStyle.width} onChange={(event) => updatePreferences({ penStyle: { ...preferences.penStyle, width: Math.min(20, Math.max(1, Number(event.target.value) || 1)) } })} className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-zinc-300">Highlighter</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input aria-label="Default highlighter color" type="color" value={preferences.highlightStyle.color} onChange={(event) => updatePreferences({ highlightStyle: { ...preferences.highlightStyle, color: event.target.value } })} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
              <label className="text-[11px] text-zinc-500">Width</label>
              <input aria-label="Default highlighter width" type="number" min="4" max="60" value={preferences.highlightStyle.width} onChange={(event) => updatePreferences({ highlightStyle: { ...preferences.highlightStyle, width: Math.min(60, Math.max(4, Number(event.target.value) || 4)) } })} className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200" />
              <label className="text-[11px] text-zinc-500">Opacity</label>
              <input aria-label="Default highlighter opacity" type="range" min="10" max="80" value={Math.round(preferences.highlightStyle.opacity * 100)} onChange={(event) => updatePreferences({ highlightStyle: { ...preferences.highlightStyle, opacity: Number(event.target.value) / 100 } })} className="w-28 accent-yellow-400" />
              <span className="w-9 text-right text-[11px] text-zinc-400">{Math.round(preferences.highlightStyle.opacity * 100)}%</span>
            </div>
          </div>
        </div>
      </section>

      <p className="mt-3 text-[11px] leading-5 text-zinc-500">
        Settings are stored only in this app's local webview storage. File association registration takes effect after installing a newly built package.
      </p>
    </AppDialog>
  );
}

function PreferenceCheckbox({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 accent-orange-500" />
      <span>
        <span className="block text-xs font-medium text-zinc-200">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{description}</span>
      </span>
    </label>
  );
}
