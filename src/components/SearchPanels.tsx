import type { RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

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
