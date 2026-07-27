import type { RefObject } from "react";
import { ChevronDown, ChevronUp, ScanText, Search, X } from "lucide-react";

export function SearchPanel({
  inputRef,
  query,
  resultCount,
  resultIndex,
  ocrRunning,
  extractedPageCount,
  pageCount,
  onQueryChange,
  onMove,
  onClose
}: {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  resultCount: number;
  resultIndex: number;
  ocrRunning: boolean;
  extractedPageCount: number;
  pageCount: number;
  onQueryChange: (value: string) => void;
  onMove: (direction: -1 | 1) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-end gap-1.5 border-b border-white/10 bg-[#202329] px-3 shadow-md">
      <Search size={15} className="text-zinc-500" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Find in document"
        placeholder="Find in document"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onMove(event.shiftKey ? -1 : 1);
          if (event.key === "Escape") onClose();
        }}
        className="h-8 w-64 rounded-md border border-white/10 bg-[#17191e] px-2.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/60"
      />
      <span className="min-w-16 text-center text-[11px] text-zinc-500">
        {query.trim()
          ? resultCount
            ? `${resultIndex + 1} of ${resultCount}`
            : ocrRunning
              ? "OCR…"
              : "No results"
          : `${extractedPageCount}/${pageCount} pages`}
      </span>
      <button className="toolbar-tooltip flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30" disabled={!resultCount} onClick={() => onMove(-1)} data-tooltip="Go to the previous search result (Shift+Enter)">
        <ChevronUp size={16} />
      </button>
      <button className="toolbar-tooltip flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30" disabled={!resultCount} onClick={() => onMove(1)} data-tooltip="Go to the next search result (Enter)">
        <ChevronDown size={16} />
      </button>
      <button className="toolbar-tooltip flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white" onClick={onClose} data-tooltip="Close document search">
        <X size={16} />
      </button>
    </div>
  );
}

export function OcrStatus({
  running,
  status,
  progress,
  onCancel,
  onDismiss
}: {
  running: boolean;
  status: string;
  progress: number;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (!running && !status) return null;
  return (
    <div role="status" aria-label="Background OCR status" className="relative flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b border-emerald-500/10 bg-emerald-950/20 px-3">
      <ScanText size={14} className="shrink-0 text-emerald-400" />
      <span className="truncate text-[11px] text-emerald-200/80">{status}</span>
      <button className="toolbar-tooltip ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-300/60 hover:bg-white/10 hover:text-emerald-200" onClick={running ? onCancel : onDismiss} data-tooltip={running ? "Cancel background OCR" : "Dismiss OCR status"}>
        <X size={14} />
      </button>
      <div className="absolute bottom-0 left-0 h-0.5 bg-emerald-400 transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
  );
}
