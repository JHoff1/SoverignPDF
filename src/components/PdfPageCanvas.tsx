import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { LoaderCircle, X } from "lucide-react";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  Annotation,
  Point,
  TextStyle
} from "../editor/useDocumentEditor";
import type {
  SearchMatch,
  StrokeStyle,
  Tool
} from "../editorUiTypes";
import { clonePlain, createLocalId } from "../localUtils";
import {
  cachePageRender,
  getCachedPageRender,
  pageRenderCacheKey
} from "../pageRenderCache";

type ImageAnnotation = Extract<Annotation, { kind: "image" }>;
type ImageBox = Pick<ImageAnnotation, "id" | "x" | "y" | "width" | "height">;
type AnnotationBox = ImageBox;

function cssFontFamily(font: TextStyle["fontFamily"]) {
  if (font === "times") return "Times New Roman, Times, serif";
  if (font === "courier") return "Courier New, Courier, monospace";
  return "Arial, Helvetica, sans-serif";
}

export function PdfPageCanvas({
  page,
  scale,
  onVisible,
  annotations,
  activeTool,
  onAddAnnotation,
  onTextFinished,
  textStyle,
  penStyle,
  highlightStyle,
  searchMatches,
  activeSearchMatchId,
  selectedAnnotationId,
  onSelectAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation,
  onRenderingChange,
  pageId
}: {
  page: PDFPageProxy;
  scale: number;
  onVisible: (page: number) => void;
  annotations: Annotation[];
  activeTool: Tool;
  onAddAnnotation: (annotation: Annotation) => void;
  onTextFinished: (id: string | null) => void;
  textStyle: TextStyle;
  penStyle: StrokeStyle;
  highlightStyle: StrokeStyle;
  searchMatches: SearchMatch[];
  activeSearchMatchId: string | null;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>, label?: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onRenderingChange?: (page: number, rendering: boolean) => void;
  pageId?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const viewport = useMemo(() => page.getViewport({ scale }), [page, scale]);
  const [renderActive, setRenderActive] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [draft, setDraft] = useState<Point[]>([]);
  const [editingText, setEditingText] = useState<(Point & { value: string }) | null>(null);
  const [imageDraft, setImageDraft] = useState<ImageBox | null>(null);
  const imageDraftRef = useRef<ImageBox | null>(null);
  const imageGesture = useRef<{
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    start: ImageBox;
  } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<Annotation | null>(null);
  const annotationDraftRef = useRef<Annotation | null>(null);
  const annotationGesture = useRef<{
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    start: Annotation;
    bounds: AnnotationBox;
  } | null>(null);

  const boundsForAnnotation = useCallback((annotation: Annotation): AnnotationBox => {
    if (annotation.kind === "image" || annotation.kind === "redaction") {
      return {
        id: annotation.id,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height
      };
    }
    if (annotation.kind === "text") {
      textMeasureCanvasRef.current ??= window.document.createElement("canvas");
      const context = textMeasureCanvasRef.current.getContext("2d");
      const renderedFontSize = annotation.size * scale;
      if (context) {
        context.font = [
          annotation.italic ? "italic" : "",
          annotation.bold ? "700" : "400",
          `${renderedFontSize}px`,
          cssFontFamily(annotation.fontFamily)
        ].filter(Boolean).join(" ");
      }
      const measuredWidth = Math.max(
        ...annotation.text.split("\n").map((line) =>
          context?.measureText(line || " ").width
          ?? line.length * renderedFontSize * 0.56
        )
      );
      const lineCount = Math.max(1, annotation.text.split("\n").length);
      const selectionPadding = 10;
      const x = Math.max(0, annotation.x - selectionPadding / viewport.width);
      const y = Math.max(0, annotation.y - selectionPadding / viewport.height);
      const right = Math.min(
        1,
        annotation.x + measuredWidth / viewport.width
          + selectionPadding / viewport.width
      );
      const bottom = Math.min(
        1,
        annotation.y + renderedFontSize * lineCount / viewport.height
          + selectionPadding / viewport.height
      );
      return {
        id: annotation.id,
        x,
        y,
        width: Math.max(0.035, right - x),
        height: Math.max(0.018, bottom - y)
      };
    }
    const xs = annotation.points.map((point) => point.x);
    const ys = annotation.points.map((point) => point.y);
    const padding = Math.max(0.006, annotation.width / 1200);
    const x = Math.max(0, Math.min(...xs) - padding);
    const y = Math.max(0, Math.min(...ys) - padding);
    return {
      id: annotation.id,
      x,
      y,
      width: Math.min(1 - x, Math.max(0.025, Math.max(...xs) - Math.min(...xs) + padding * 2)),
      height: Math.min(1 - y, Math.max(0.025, Math.max(...ys) - Math.min(...ys) + padding * 2))
    };
  }, [scale, viewport.height, viewport.width]);

  const beginAnnotationGesture = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    annotation: Annotation,
    mode: "move" | "resize"
  ) => {
    if (annotation.kind === "image") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    annotationGesture.current = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: clonePlain(annotation),
      bounds: boundsForAnnotation(annotation)
    };
    annotationDraftRef.current = clonePlain(annotation);
    setAnnotationDraft(clonePlain(annotation));
    onSelectAnnotation(annotation.id);
  }, [boundsForAnnotation, onSelectAnnotation]);

  const moveAnnotationGesture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = annotationGesture.current;
    const host = hostRef.current;
    if (!gesture || !host) return;
    const hostBounds = host.getBoundingClientRect();
    const dx = (event.clientX - gesture.startClientX) / hostBounds.width;
    const dy = (event.clientY - gesture.startClientY) / hostBounds.height;
    const start = gesture.start;
    let next: Annotation = start;
    if (gesture.mode === "move") {
      const constrainedX = Math.min(1 - gesture.bounds.width, Math.max(0, gesture.bounds.x + dx));
      const constrainedY = Math.min(1 - gesture.bounds.height, Math.max(0, gesture.bounds.y + dy));
      const offsetX = constrainedX - gesture.bounds.x;
      const offsetY = constrainedY - gesture.bounds.y;
      if (start.kind === "text" || start.kind === "redaction") {
        next = { ...start, x: start.x + offsetX, y: start.y + offsetY };
      } else if (start.kind === "pen" || start.kind === "highlight") {
        next = {
          ...start,
          points: start.points.map((point) => ({
            x: point.x + offsetX,
            y: point.y + offsetY
          }))
        };
      }
    } else {
      const width = Math.min(1 - gesture.bounds.x, Math.max(0.025, gesture.bounds.width + dx));
      const height = Math.min(1 - gesture.bounds.y, Math.max(0.025, gesture.bounds.height + dy));
      if (start.kind === "redaction") {
        next = { ...start, width, height };
      } else if (start.kind === "text") {
        next = {
          ...start,
          size: Math.min(96, Math.max(6, Math.round(start.size * width / gesture.bounds.width)))
        };
      } else if (start.kind === "pen" || start.kind === "highlight") {
        next = {
          ...start,
          points: start.points.map((point) => ({
            x: gesture.bounds.x + (point.x - gesture.bounds.x) * width / gesture.bounds.width,
            y: gesture.bounds.y + (point.y - gesture.bounds.y) * height / gesture.bounds.height
          }))
        };
      }
    }
    annotationDraftRef.current = next;
    setAnnotationDraft(next);
  }, []);

  const finishAnnotationGesture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = annotationGesture.current;
    if (!gesture) return;
    event.stopPropagation();
    const next = annotationDraftRef.current;
    annotationGesture.current = null;
    annotationDraftRef.current = null;
    setAnnotationDraft(null);
    if (next) {
      const { id: _id, kind: _kind, page: _page, ...updates } = next;
      onUpdateAnnotation(
        next.id,
        updates as Partial<Annotation>,
        gesture.mode === "move" ? `Move ${next.kind}` : `Resize ${next.kind}`
      );
    }
  }, [onUpdateAnnotation]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRenderActive(entry.isIntersecting),
      { rootMargin: "1200px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editingText) return;
    const timeout = window.setTimeout(() => {
      textInputRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [editingText?.x, editingText?.y]);

  const finishText = useCallback((value: string) => {
    if (!editingText) return;
    const text = value.trim();
    if (text) {
      const id = createLocalId();
      textMeasureCanvasRef.current ??= window.document.createElement("canvas");
      const context = textMeasureCanvasRef.current.getContext("2d");
      const renderedFontSize = textStyle.size * scale;
      if (context) {
        context.font = [
          textStyle.italic ? "italic" : "",
          textStyle.bold ? "700" : "400",
          `${renderedFontSize}px`,
          cssFontFamily(textStyle.fontFamily)
        ].filter(Boolean).join(" ");
      }
      const renderedWidth = Math.max(
        ...text.split("\n").map((line) =>
          context?.measureText(line || " ").width
          ?? line.length * renderedFontSize * 0.56
        )
      );
      const lineCount = Math.max(1, text.split("\n").length);
      const edgePadding = 4;
      onAddAnnotation({
        id,
        kind: "text",
        page: page.pageNumber,
        x: Math.min(
          editingText.x,
          Math.max(0, 1 - (renderedWidth + edgePadding) / viewport.width)
        ),
        y: Math.min(
          editingText.y,
          Math.max(
            0,
            1 - (renderedFontSize * lineCount + edgePadding) / viewport.height
          )
        ),
        text,
        ...textStyle
      });
      onSelectAnnotation(id);
      onTextFinished(id);
    } else {
      onTextFinished(null);
    }
    setEditingText(null);
  }, [
    editingText,
    onAddAnnotation,
    onSelectAnnotation,
    onTextFinished,
    page.pageNumber,
    scale,
    textStyle,
    viewport.height,
    viewport.width
  ]);

  const beginImageGesture = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    annotation: ImageAnnotation,
    mode: "move" | "resize"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = {
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height
    };
    imageGesture.current = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start
    };
    imageDraftRef.current = start;
    setImageDraft(start);
    onSelectAnnotation(annotation.id);
  }, [onSelectAnnotation]);

  const moveImageGesture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = imageGesture.current;
    const host = hostRef.current;
    if (!gesture || !host) return;
    const bounds = host.getBoundingClientRect();
    const deltaX = (event.clientX - gesture.startClientX) / bounds.width;
    const deltaY = (event.clientY - gesture.startClientY) / bounds.height;
    let next: ImageBox;
    if (gesture.mode === "move") {
      next = {
        ...gesture.start,
        x: Math.min(1 - gesture.start.width, Math.max(0, gesture.start.x + deltaX)),
        y: Math.min(1 - gesture.start.height, Math.max(0, gesture.start.y + deltaY))
      };
    } else {
      const aspectRatio = gesture.start.width / Math.max(gesture.start.height, 0.001);
      const width = Math.min(
        1 - gesture.start.x,
        Math.max(0.04, gesture.start.width + deltaX)
      );
      const height = Math.min(1 - gesture.start.y, Math.max(0.03, width / aspectRatio));
      next = { ...gesture.start, width, height };
    }
    imageDraftRef.current = next;
    setImageDraft(next);
  }, []);

  const finishImageGesture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!imageGesture.current) return;
    event.stopPropagation();
    const next = imageDraftRef.current;
    const mode = imageGesture.current.mode;
    imageGesture.current = null;
    imageDraftRef.current = null;
    setImageDraft(null);
    if (next) {
      onUpdateAnnotation(
        next.id,
        { x: next.x, y: next.y, width: next.width, height: next.height },
        mode === "move" ? "Move image" : "Resize image"
      );
    }
  }, [onUpdateAnnotation]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && onVisible(page.pageNumber),
      { threshold: 0.55 }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [onVisible, page.pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderActive) return;
    // Preserve the previous bitmap while a sharper zoom level is rendered.
    setRendered(Boolean(canvas.width && canvas.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cacheKey = pageRenderCacheKey(page, viewport.width, viewport.height, ratio);
    const cached = getCachedPageRender(cacheKey);
    if (cached) {
      canvas.width = cached.width;
      canvas.height = cached.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.getContext("2d", { alpha: false })?.drawImage(cached, 0, 0);
      setRendered(true);
      onRenderingChange?.(page.pageNumber, false);
      return;
    }
    onRenderingChange?.(page.pageNumber, true);
    const nextCanvas = window.document.createElement("canvas");
    nextCanvas.width = Math.floor(viewport.width * ratio);
    nextCanvas.height = Math.floor(viewport.height * ratio);
    const context = nextCanvas.getContext("2d", { alpha: false });
    if (!context) return;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    });
    let cancelled = false;
    void task.promise.then(() => {
      if (cancelled) return;
      canvas.width = nextCanvas.width;
      canvas.height = nextCanvas.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.getContext("2d", { alpha: false })?.drawImage(nextCanvas, 0, 0);
      cachePageRender(cacheKey, nextCanvas);
      setRendered(true);
      onRenderingChange?.(page.pageNumber, false);
    }).catch(() => {
      // Rendering cancellation is expected when pages or zoom change quickly.
      onRenderingChange?.(page.pageNumber, false);
    });
    return () => {
      cancelled = true;
      task.cancel();
      onRenderingChange?.(page.pageNumber, false);
    };
  }, [onRenderingChange, page, renderActive, viewport]);

  return (
    <div
      ref={hostRef}
      id={pageId === null ? undefined : pageId ?? `page-${page.pageNumber}`}
      data-page-mounted={page.pageNumber}
      className="relative shrink-0 bg-white shadow-2xl"
      aria-label={pageId === null ? undefined : `Page ${page.pageNumber}`}
      onPointerDown={() => onSelectAnnotation(null)}
      style={{
        width: `${Math.ceil(viewport.width)}px`,
        height: `${Math.ceil(viewport.height)}px`
      }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: `${Math.ceil(viewport.width)}px`,
          height: `${Math.ceil(viewport.height)}px`
        }}
      />
      {!rendered && (
        <div
          className="page-skeleton pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-zinc-100 text-zinc-500"
          role="status"
          aria-label={`Rendering page ${page.pageNumber}`}
        >
          <div className="relative z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs shadow-sm">
            <LoaderCircle size={15} className="animate-spin" />
            Rendering page {page.pageNumber}
          </div>
        </div>
      )}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        data-testid="annotation-layer"
        data-active-tool={activeTool}
        className={`absolute inset-0 h-full w-full ${activeTool === "select" ? "pointer-events-none" : "annotation-cursor"}`}
        aria-label="Annotation layer"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = {
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height
          };
          if (activeTool === "pen" || activeTool === "highlight" || activeTool === "redact") {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraft([point]);
          } else if (activeTool === "image") {
            window.dispatchEvent(new CustomEvent("sovereign:add-image", {
              detail: { page: page.pageNumber, ...point }
            }));
          }
        }}
        onClick={(event) => {
          if (activeTool !== "text") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setEditingText({
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height,
            value: ""
          });
        }}
        onPointerMove={(event) => {
          if (!draft.length) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setDraft((points) => [...points, {
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height
          }]);
        }}
        onPointerUp={() => {
          if (draft.length > 1 && (activeTool === "pen" || activeTool === "highlight")) {
            onAddAnnotation({
              id: createLocalId(),
              kind: activeTool,
              page: page.pageNumber,
              points: draft,
              color: activeTool === "highlight" ? highlightStyle.color : penStyle.color,
              width: activeTool === "highlight" ? highlightStyle.width : penStyle.width,
              opacity: activeTool === "highlight" ? highlightStyle.opacity : penStyle.opacity
            });
          } else if (draft.length > 1 && activeTool === "redact") {
            const first = draft[0];
            const last = draft[draft.length - 1];
            onAddAnnotation({
              id: createLocalId(),
              kind: "redaction",
              page: page.pageNumber,
              x: Math.min(first.x, last.x),
              y: Math.min(first.y, last.y),
              width: Math.abs(last.x - first.x),
              height: Math.abs(last.y - first.y)
            });
          }
          setDraft([]);
        }}
      >
        {annotations.map((annotation) => {
          if (annotation.kind === "text") return null;
          if (annotation.kind === "pen" || annotation.kind === "highlight") {
            return <polyline key={annotation.id} points={annotation.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={annotation.color} strokeWidth={annotation.width / 800} opacity={annotation.opacity} strokeLinecap="round" strokeLinejoin="round" />;
          }
          if (annotation.kind === "image") {
            return <image key={annotation.id} href={annotation.dataUrl} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
          }
          return <rect key={annotation.id} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} fill="black" />;
        })}
        {draft.length > 1 && activeTool !== "redact" && <polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={activeTool === "highlight" ? highlightStyle.color : penStyle.color} strokeWidth={(activeTool === "highlight" ? highlightStyle.width : penStyle.width) / 800} opacity={activeTool === "highlight" ? highlightStyle.opacity : penStyle.opacity} strokeLinecap="round" />}
        {draft.length > 1 && activeTool === "redact" && <rect x={Math.min(draft[0].x, draft[draft.length - 1].x)} y={Math.min(draft[0].y, draft[draft.length - 1].y)} width={Math.abs(draft[draft.length - 1].x - draft[0].x)} height={Math.abs(draft[draft.length - 1].y - draft[0].y)} fill="black" opacity="0.8" />}
      </svg>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {searchMatches.map((match) => {
          const active = match.id === activeSearchMatchId;
          return (
            <span
              id={`search-match-${match.id}`}
              key={match.id}
              className={`absolute rounded-[2px] mix-blend-multiply ${active ? "bg-red-500/65 ring-1 ring-red-700" : "bg-yellow-300/55"}`}
              style={{
                left: `${match.x * 100}%`,
                top: `${match.y * 100}%`,
                width: `${Math.max(match.width, 0.004) * 100}%`,
                height: `${Math.max(match.height, 0.008) * 100}%`
              }}
            />
          );
        })}
        {annotations.map((annotation) => {
          if (annotation.kind === "image") return null;
          const displayed = annotationDraft?.id === annotation.id ? annotationDraft : annotation;
          const box = boundsForAnnotation(displayed);
          const selected = selectedAnnotationId === annotation.id;
          return (
            <div
              key={`annotation-controls-${annotation.id}`}
              data-annotation-kind={annotation.kind}
              data-annotation-id={annotation.id}
              className={`absolute ${
                activeTool === "select" ? "pointer-events-auto cursor-move" : "pointer-events-none"
              } ${
                selected
                  ? "border-2 border-orange-500 bg-orange-400/5 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                  : "hover:border hover:border-orange-400/70"
              }`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`
              }}
              onPointerDown={(event) => beginAnnotationGesture(event, annotation, "move")}
              onPointerMove={moveAnnotationGesture}
              onPointerUp={finishAnnotationGesture}
              onClick={(event) => {
                event.stopPropagation();
                onSelectAnnotation(annotation.id);
              }}
            >
              {selected && activeTool === "select" && (
                <>
                  <button
                    type="button"
                    aria-label={`Delete selected ${annotation.kind}`}
                    data-tooltip={`Delete ${annotation.kind}`}
                    className="pointer-events-auto absolute -right-2.5 -top-2.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-white bg-red-600 text-white shadow-lg hover:bg-red-500"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveAnnotation(annotation.id);
                      onSelectAnnotation(null);
                    }}
                  >
                    <X size={13} />
                  </button>
                  <span
                    role="button"
                    aria-label={`Resize selected ${annotation.kind}`}
                    data-tooltip={`Drag to resize ${annotation.kind}`}
                    className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-orange-500 shadow"
                    onPointerDown={(event) => beginAnnotationGesture(event, annotation, "resize")}
                    onPointerMove={moveAnnotationGesture}
                    onPointerUp={finishAnnotationGesture}
                  />
                </>
              )}
            </div>
          );
        })}
        {annotations.map((annotation) => {
          if (annotation.kind !== "image") return null;
          const box = imageDraft?.id === annotation.id ? imageDraft : annotation;
          const selected = selectedAnnotationId === annotation.id;
          return (
            <div
              key={`image-controls-${annotation.id}`}
              className={`absolute ${activeTool === "select" ? "pointer-events-auto cursor-move" : "pointer-events-none"} ${selected ? "border-2 border-orange-500 bg-orange-400/5 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]" : "hover:border hover:border-orange-400/70"}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`
              }}
              onPointerDown={(event) => beginImageGesture(event, annotation, "move")}
              onPointerMove={moveImageGesture}
              onPointerUp={finishImageGesture}
              onClick={(event) => {
                event.stopPropagation();
                onSelectAnnotation(annotation.id);
              }}
            >
              {selected && activeTool === "select" && (
                <>
                  <button
                    type="button"
                    aria-label="Delete selected image"
                    data-tooltip="Delete image"
                    className="pointer-events-auto absolute -right-3 -top-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white bg-red-600 text-white shadow-lg hover:bg-red-500"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveAnnotation(annotation.id);
                      onSelectAnnotation(null);
                    }}
                  >
                    <X size={13} />
                  </button>
                  <span
                    role="button"
                    aria-label="Resize selected image"
                    data-tooltip="Drag to resize image"
                    className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-orange-500 shadow"
                    onPointerDown={(event) => beginImageGesture(event, annotation, "resize")}
                    onPointerMove={moveImageGesture}
                    onPointerUp={finishImageGesture}
                  />
                </>
              )}
            </div>
          );
        })}
        {annotations.map((annotation) => annotation.kind === "text" && (
          <span
            key={annotation.id}
            data-annotation-text={annotation.id}
            className="absolute whitespace-pre leading-none"
            style={{
              left: `${annotation.x * 100}%`,
              top: `${annotation.y * 100}%`,
              color: annotation.color,
              fontFamily: cssFontFamily(annotation.fontFamily),
              fontSize: `${annotation.size * scale}px`,
              fontStyle: annotation.italic ? "italic" : "normal",
              fontWeight: annotation.bold ? 700 : 400
            }}
          >
            {annotation.text}
          </span>
        ))}
        {editingText && (
          <input
            ref={textInputRef}
            autoFocus
            aria-label="Text annotation"
            placeholder="Begin typing…"
            spellCheck={false}
            value={editingText.value}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value;
              setEditingText((current) => current ? { ...current, value } : null);
            }}
            onBlur={(event) => finishText(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = "";
                event.currentTarget.blur();
              }
            }}
            className="pointer-events-auto absolute rounded-sm border border-dashed border-orange-500 bg-orange-50/95 px-1 py-0.5 shadow-lg outline-none placeholder:text-current placeholder:opacity-45"
            style={{
              left: `${editingText.x * 100}%`,
              top: `${editingText.y * 100}%`,
              width: `${Math.max(15, editingText.value.length + 1)}ch`,
              color: textStyle.color,
              fontFamily: cssFontFamily(textStyle.fontFamily),
              fontSize: `${textStyle.size * scale}px`,
              fontStyle: textStyle.italic ? "italic" : "normal",
              fontWeight: textStyle.bold ? 700 : 400,
              lineHeight: 1
            }}
          />
        )}
      </div>
    </div>
  );
}
