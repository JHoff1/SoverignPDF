import { Trash2 } from "lucide-react";
import type { Annotation, TextStyle } from "../editor/useDocumentEditor";

export function SelectedAnnotationToolbar({
  annotation,
  onUpdate,
  onRemove
}: {
  annotation: Annotation;
  onUpdate: (id: string, updates: Partial<Annotation>, label?: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <aside
      role="region"
      aria-label={`Edit selected ${annotation.kind} annotation`}
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-panel px-4 py-4"
    >
      <div className="mb-4 border-b border-white/10 pb-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-300">
          Properties
        </span>
        <h2 className="mt-1 text-sm font-semibold capitalize text-zinc-100">
          {annotation.kind} annotation
        </h2>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          Changes apply to the currently selected annotation.
        </p>
      </div>

      {annotation.kind === "text" && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">
              Content
            </span>
            <input
              key={`${annotation.id}-${annotation.text}`}
              aria-label="Selected text content"
              defaultValue={annotation.text}
              className="h-9 w-full rounded-md border border-white/15 bg-black/20 px-2.5 text-xs text-zinc-100 outline-none transition focus:border-orange-500"
              onBlur={(event) => {
                const text = event.currentTarget.value.trim();
                if (text && text !== annotation.text) {
                  onUpdate(annotation.id, { text }, "Edit text");
                }
              }}
            />
          </label>
          <div className="grid grid-cols-[1fr_4.5rem] gap-2">
            <label>
              <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">
                Font
              </span>
              <select
                aria-label="Selected text font"
                value={annotation.fontFamily}
                onChange={(event) => onUpdate(annotation.id, {
                  fontFamily: event.target.value as TextStyle["fontFamily"]
                }, "Change text font")}
                className="h-9 w-full rounded-md border border-white/15 bg-black/20 px-2 text-xs text-zinc-200"
              >
                <option value="helvetica">Arial</option>
                <option value="times">Times</option>
                <option value="courier">Courier</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">
                Size
              </span>
              <input
                aria-label="Selected text size"
                type="number"
                min="6"
                max="96"
                value={annotation.size}
                onChange={(event) => onUpdate(annotation.id, {
                  size: Math.min(96, Math.max(6, Number(event.target.value) || 6))
                }, "Change text size")}
                className="h-9 w-full rounded-md border border-white/15 bg-black/20 px-2 text-xs text-zinc-200"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Toggle bold"
              aria-pressed={annotation.bold}
              className={`h-8 w-8 rounded text-xs font-bold transition ${
                annotation.bold
                  ? "bg-orange-500/25 text-orange-200"
                  : "text-zinc-300 hover:bg-white/10"
              }`}
              onClick={() => onUpdate(annotation.id, { bold: !annotation.bold }, "Toggle bold")}
            >
              B
            </button>
            <button
              type="button"
              aria-label="Toggle italic"
              aria-pressed={annotation.italic}
              className={`h-8 w-8 rounded text-xs italic transition ${
                annotation.italic
                  ? "bg-orange-500/25 text-orange-200"
                  : "text-zinc-300 hover:bg-white/10"
              }`}
              onClick={() => onUpdate(annotation.id, { italic: !annotation.italic }, "Toggle italic")}
            >
              I
            </button>
            <label className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
              Color
              <input
                aria-label="Selected annotation color"
                type="color"
                value={annotation.color}
                onChange={(event) => onUpdate(annotation.id, {
                  color: event.target.value
                }, "Recolor text")}
                className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent"
              />
            </label>
          </div>
        </div>
      )}

      {(annotation.kind === "pen" || annotation.kind === "highlight") && (
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 text-[11px] text-zinc-400">
            Color
            <input
              aria-label="Selected annotation color"
              type="color"
              value={annotation.color}
              onChange={(event) => onUpdate(annotation.id, {
                color: event.target.value
              }, `Recolor ${annotation.kind}`)}
              className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <label className="block">
            <span className="mb-2 flex justify-between text-[11px] text-zinc-400">
              Stroke width
              <span>{annotation.width}px</span>
            </span>
            <input
              aria-label="Selected stroke width"
              type="range"
              min="1"
              max={annotation.kind === "highlight" ? "60" : "20"}
              value={annotation.width}
              onChange={(event) => onUpdate(annotation.id, {
                width: Number(event.target.value)
              }, "Change stroke width")}
              className="w-full accent-orange-500"
            />
          </label>
          {annotation.kind === "highlight" && (
            <label className="block">
              <span className="mb-2 flex justify-between text-[11px] text-zinc-400">
                Opacity
                <span>{Math.round(annotation.opacity * 100)}%</span>
              </span>
              <input
                aria-label="Selected highlight opacity"
                type="range"
                min="10"
                max="80"
                value={Math.round(annotation.opacity * 100)}
                onChange={(event) => onUpdate(annotation.id, {
                  opacity: Number(event.target.value) / 100
                }, "Change highlight opacity")}
                className="w-full accent-yellow-400"
              />
            </label>
          )}
        </div>
      )}

      {annotation.kind === "redaction" && (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-[11px] leading-5 text-red-100/80">
          Secure redactions are permanently applied by rasterizing affected pages during export.
        </div>
      )}

      {annotation.kind === "image" && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] leading-5 text-zinc-400">
          Drag the image to move it. Use its lower-right handle to resize it while preserving its aspect ratio.
        </div>
      )}

      <button
        type="button"
        aria-label={`Delete selected ${annotation.kind}`}
        className="mt-auto flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-500/10 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
        onClick={() => onRemove(annotation.id)}
      >
        <Trash2 size={15} />
        Delete annotation
      </button>
    </aside>
  );
}
