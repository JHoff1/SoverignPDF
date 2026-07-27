import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export function PageThumbnail({
  page,
  selected,
  reorderEnabled,
  onClick,
  onMove
}: {
  page: PDFPageProxy;
  selected: boolean;
  reorderEnabled: boolean;
  onClick: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [renderActive, setRenderActive] = useState(false);
  const [rendered, setRendered] = useState(false);
  const viewport = useMemo(() => {
    const raw = page.getViewport({ scale: 1 });
    return page.getViewport({ scale: 112 / raw.width });
  }, [page]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRenderActive(entry.isIntersecting),
      { rootMargin: "500px 0px" }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !renderActive) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    setRendered(false);
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvasContext: context, viewport });
    void task.promise
      .then(() => setRendered(true))
      .catch(() => {
        // Rendering cancellation is expected as thumbnails leave the viewport.
      });
    return () => task.cancel();
  }, [page, renderActive, viewport]);

  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      draggable={reorderEnabled}
      onDragStart={(event) => event.dataTransfer.setData("text/page", String(page.pageNumber))}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!reorderEnabled) return;
        const from = Number(event.dataTransfer.getData("text/page"));
        if (from) onMove(from, page.pageNumber);
      }}
      className={`group w-full rounded-lg border p-2 transition ${
        selected
          ? "border-accent bg-accent/10"
          : "border-transparent hover:border-zinc-600 hover:bg-white/5"
      }`}
    >
      <div
        className="relative mx-auto"
        style={{
          width: `${Math.ceil(viewport.width)}px`,
          height: `${Math.ceil(viewport.height)}px`
        }}
      >
        <canvas
          ref={ref}
          className="block bg-white shadow-md"
          style={{
            width: `${Math.ceil(viewport.width)}px`,
            height: `${Math.ceil(viewport.height)}px`
          }}
        />
        {!rendered && (
          <div className="absolute inset-0 flex animate-pulse items-center justify-center bg-zinc-200 text-zinc-400">
            <LoaderCircle size={14} className={renderActive ? "animate-spin" : ""} />
          </div>
        )}
      </div>
      <span className="mt-2 block text-center text-xs text-zinc-400">
        {page.pageNumber}
      </span>
    </button>
  );
}
