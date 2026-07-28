import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FileText,
  LoaderCircle,
  Maximize2,
  ScanText
} from "lucide-react";
import { version } from "../../package.json";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function StatusBar({
  currentPage,
  pageCount,
  selectedPageCount,
  width,
  height,
  fileSize,
  zoom,
  dirty,
  activity,
  onPreviousPage,
  onNextPage
}: {
  currentPage: number;
  pageCount: number;
  selectedPageCount: number;
  width: number | null;
  height: number | null;
  fileSize: number;
  zoom: number;
  dirty: boolean;
  activity: string;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const dimensions = width && height
    ? `${Math.round(width)} × ${Math.round(height)} pt`
    : "No page selected";

  return (
    <footer
      aria-label="Document status"
      className="status-bar flex h-9 shrink-0 items-center gap-3 border-t border-white/10 bg-panel px-3 text-xs text-zinc-400 shadow-[0_-4px_16px_rgba(0,0,0,0.18)]"
    >
      {pageCount ? (
        <div className="flex h-7 items-center overflow-hidden rounded-md border border-white/10 bg-black/25 text-zinc-200">
          <button
            type="button"
            aria-label="Previous page"
            className="flex h-7 w-8 items-center justify-center border-r border-white/10 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={currentPage <= 1}
            onClick={onPreviousPage}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-24 px-3 text-center font-semibold">
            Page {currentPage} of {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            className="flex h-7 w-8 items-center justify-center border-l border-white/10 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={currentPage >= pageCount}
            onClick={onNextPage}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : (
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <FileText size={13} />
          No document
        </span>
      )}
      {selectedPageCount > 1 && (
        <span className="rounded-md bg-orange-500/10 px-2 py-1 font-medium text-orange-200">
          {selectedPageCount} pages selected
        </span>
      )}
      <span className="hidden h-3 w-px bg-white/10 sm:block" aria-hidden="true" />
      <span className="hidden items-center gap-1.5 sm:flex">
        <Maximize2 size={11} />
        {dimensions}
      </span>
      <span className="hidden md:inline">{formatBytes(fileSize)}</span>
      <span className="hidden md:inline">{Math.round(zoom * 100)}%</span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5">
        {activity ? (
          <>
            {activity.toLowerCase().includes("recovery") ? (
              <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
            ) : activity.toLowerCase().includes("ocr") ? (
              <ScanText size={12} className="shrink-0 text-emerald-400" />
            ) : (
              <LoaderCircle size={12} className="shrink-0 animate-spin text-orange-400" />
            )}
            <span className="max-w-52 truncate text-zinc-300">{activity}</span>
          </>
        ) : dirty ? (
          <>
            <CircleDot size={12} className="text-amber-400" />
            <span className="text-amber-300">Unsaved changes</span>
          </>
        ) : pageCount ? (
          <>
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-emerald-300">Saved</span>
          </>
        ) : null}
      </span>
      <div
        aria-label={`SovereignPDF version ${version}`}
        className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-3 text-zinc-500"
      >
        <img
          src="/app-icon.png"
          alt=""
          aria-hidden="true"
          className="h-5 w-5 rounded-[5px]"
        />
        <span className="hidden font-semibold text-zinc-400 min-[720px]:inline">
          SovereignPDF
        </span>
        <span className="text-[10px]">v{version}</span>
      </div>
    </footer>
  );
}
