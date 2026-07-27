import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  GripVertical,
  Trash2
} from "lucide-react";
import { AppDialog } from "./AppDialog";

export type MergeCandidate = {
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  size: number;
  current: boolean;
  previews: string[];
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MergeDialog({
  candidates,
  busy,
  onAdd,
  onMove,
  onRemove,
  onCancel,
  onConfirm
}: {
  candidates: MergeCandidate[];
  busy: boolean;
  onAdd: () => void | Promise<void>;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const totalPages = candidates.reduce(
    (total, candidate) => total + candidate.pageCount,
    0
  );
  const estimatedSize = candidates.reduce(
    (total, candidate) => total + candidate.size,
    0
  );

  return (
    <AppDialog
      title="Merge PDFs"
      description="Review, reorder, and remove local documents before combining them."
      confirmLabel={`Merge ${candidates.length} PDFs`}
      confirmDisabled={candidates.length < 2}
      busy={busy}
      wide
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/15 px-3 py-2.5">
        <div>
          <p className="text-xs font-medium text-zinc-200">
            {totalPages} pages · approximately {formatSize(estimatedSize)}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            Final size may differ after PDF structure is rebuilt.
          </p>
        </div>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-md bg-orange-500/15 px-3 text-[11px] font-semibold text-orange-200 hover:bg-orange-500/25"
          disabled={busy}
          onClick={() => void onAdd()}
        >
          <FilePlus2 size={14} />
          Add PDFs
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {candidates.map((candidate, index) => (
          <article
            key={candidate.id}
            className="rounded-lg border border-white/10 bg-white/[0.025] p-3"
          >
            <div className="flex items-center gap-2">
              <GripVertical size={15} className="shrink-0 text-zinc-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-xs font-semibold text-zinc-200">
                    {candidate.name}
                  </h3>
                  {candidate.current && (
                    <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                      Current document
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {candidate.pageCount} page{candidate.pageCount === 1 ? "" : "s"} · {formatSize(candidate.size)}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Move ${candidate.name} up`}
                className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                disabled={index === 0 || busy}
                onClick={() => onMove(index, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                aria-label={`Move ${candidate.name} down`}
                className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                disabled={index === candidates.length - 1 || busy}
                onClick={() => onMove(index, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${candidate.name}`}
                className="flex h-7 w-7 items-center justify-center rounded text-red-300 hover:bg-red-500/15 disabled:opacity-30"
                disabled={candidate.current || busy}
                onClick={() => onRemove(candidate.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {candidate.previews.map((preview, pageIndex) => (
                <div
                  key={pageIndex}
                  className="relative h-24 w-20 shrink-0 overflow-hidden rounded border border-white/10 bg-zinc-100"
                >
                  <img
                    src={preview}
                    alt={`${candidate.name}, page ${pageIndex + 1}`}
                    className="h-full w-full object-contain"
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[8px] text-white">
                    {pageIndex + 1}
                  </span>
                </div>
              ))}
              {candidate.pageCount > candidate.previews.length && (
                <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded border border-dashed border-white/15 text-[10px] text-zinc-500">
                  +{candidate.pageCount - candidate.previews.length} pages
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </AppDialog>
  );
}
