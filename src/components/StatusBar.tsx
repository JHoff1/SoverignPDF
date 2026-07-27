import {
  CheckCircle2,
  CircleDot,
  FileText,
  LoaderCircle,
  Maximize2,
  ScanText
} from "lucide-react";

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
  activity
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
}) {
  const dimensions = width && height
    ? `${Math.round(width)} × ${Math.round(height)} pt`
    : "No page selected";

  return (
    <footer
      aria-label="Document status"
      className="status-bar flex h-7 shrink-0 items-center gap-3 border-t border-white/10 bg-panel px-3 text-[10px] text-zinc-400"
    >
      <span className="flex items-center gap-1.5 font-medium text-zinc-300">
        <FileText size={12} />
        {selectedPageCount > 1
          ? `${selectedPageCount} pages selected`
          : pageCount
            ? `Page ${currentPage} of ${pageCount}`
            : "No document"}
      </span>
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
    </footer>
  );
}
