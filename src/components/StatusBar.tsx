import {
  CircleAlert,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FileText,
  Download,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  ScanText,
  X
} from "lucide-react";
import { version } from "../../package.json";
import type { UpdateCheckStatus } from "../lib/updateCheck";

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
  onCancelActivity,
  onPreviousPage,
  onNextPage,
  updateStatus,
  latestVersion,
  onCheckForUpdates,
  onOpenLatestRelease
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
  onCancelActivity?: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  updateStatus: UpdateCheckStatus;
  latestVersion: string | null;
  onCheckForUpdates: () => void;
  onOpenLatestRelease: () => void;
}) {
  const dimensions = width && height
    ? `${Math.round(width)} × ${Math.round(height)} pt`
    : "No page selected";
  const updatePresentation = {
    idle: {
      label: "Check for updates",
      ariaLabel: "Check for updates on GitHub",
      className: "text-zinc-400 hover:text-zinc-100",
      icon: <RefreshCw size={12} aria-hidden="true" />
    },
    checking: {
      label: "Checking…",
      ariaLabel: "Checking GitHub for updates",
      className: "text-zinc-300",
      icon: <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
    },
    current: {
      label: "Up to date",
      ariaLabel: "VerityPDF is up to date; check again",
      className: "text-emerald-300 hover:text-emerald-200",
      icon: <CheckCircle2 size={12} aria-hidden="true" />
    },
    available: {
      label: "New version available",
      ariaLabel: `New version available${latestVersion ? `: ${latestVersion}` : ""}; open GitHub release`,
      className: "text-orange-300 hover:text-orange-200",
      icon: <Download size={12} aria-hidden="true" />
    },
    unavailable: {
      label: "Unable to check",
      ariaLabel: "Unable to check for updates; try again",
      className: "text-rose-300 hover:text-rose-200",
      icon: <CircleAlert size={12} aria-hidden="true" />
    }
  }[updateStatus];

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
            {onCancelActivity && (
              <button
                type="button"
                aria-label="Cancel background OCR"
                className="toolbar-tooltip flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
                data-tooltip="Cancel background OCR"
                data-tooltip-align="end"
                onClick={onCancelActivity}
              >
                <X size={13} />
              </button>
            )}
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
      <div className="flex shrink-0 items-center border-l border-white/10 pl-2">
        <button
          type="button"
          aria-label={updatePresentation.ariaLabel}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 font-medium transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:cursor-wait ${updatePresentation.className}`}
          disabled={updateStatus === "checking"}
          onClick={
            updateStatus === "available"
              ? onOpenLatestRelease
              : onCheckForUpdates
          }
        >
          {updatePresentation.icon}
          <span className="hidden min-[1020px]:inline">
            {updatePresentation.label}
          </span>
        </button>
        <div
          aria-label={`VerityPDF version ${version}`}
          className="ml-1 flex items-center gap-1.5 border-l border-white/10 pl-3 text-zinc-500"
        >
          <img
            src="/app-icon.png"
            alt=""
            aria-hidden="true"
            className="h-5 w-5 rounded-[5px]"
          />
          <span className="hidden font-semibold text-zinc-400 min-[720px]:inline">
            VerityPDF
          </span>
          <span className="text-[10px]">v{version}</span>
        </div>
      </div>
    </footer>
  );
}
