import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppDialog } from "./AppDialog";

const SHORTCUTS = [
  ["File", "Open PDF", "Ctrl/⌘ O"],
  ["File", "Save", "Ctrl/⌘ S"],
  ["File", "Save As", "Ctrl/⌘ Shift S"],
  ["File", "Print", "Ctrl/⌘ P"],
  ["Navigation", "Find in document", "Ctrl/⌘ F"],
  ["History", "Undo", "Ctrl/⌘ Z"],
  ["History", "Redo", "Ctrl/⌘ Shift Z"],
  ["Editing", "Delete selected annotation or page", "Delete"],
  ["Editing", "Move selected annotation", "Arrow keys"],
  ["Editing", "Move selected annotation farther", "Shift + Arrow keys"],
  ["View", "Fit entire page", "Ctrl/⌘ 0"],
  ["View", "Actual size (100%)", "Ctrl/⌘ 1"],
  ["View", "Zoom", "Ctrl/⌘ + scroll"],
  ["General", "Cancel tool, menu, dialog, or selection", "Escape"],
  ["General", "Show keyboard shortcuts", "Ctrl/⌘ /"]
] as const;

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const visibleShortcuts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return SHORTCUTS;
    return SHORTCUTS.filter((shortcut) =>
      shortcut.some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [query]);

  return (
    <AppDialog
      title="Keyboard shortcuts"
      description="Search the commands available throughout SovereignPDF."
      confirmLabel="Done"
      onCancel={onClose}
      onConfirm={onClose}
      wide
    >
      <label className="relative block">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          autoFocus
          aria-label="Search keyboard shortcuts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands or keys"
          className="h-10 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-sm text-zinc-100 outline-none transition focus:border-orange-500"
        />
      </label>
      <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-lg border border-white/10">
        {visibleShortcuts.map(([group, command, keys]) => (
          <div
            key={`${group}-${command}`}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-3 py-2.5 text-xs last:border-0"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {group}
            </span>
            <span className="text-zinc-200">{command}</span>
            <kbd className="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] text-zinc-300">
              {keys}
            </kbd>
          </div>
        ))}
        {!visibleShortcuts.length && (
          <p className="px-3 py-8 text-center text-xs text-zinc-500">
            No shortcuts match “{query}”.
          </p>
        )}
      </div>
    </AppDialog>
  );
}
