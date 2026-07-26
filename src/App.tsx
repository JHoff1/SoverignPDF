import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Copy,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  FileDown,
  FileCheck2,
  FilePlus2,
  FolderOpen,
  Highlighter,
  ImagePlus,
  LoaderCircle,
  Menu,
  Minimize2,
  MousePointer2,
  PenLine,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Scissors,
  Settings,
  ShieldCheck,
  WifiOff,
  Trash2,
  Type,
  Undo2,
  Redo2,
  ScanText,
  ScanLine,
  ZoomIn,
  ZoomOut,
  X
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  GlobalWorkerOptions,
  Util,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import { simd } from "wasm-feature-detect";
import {
  useDocumentEditor,
  type Annotation,
  type Point,
  type TextStyle
} from "./editor/useDocumentEditor";
import {
  backupPath,
  clonePlain,
  createLocalId,
  fileUrlToPath,
  joinLocalPath,
  parsePageRanges
} from "./localUtils";

GlobalWorkerOptions.workerSrc = pdfWorker;

type ViewMode = "fit-width" | "fit-page" | "custom";
type Tool = "select" | "text" | "pen" | "highlight" | "image" | "redact";
type SearchSpan = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type SearchMatch = SearchSpan & {
  id: string;
  page: number;
};
type ImageAnnotation = Extract<Annotation, { kind: "image" }>;
type ImageBox = Pick<ImageAnnotation, "id" | "x" | "y" | "width" | "height">;
type StrokeStyle = {
  color: string;
  width: number;
  opacity: number;
};
type AppPreferences = {
  confirmOverwrite: boolean;
  defaultSaveFolder: string;
  flattenAnnotations: boolean;
  automaticBackups: boolean;
  textStyle: TextStyle;
  penStyle: StrokeStyle;
  highlightStyle: StrokeStyle;
  recentFiles: string[];
};

const PREFERENCES_KEY = "sovereignpdf.preferences.v1";
const DEFAULT_PREFERENCES: AppPreferences = {
  confirmOverwrite: false,
  defaultSaveFolder: "",
  flattenAnnotations: true,
  automaticBackups: false,
  textStyle: {
    size: 18,
    color: "#202124",
    fontFamily: "helvetica",
    bold: false,
    italic: false
  },
  penStyle: { color: "#df5b43", width: 2, opacity: 1 },
  highlightStyle: { color: "#ffe45c", width: 16, opacity: 0.35 },
  recentFiles: []
};

type CachedPageRender = {
  canvas: HTMLCanvasElement;
  pixels: number;
};

const MAX_PAGE_RENDER_CACHE_PIXELS = 6_000_000;
const pageRenderCache = new Map<string, CachedPageRender>();
const pageRenderCacheIds = new WeakMap<PDFPageProxy, number>();
let nextPageRenderCacheId = 1;
let pageRenderCachePixels = 0;

function pageRenderCacheKey(
  page: PDFPageProxy,
  width: number,
  height: number,
  ratio: number
) {
  let pageId = pageRenderCacheIds.get(page);
  if (!pageId) {
    pageId = nextPageRenderCacheId;
    nextPageRenderCacheId += 1;
    pageRenderCacheIds.set(page, pageId);
  }
  return `${pageId}:${Math.floor(width * ratio)}x${Math.floor(height * ratio)}`;
}

function getCachedPageRender(key: string) {
  const cached = pageRenderCache.get(key);
  if (!cached) return null;
  pageRenderCache.delete(key);
  pageRenderCache.set(key, cached);
  return cached.canvas;
}

function cachePageRender(key: string, canvas: HTMLCanvasElement) {
  const pixels = canvas.width * canvas.height;
  if (pixels > MAX_PAGE_RENDER_CACHE_PIXELS) return;
  const previous = pageRenderCache.get(key);
  if (previous) {
    pageRenderCachePixels -= previous.pixels;
    pageRenderCache.delete(key);
  }
  pageRenderCache.set(key, { canvas, pixels });
  pageRenderCachePixels += pixels;
  while (pageRenderCachePixels > MAX_PAGE_RENDER_CACHE_PIXELS) {
    const oldest = pageRenderCache.entries().next().value as
      | [string, CachedPageRender]
      | undefined;
    if (!oldest) break;
    pageRenderCache.delete(oldest[0]);
    pageRenderCachePixels -= oldest[1].pixels;
  }
}

function loadPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}") as Partial<AppPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      textStyle: { ...DEFAULT_PREFERENCES.textStyle, ...stored.textStyle },
      penStyle: { ...DEFAULT_PREFERENCES.penStyle, ...stored.penStyle },
      highlightStyle: { ...DEFAULT_PREFERENCES.highlightStyle, ...stored.highlightStyle },
      recentFiles: Array.isArray(stored.recentFiles)
        ? stored.recentFiles.filter((path): path is string => typeof path === "string").slice(0, 8)
        : []
    };
  } catch {
    return clonePlain(DEFAULT_PREFERENCES);
  }
}

function cssFontFamily(font: TextStyle["fontFamily"]) {
  if (font === "times") return "Times New Roman, Times, serif";
  if (font === "courier") return "Courier New, Courier, monospace";
  return "Arial, Helvetica, sans-serif";
}

const iconButton =
  "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const compactToolButton =
  "toolbar-tooltip flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const dropdownItem =
  "toolbar-tooltip flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function ToolbarDropdown({
  label,
  tooltip,
  tooltipAlign = "center",
  icon,
  children,
  className = ""
}: {
  label: string;
  tooltip: string;
  tooltipAlign?: "start" | "center" | "end";
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeIfOutside = (event: Event) => {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.removeAttribute("open");
    };
    const closeOnWindowBlur = () => detailsRef.current?.removeAttribute("open");

    document.addEventListener("focusin", closeIfOutside);
    document.addEventListener("pointerdown", closeIfOutside);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("focusin", closeIfOutside);
      document.removeEventListener("pointerdown", closeIfOutside);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, []);

  return (
    <details ref={detailsRef} className={`toolbar-dropdown relative ${className}`}>
      <summary
        data-tooltip={tooltip}
        data-tooltip-align={tooltipAlign}
        className={`${compactToolButton} cursor-pointer list-none`}
      >
        {icon}
        <span className="hidden min-[1200px]:inline">{label}</span>
        <ChevronDown size={12} className="text-zinc-500" />
      </summary>
      <div className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-44 rounded-lg border border-white/10 bg-[#202329] p-1.5 shadow-2xl">
        {children}
      </div>
    </details>
  );
}

function AppDialog({
  title,
  description,
  confirmLabel,
  confirmDisabled = false,
  busy = false,
  showCancel = true,
  wide = false,
  onCancel,
  onConfirm,
  children
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  showCancel?: boolean;
  wide?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-white/15 bg-[#202329] shadow-2xl`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled && !busy) void onConfirm();
        }}
      >
        <div className="flex items-start gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="app-dialog-title" className="text-base font-semibold text-zinc-100">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          {showCancel && (
            <button
              type="button"
              className="h-9 rounded-md px-4 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="h-9 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={confirmDisabled || busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function cloneForPdfJs(bytes: Uint8Array) {
  return new Uint8Array(bytes).buffer;
}

async function readLocalPdf(path: string) {
  const bytes = await readFile(path);
  return bytes.slice().buffer;
}

async function rasterizeForSecureRedaction(bytes: Uint8Array) {
  const source = await getDocument({ data: cloneForPdfJs(bytes) }).promise;
  const output = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    const sourcePage = await source.getPage(pageNumber);
    const pdfSize = sourcePage.getViewport({ scale: 1 });
    const renderSize = sourcePage.getViewport({ scale: 2 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(renderSize.width);
    canvas.height = Math.ceil(renderSize.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable.");
    await sourcePage.render({ canvasContext: context, viewport: renderSize }).promise;
    const encoded = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
    const imageBytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const image = await output.embedJpg(imageBytes);
    const page = output.addPage([pdfSize.width, pdfSize.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pdfSize.width,
      height: pdfSize.height
    });
  }
  await source.destroy();
  return output.save({ useObjectStreams: true });
}

function PageCanvas({
  page,
  scale,
  onVisible,
  annotations,
  activeTool,
  onAddAnnotation,
  textStyle,
  penStyle,
  highlightStyle,
  searchMatches,
  activeSearchMatchId,
  selectedAnnotationId,
  onSelectAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation
}: {
  page: PDFPageProxy;
  scale: number;
  onVisible: (page: number) => void;
  annotations: Annotation[];
  activeTool: Tool;
  onAddAnnotation: (annotation: Annotation) => void;
  textStyle: TextStyle;
  penStyle: StrokeStyle;
  highlightStyle: StrokeStyle;
  searchMatches: SearchMatch[];
  activeSearchMatchId: string | null;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>, label?: string) => void;
  onRemoveAnnotation: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      onAddAnnotation({
        id: createLocalId(),
        kind: "text",
        page: page.pageNumber,
        x: editingText.x,
        y: editingText.y,
        text,
        ...textStyle
      });
    }
    setEditingText(null);
  }, [editingText, onAddAnnotation, page.pageNumber, textStyle]);

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
    setRendered(false);
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
      return;
    }
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
    }).catch(() => {
      // Rendering cancellation is expected when pages or zoom change quickly.
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [page, renderActive, viewport]);

  return (
    <div
      ref={hostRef}
      id={`page-${page.pageNumber}`}
      className="relative shrink-0 bg-white shadow-2xl"
      aria-label={`Page ${page.pageNumber}`}
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
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-100 text-zinc-500"
          role="status"
          aria-label={`Rendering page ${page.pageNumber}`}
        >
          <div className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs shadow-sm">
            <LoaderCircle size={15} className="animate-spin" />
            Rendering page {page.pageNumber}
          </div>
        </div>
      )}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full ${activeTool === "select" ? "pointer-events-none" : "cursor-crosshair"}`}
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

function Thumbnail({
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
      <div className="relative mx-auto" style={{ width: `${Math.ceil(viewport.width)}px`, height: `${Math.ceil(viewport.height)}px` }}>
        <canvas
          ref={ref}
          className="block bg-white shadow-md"
          style={{ width: `${Math.ceil(viewport.width)}px`, height: `${Math.ceil(viewport.height)}px` }}
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

export default function App() {
  const editor = useDocumentEditor();
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [pageText, setPageText] = useState<string[]>([]);
  const [pageSearchSpans, setPageSearchSpans] = useState<SearchSpan[][]>([]);
  const [textExtractionComplete, setTextExtractionComplete] = useState(false);
  const [extractedPageCount, setExtractedPageCount] = useState(0);
  const [ocrText, setOcrText] = useState<string[]>([]);
  const [ocrSearchSpans, setOcrSearchSpans] = useState<SearchSpan[][]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [fileName, setFileName] = useState("No document open");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPage, setSelectedPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("fit-page");
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>(preferences.textStyle);
  const [sidebarTab, setSidebarTab] = useState<"pages" | "bookmarks">("pages");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingStage, setLoadingStage] = useState("Opening document…");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [preparedPageCount, setPreparedPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<"preferences" | "save" | "overwrite" | "split" | "split-save" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveForceAs, setSaveForceAs] = useState(false);
  const [splitRanges, setSplitRanges] = useState("");
  const [splitError, setSplitError] = useState("");
  const [pendingSplitBytes, setPendingSplitBytes] = useState<Uint8Array | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [preferenceStatus, setPreferenceStatus] = useState("");
  const browserFileInput = useRef<HTMLInputElement>(null);
  const mergeFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const pendingImage = useRef<{ page: number; x: number; y: number } | null>(null);
  const lastRenderedBytes = useRef<Uint8Array | null>(null);
  const renderGeneration = useRef(0);
  const ocrAttemptedBytes = useRef<Uint8Array | null>(null);
  const ocrWorker = useRef<TesseractWorker | null>(null);
  const ocrCancelRequested = useRef(false);
  const desktopPlatform = useMemo<"windows" | "macos" | "linux" | "unknown">(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("windows")) return "windows";
    if (userAgent.includes("mac os")) return "macos";
    if (userAgent.includes("linux")) return "linux";
    return "unknown";
  }, []);
  const documentPrepared = Boolean(
    pdfDocument &&
    pages.length === pdfDocument.numPages &&
    preparedPageCount === pdfDocument.numPages
  );

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    setPreferences((current) => ({ ...current, textStyle }));
  }, [textStyle]);

  useEffect(() => {
    const handleZoomWheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !pdfDocument) return;
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.002);
      setZoom((value) => Math.min(4, Math.max(0.25, value * zoomFactor)));
      setViewMode("custom");
    };

    window.addEventListener("wheel", handleZoomWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleZoomWheel);
  }, [pdfDocument]);

  useEffect(() => {
    if (ocrWorker.current) {
      ocrCancelRequested.current = true;
      void ocrWorker.current.terminate();
    }
    setPageText([]);
    setPageSearchSpans([]);
    setTextExtractionComplete(false);
    setExtractedPageCount(0);
    setOcrText([]);
    setOcrSearchSpans([]);
    ocrAttemptedBytes.current = null;
  }, [editor.bytes]);

  useEffect(() => {
    if (!pdfDocument || pages.length !== pdfDocument.numPages) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const extractedText = Array.from({ length: pages.length }, () => "");
        const extractedSpans = Array.from(
          { length: pages.length },
          (): SearchSpan[] => []
        );
        for (const page of pages) {
          if (cancelled) return;
          try {
            const content = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });
            const spans = content.items.flatMap((item): SearchSpan[] => {
              if (!("str" in item) || !item.str.trim()) return [];
              const transform = Util.transform(viewport.transform, item.transform);
              const height = Math.hypot(transform[2], transform[3]);
              return [{
                text: item.str,
                x: Math.max(0, transform[4] / viewport.width),
                y: Math.max(0, (transform[5] - height) / viewport.height),
                width: Math.min(1, Math.abs(item.width) / viewport.width),
                height: Math.min(1, height / viewport.height)
              }];
            });
            const pageIndex = page.pageNumber - 1;
            extractedText[pageIndex] = content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ");
            extractedSpans[pageIndex] = spans;
          } catch {
            // Pages without an accessible text layer remain eligible for OCR.
          }
          if (!cancelled) {
            setPageText([...extractedText]);
            setPageSearchSpans(extractedSpans.map((spans) => [...spans]));
            setExtractedPageCount(page.pageNumber);
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
        if (!cancelled) setTextExtractionComplete(true);
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
    };
  }, [pages, pdfDocument]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.select(), 0);
      }
    };
    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(""), 8000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    const handleDeleteAnnotation = (event: KeyboardEvent) => {
      if (!selectedAnnotationId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      editor.removeAnnotation(selectedAnnotationId);
      setSelectedAnnotationId(null);
    };
    window.addEventListener("keydown", handleDeleteAnnotation);
    return () => window.removeEventListener("keydown", handleDeleteAnnotation);
  }, [editor, selectedAnnotationId]);

  useEffect(() => {
    if (
      selectedAnnotationId &&
      !editor.annotations.some((annotation) => annotation.id === selectedAnnotationId)
    ) {
      setSelectedAnnotationId(null);
    }
  }, [editor.annotations, selectedAnnotationId]);

  const renderPdf = useCallback(async (data: Uint8Array) => {
    const generation = ++renderGeneration.current;
    setBusy(true);
    setLoadingStage("Reading document structure…");
    setLoadingProgress(0.08);
    setPreparedPageCount(0);
    setError(null);
    let nextDocument: PDFDocumentProxy | null = null;
    try {
      nextDocument = await getDocument({ data: cloneForPdfJs(data) }).promise;
      if (generation !== renderGeneration.current) {
        await nextDocument.destroy();
        return;
      }

      setLoadingStage("Preparing the first page…");
      setLoadingProgress(0.18);
      const firstPage = await nextDocument.getPage(1);
      if (generation !== renderGeneration.current) {
        await nextDocument.destroy();
        return;
      }

      const openedDocument = nextDocument;
      setPdfDocument((previous) => {
        previous?.destroy();
        return openedDocument;
      });
      setPages([firstPage]);
      setPreparedPageCount(1);
      setLoadingProgress(openedDocument.numPages === 1 ? 1 : 0.25);
      setBusy(false);

      const loadedPages = [firstPage];
      const batchSize = 6;
      for (let start = 2; start <= openedDocument.numPages; start += batchSize) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const end = Math.min(openedDocument.numPages, start + batchSize - 1);
        const batch = await Promise.all(
          Array.from({ length: end - start + 1 }, (_, index) =>
            openedDocument.getPage(start + index)
          )
        );
        if (generation !== renderGeneration.current) return;
        loadedPages.push(...batch);
        setPages([...loadedPages]);
        setPreparedPageCount(end);
        setLoadingStage(`Preparing pages ${end} of ${openedDocument.numPages}…`);
        setLoadingProgress(0.25 + (end / openedDocument.numPages) * 0.75);
      }
      setLoadingProgress(1);
    } catch (cause) {
      if (generation !== renderGeneration.current) return;
      lastRenderedBytes.current = null;
      setError(cause instanceof Error ? cause.message : "Unable to open this PDF.");
      if (!pdfDocument) {
        setPages([]);
        setPdfDocument(null);
      }
    } finally {
      if (generation === renderGeneration.current) setBusy(false);
    }
  }, [pdfDocument]);

  useEffect(() => {
    if (!editor.bytes || editor.bytes === lastRenderedBytes.current) return;
    lastRenderedBytes.current = editor.bytes;
    void renderPdf(editor.bytes);
  }, [editor.bytes, renderPdf]);

  const loadPdf = useCallback((data: ArrayBuffer, name: string, path: string | null = null) => {
    setBusy(true);
    setLoadingStage(`Opening ${name}…`);
    setLoadingProgress(0.04);
    editor.load(new Uint8Array(data));
    setFileName(name);
    setSourcePath(path);
    setError(null);
    if (isTauri()) {
      const windowLabel = getCurrentWebview().label;
      void invoke("mark_window_document_open", { windowLabel });
      void getCurrentWindow().setTitle(`${name} — SovereignPDF`);
    }
    if (path) {
      setPreferences((current) => ({
        ...current,
        recentFiles: [path, ...current.recentFiles.filter((item) => item !== path)].slice(0, 8)
      }));
    }
    setCurrentPage(1);
    setSelectedPage(1);
    setViewMode("fit-page");
  }, [editor.load]);

  const readAndLoadPdf = useCallback(async (path: string) => {
    setBusy(true);
    setLoadingStage(`Reading ${baseName(path)}…`);
    setLoadingProgress(0.02);
    setError(null);
    try {
      loadPdf(await readLocalPdf(path), baseName(path), path);
    } catch (cause) {
      setBusy(false);
      throw cause;
    }
  }, [loadPdf]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const opened = new Set<string>();
    const loadExternalPdf = async (candidate: string) => {
      const path = fileUrlToPath(candidate);
      if (!path.toLowerCase().endsWith(".pdf") || opened.has(path)) return;
      opened.add(path);
      try {
        await readAndLoadPdf(path);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : "The file could not be read.";
        setError(`Could not open “${baseName(path)}”. ${detail}`);
      }
    };

    void (async () => {
      const disposers = await Promise.all([
        listen<string[]>("opened-pdf-paths", (event) => {
          const path = event.payload.find((value) => value.toLowerCase().includes(".pdf"));
          if (path) void loadExternalPdf(path);
        }),
        listen<string>("open-pdf-error", (event) => {
          setError(`SovereignPDF could not create a document window. ${event.payload}`);
        })
      ]);
      const dispose = () => disposers.forEach((unlistenEvent) => unlistenEvent());
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;

      const windowLabel = getCurrentWebview().label;
      const openedPaths = await invoke<string[]>("opened_pdf_paths", { windowLabel });
      const openedPath = openedPaths.find((value) => value.toLowerCase().includes(".pdf"));
      if (openedPath) await loadExternalPdf(openedPath);
    })().catch((cause) => {
      const detail = cause instanceof Error ? cause.message : "The request could not be completed.";
      setError(`SovereignPDF could not process the file-open request. ${detail}`);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [readAndLoadPdf]);

  const openPdf = useCallback(async () => {
    if (!isTauri()) {
      browserFileInput.current?.click();
      return;
    }
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (typeof path !== "string") return;
    try {
      await readAndLoadPdf(path);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "The file could not be read.";
      setError(`Could not open “${baseName(path)}”. ${detail}`);
    }
  }, [readAndLoadPdf]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths.find((item) =>
          item.toLowerCase().endsWith(".pdf")
        );
        if (path) {
          try {
            await readAndLoadPdf(path);
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : "The file could not be read.";
            setError(`Could not open “${baseName(path)}”. ${detail}`);
          }
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // Browser-only Vite preview: native drag/drop events are unavailable.
      });
    return () => unlisten?.();
  }, [readAndLoadPdf]);

  useEffect(() => {
    const requestImage = (event: Event) => {
      pendingImage.current = (event as CustomEvent).detail;
      imageFileInput.current?.click();
    };
    window.addEventListener("sovereign:add-image", requestImage);
    return () => window.removeEventListener("sovereign:add-image", requestImage);
  }, []);

  useEffect(() => () => void pdfDocument?.destroy(), [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument) return;
    setSelectedPage((page) => Math.min(Math.max(1, page), pdfDocument.numPages));
    setCurrentPage((page) => Math.min(Math.max(1, page), pdfDocument.numPages));
  }, [pdfDocument]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const page = pages[currentPage - 1];
    if (!workspace || !page || viewMode === "custom") return;

    const updateFittedZoom = () => {
      const pageSize = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(160, workspace.clientWidth - 64);
      const availableHeight = Math.max(160, workspace.clientHeight - 64);
      const nextZoom = viewMode === "fit-width"
        ? availableWidth / pageSize.width
        : Math.min(
            availableWidth / pageSize.width,
            availableHeight / pageSize.height
          );
      const constrainedZoom = Math.min(4, Math.max(0.25, nextZoom));
      setZoom((current) =>
        Math.abs(current - constrainedZoom) < 0.001 ? current : constrainedZoom
      );
    };

    updateFittedZoom();
    const observer = new ResizeObserver(updateFittedZoom);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [currentPage, pages, viewMode]);

  const jumpToPage = useCallback((pageNumber: number) => {
    window.document
      .getElementById(`page-${pageNumber}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(pageNumber);
    setSelectedPage(pageNumber);
  }, []);

  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    if (!needle) return [];
    const results: SearchMatch[] = [];
    pages.forEach((_, pageIndex) => {
      const spans = [
        ...(pageSearchSpans[pageIndex] ?? []),
        ...(ocrSearchSpans[pageIndex] ?? [])
      ];
      spans.forEach((span, spanIndex) => {
        const haystack = span.text.toLocaleLowerCase();
        let offset = 0;
        while ((offset = haystack.indexOf(needle, offset)) !== -1) {
          const widthPerCharacter = span.width / Math.max(span.text.length, 1);
          results.push({
            ...span,
            id: `${pageIndex}-${spanIndex}-${offset}`,
            page: pageIndex + 1,
            x: span.x + widthPerCharacter * offset,
            width: widthPerCharacter * needle.length
          });
          offset += Math.max(needle.length, 1);
        }
      });
    });
    return results;
  }, [ocrSearchSpans, pageSearchSpans, pages, searchQuery]);

  const focusSearchResult = useCallback((index: number) => {
    const match = searchResults[index];
    if (!match) return;
    setSearchResultIndex(index);
    setCurrentPage(match.page);
    setSelectedPage(match.page);
    window.document
      .getElementById(`search-match-${match.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchResults]);

  useEffect(() => {
    setSearchResultIndex(0);
    if (searchOpen && searchResults.length) {
      focusSearchResult(0);
    }
  }, [focusSearchResult, searchOpen, searchQuery, searchResults]);

  const moveSearchResult = useCallback((direction: 1 | -1) => {
    if (!searchResults.length) return;
    const next = (searchResultIndex + direction + searchResults.length) % searchResults.length;
    focusSearchResult(next);
  }, [focusSearchResult, searchResultIndex, searchResults]);

  const runOcr = useCallback(async () => {
    if (!pages.length || ocrRunning) return;
    const pageIndexes = pageText
      .map((text, index) => ({ index, hasText: text.trim().length >= 32 }))
      .filter((page) => !page.hasText)
      .map((page) => page.index);

    if (!pageIndexes.length) {
      setOcrStatus("This PDF already contains searchable text.");
      setOcrProgress(1);
      return;
    }

    setOcrRunning(true);
    setOcrProgress(0);
    setOcrStatus("Loading local OCR engine…");
    ocrCancelRequested.current = false;
    let worker: TesseractWorker | null = null;
    let activePage = 0;
    try {
      const assetUrl = (path: string) => new URL(path, window.location.href).href;
      const supportsSimd = await simd();
      worker = await createWorker("eng", 1, {
        workerPath: assetUrl("ocr/worker.min.js"),
        corePath: assetUrl(
          supportsSimd
            ? "ocr/core/tesseract-core-simd-lstm.js"
            : "ocr/core/tesseract-core-lstm.js"
        ),
        langPath: assetUrl("ocr/lang"),
        cacheMethod: "none",
        logger: (message) => {
          if (typeof message.progress === "number") {
            setOcrProgress((activePage + message.progress) / pageIndexes.length);
          }
          if (message.status) setOcrStatus(message.status);
        }
      });
      ocrWorker.current = worker;

      const recognized = Array.from({ length: pages.length }, (_, index) => ocrText[index] ?? "");
      const recognizedSpans = Array.from(
        { length: pages.length },
        (_, index) => ocrSearchSpans[index] ?? []
      );
      for (let position = 0; position < pageIndexes.length; position += 1) {
        if (ocrCancelRequested.current) break;
        activePage = position;
        const pageIndex = pageIndexes[position];
        const page = pages[pageIndex];
        setOcrStatus(`Recognizing page ${pageIndex + 1} of ${pages.length}…`);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable for OCR.");
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        recognized[pageIndex] = result.data.text.trim();
        recognizedSpans[pageIndex] = (result.data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.flatMap((line) =>
              line.words.map((word) => ({
                text: word.text,
                x: word.bbox.x0 / canvas.width,
                y: word.bbox.y0 / canvas.height,
                width: (word.bbox.x1 - word.bbox.x0) / canvas.width,
                height: (word.bbox.y1 - word.bbox.y0) / canvas.height
              }))
            )
          )
        );
        setOcrText([...recognized]);
        setOcrSearchSpans(recognizedSpans.map((spans) => [...spans]));
        setOcrProgress((position + 1) / pageIndexes.length);
      }
      setOcrStatus(ocrCancelRequested.current
        ? "OCR canceled."
        : `OCR complete · ${pageIndexes.length} page${pageIndexes.length === 1 ? "" : "s"} recognized`);
    } catch (cause) {
      setOcrStatus(ocrCancelRequested.current
        ? "OCR canceled."
        : cause instanceof Error ? `OCR failed: ${cause.message}` : "OCR failed.");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      ocrWorker.current = null;
      setOcrRunning(false);
    }
  }, [ocrRunning, ocrSearchSpans, ocrText, pageText, pages]);

  const cancelOcr = useCallback(() => {
    ocrCancelRequested.current = true;
    setOcrStatus("Canceling OCR…");
    void ocrWorker.current?.terminate();
  }, []);

  useEffect(() => {
    if (
      !editor.bytes ||
      !pages.length ||
      !textExtractionComplete ||
      ocrRunning ||
      ocrAttemptedBytes.current === editor.bytes
    ) return;
    const hasImageOnlyPages = pageText.some((text) => text.trim().length < 32);
    if (!hasImageOnlyPages) return;
    ocrAttemptedBytes.current = editor.bytes;
    const timer = window.setTimeout(() => void runOcr(), 400);
    return () => window.clearTimeout(timer);
  }, [
    editor.bytes,
    ocrRunning,
    pageText,
    pages.length,
    runOcr,
    textExtractionComplete
  ]);

  const selectedToolClass = useCallback(
    (tool: Tool) => (activeTool === tool ? " bg-accent/20 text-orange-200" : ""),
    [activeTool]
  );

  const downloadBytes = useCallback((bytes: Uint8Array, name: string) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const savePdf = useCallback(async (
    forceSaveAs = false,
    requestedName = fileName
  ) => {
    const hasRedactions = editor.annotations.some((item) => item.kind === "redaction");
    const shouldFlatten = preferences.flattenAnnotations || hasRedactions;
    const prepared = shouldFlatten ? await editor.flattened() : editor.bytes;
    if (!prepared) return false;
    const bytes = hasRedactions
      ? await rasterizeForSecureRedaction(prepared)
      : prepared;
    if (!isTauri()) {
      downloadBytes(bytes, requestedName);
      setFileName(requestedName);
      return true;
    }
    let path = forceSaveAs ? null : sourcePath;
    if (!path) {
      path = await save({
        defaultPath: preferences.defaultSaveFolder
          ? joinLocalPath(preferences.defaultSaveFolder, requestedName)
          : requestedName,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }]
      });
    }
    if (!path) return false;
    if (preferences.automaticBackups) {
      try {
        const existing = await readFile(path);
        await writeFile(backupPath(path), existing);
      } catch {
        // A new destination has no existing file to back up.
      }
    }
    await writeFile(path, bytes);
    setSourcePath(path);
    setFileName(baseName(path));
    return true;
  }, [downloadBytes, editor, fileName, preferences, sourcePath]);

  const requestSave = useCallback((forceSaveAs = false) => {
    if (!forceSaveAs && isTauri() && sourcePath) {
      if (preferences.confirmOverwrite) {
        setActiveDialog("overwrite");
        return;
      }
      void savePdf(false);
      return;
    }
    setSaveName(fileName);
    setSaveForceAs(forceSaveAs || !sourcePath);
    setActiveDialog("save");
  }, [fileName, preferences.confirmOverwrite, savePdf, sourcePath]);

  const confirmOverwriteSave = useCallback(async () => {
    setDialogBusy(true);
    try {
      const saved = await savePdf(false);
      if (saved) {
        setActiveDialog(null);
        setSuccessMessage(preferences.automaticBackups
          ? "Document saved. A timestamped backup of the previous file was created in the same folder."
          : "Document saved successfully.");
      }
    } finally {
      setDialogBusy(false);
    }
  }, [preferences.automaticBackups, savePdf]);

  const confirmSave = useCallback(async () => {
    const trimmedName = saveName.trim();
    if (!trimmedName) return;
    const normalizedName = /\.pdf$/i.test(trimmedName) ? trimmedName : `${trimmedName}.pdf`;
    setDialogBusy(true);
    try {
      const saved = await savePdf(saveForceAs, normalizedName);
      if (saved) setActiveDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }, [saveForceAs, saveName, savePdf]);

  const mergePdfBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setBusy(true);
    setLoadingStage(`Merging ${name}…`);
    setLoadingProgress(0.12);
    setError(null);
    try {
      await editor.merge(bytes);
      setLoadingStage("Preparing the merged document…");
      setLoadingProgress(0.35);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "The PDF could not be merged.");
    }
  }, [editor]);

  const mergePdf = useCallback(async () => {
    if (!documentPrepared) return;
    if (!isTauri()) {
      mergeFileInput.current?.click();
      return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (typeof path === "string") {
      setBusy(true);
      setLoadingStage(`Reading ${baseName(path)}…`);
      setLoadingProgress(0.04);
      try {
        await mergePdfBytes(new Uint8Array(await readLocalPdf(path)), baseName(path));
      } catch (cause) {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : "The PDF could not be read.");
      }
    }
  }, [documentPrepared, mergePdfBytes]);

  const splitPdf = useCallback(() => {
    if (!documentPrepared) return;
    setSplitRanges(String(selectedPage));
    setSplitError("");
    setActiveDialog("split");
  }, [documentPrepared, selectedPage]);

  const confirmSplit = useCallback(async () => {
    const parsed = parsePageRanges(splitRanges, pages.length);
    if (parsed.error) {
      setSplitError(parsed.error);
      return;
    }
    setDialogBusy(true);
    setSplitError("");
    try {
      const bytes = await editor.extract(parsed.pages);
      if (!bytes) return;
      setPendingSplitBytes(new Uint8Array(bytes));
      setSaveName(fileName.replace(/\.pdf$/i, "") + "-extract.pdf");
      setActiveDialog("split-save");
    } finally {
      setDialogBusy(false);
    }
  }, [editor, fileName, pages.length, splitRanges]);

  const confirmSplitSave = useCallback(async () => {
    if (!pendingSplitBytes) return;
    const trimmedName = saveName.trim();
    if (!trimmedName) return;
    const normalizedName = /\.pdf$/i.test(trimmedName) ? trimmedName : `${trimmedName}.pdf`;
    setDialogBusy(true);
    try {
      if (!isTauri()) {
        downloadBytes(pendingSplitBytes, normalizedName);
        setSuccessMessage(
          "Your new document has been downloaded. Your original document is untouched and remains loaded in SovereignPDF."
        );
        setPendingSplitBytes(null);
        setActiveDialog(null);
        return;
      }
      const path = await save({
        defaultPath: preferences.defaultSaveFolder
          ? joinLocalPath(preferences.defaultSaveFolder, normalizedName)
          : normalizedName,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }]
      });
      if (!path) return;
      await writeFile(path, pendingSplitBytes);
      setSuccessMessage(
        "Your new document has been saved in the location you selected. Your original document is untouched and remains loaded in SovereignPDF."
      );
      setPendingSplitBytes(null);
      setActiveDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }, [downloadBytes, pendingSplitBytes, preferences.defaultSaveFolder, saveName]);

  const deleteSelectedPage = useCallback(() => {
    if (!pdfDocument || !documentPrepared || pdfDocument.numPages <= 1) return;
    const nextSelection = Math.min(selectedPage, pdfDocument.numPages - 1);
    void editor.remove(selectedPage);
    setSelectedPage(nextSelection);
    setCurrentPage(nextSelection);
  }, [documentPrepared, editor, pdfDocument, selectedPage]);

  const duplicateSelectedPage = useCallback(() => {
    if (!documentPrepared) return;
    void editor.duplicate(selectedPage);
  }, [documentPrepared, editor, selectedPage]);

  const rotateSelectedPage = useCallback((amount: number) => {
    if (!documentPrepared) return;
    void editor.rotate(selectedPage, amount);
  }, [documentPrepared, editor, selectedPage]);

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const openDefaultAppSettings = useCallback(async () => {
    if (!isTauri()) {
      setPreferenceStatus("This shortcut is available in the installed desktop application.");
      return;
    }
    try {
      await invoke("open_default_apps_settings");
      setPreferenceStatus("Windows Default Apps settings opened. Choose SovereignPDF for .pdf files.");
    } catch (cause) {
      setPreferenceStatus(
        cause instanceof Error ? cause.message : String(cause)
      );
    }
  }, []);

  const chooseDefaultSaveFolder = useCallback(async () => {
    if (!isTauri()) {
      setPreferenceStatus("Folder selection is available in the installed desktop application.");
      return;
    }
    const folder = await open({
      directory: true,
      multiple: false,
      defaultPath: preferences.defaultSaveFolder || undefined
    });
    if (typeof folder !== "string") return;
    setPreferences((current) => ({ ...current, defaultSaveFolder: folder }));
    setPreferenceStatus("Default Save As folder updated.");
  }, [preferences.defaultSaveFolder]);

  const clearLocalPreferences = useCallback(() => {
    window.localStorage.removeItem(PREFERENCES_KEY);
    const reset = clonePlain(DEFAULT_PREFERENCES);
    setPreferences(reset);
    setTextStyle(reset.textStyle);
    setPreferenceStatus("Recent file paths and locally stored preferences were cleared.");
  }, []);

  const status = useMemo(() => {
    if (busy) return "Opening document…";
    if (error) return error;
    if (!pdfDocument) return "Drop a local PDF here or choose Open";
    return `${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}`;
  }, [busy, pdfDocument, error]);

  return (
    <div className="flex h-full flex-col bg-ink text-zinc-100">
      <input
        ref={browserFileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          setBusy(true);
          setLoadingStage(`Reading ${file.name}…`);
          setLoadingProgress(0.02);
          setError(null);
          void file.arrayBuffer()
            .then((data) => loadPdf(data, file.name))
            .catch((cause) => {
              setBusy(false);
              setError(cause instanceof Error ? cause.message : "The file could not be read.");
            });
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={mergeFileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            setBusy(true);
            setLoadingStage(`Reading ${file.name}…`);
            setLoadingProgress(0.04);
            void file.arrayBuffer()
              .then((data) => mergePdfBytes(new Uint8Array(data), file.name))
              .catch((cause) => {
                setBusy(false);
                setError(cause instanceof Error ? cause.message : "The PDF could not be read.");
              });
          }
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={imageFileInput}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const placement = pendingImage.current;
          if (file && placement) {
            const reader = new FileReader();
            reader.onload = () => {
              const id = createLocalId();
              editor.addAnnotation({
                id,
                kind: "image",
                ...placement,
                width: 0.24,
                height: 0.12,
                dataUrl: String(reader.result)
              });
              setSelectedAnnotationId(id);
              setActiveTool("select");
            };
            reader.readAsDataURL(file);
          }
          pendingImage.current = null;
          event.currentTarget.value = "";
        }}
      />
      {activeDialog === "preferences" && (
        <AppDialog
          title="Preferences"
          description="Configure local saving, privacy, and editing defaults."
          confirmLabel="Done"
          showCancel={false}
          wide
          onCancel={() => setActiveDialog(null)}
          onConfirm={() => setActiveDialog(null)}
        >
          <section className="rounded-lg border border-white/10 bg-black/15 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
                <FileCheck2 size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-100">Default PDF application</h3>
                {desktopPlatform === "windows" && (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    SovereignPDF is registered as a PDF editor when installed. Windows requires you to approve the default app in Settings.
                  </p>
                )}
                {desktopPlatform === "macos" && (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    In Finder, select a PDF and choose File → Get Info. Under Open with, select SovereignPDF, then choose Change All.
                  </p>
                )}
                {desktopPlatform === "linux" && (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    After installing the package, right-click a PDF, choose Properties or Open With, select SovereignPDF, and make it the default.
                  </p>
                )}
                {desktopPlatform === "unknown" && (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    Choose SovereignPDF for PDF files in your operating system’s default application settings.
                  </p>
                )}
              </div>
            </div>
            {desktopPlatform === "windows" && (
              <button
                type="button"
                className="mt-4 h-9 rounded-md bg-sky-500/15 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
                onClick={() => void openDefaultAppSettings()}
              >
                Open Windows Default Apps
              </button>
            )}
            {preferenceStatus && (
              <p className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-300">
                {preferenceStatus}
              </p>
            )}
          </section>
          <section className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <WifiOff size={18} className="mt-0.5 shrink-0 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-zinc-100">Privacy and local data</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Network access is disabled. Documents, recent file paths, and preferences stay on this computer.
                </p>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {preferences.recentFiles.length
                    ? `${preferences.recentFiles.length} recent local file path${preferences.recentFiles.length === 1 ? "" : "s"} remembered.`
                    : "No recent file paths are currently remembered."}
                </p>
                <button
                  type="button"
                  className="mt-3 h-9 rounded-md border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                  onClick={clearLocalPreferences}
                >
                  Clear recent files and settings
                </button>
              </div>
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Saving</h3>
            <div className="mt-3 space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={preferences.confirmOverwrite}
                  onChange={(event) => setPreferences((current) => ({ ...current, confirmOverwrite: event.target.checked }))}
                  className="mt-0.5 accent-orange-500"
                />
                <span>
                  <span className="block text-xs font-medium text-zinc-200">Confirm before overwriting</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">Ask before Save replaces the currently opened file.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={preferences.automaticBackups}
                  onChange={(event) => setPreferences((current) => ({ ...current, automaticBackups: event.target.checked }))}
                  className="mt-0.5 accent-orange-500"
                />
                <span>
                  <span className="block text-xs font-medium text-zinc-200">Create automatic backup copies</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">Before overwriting, preserve the previous PDF beside it with a timestamped backup name.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={preferences.flattenAnnotations}
                  onChange={(event) => setPreferences((current) => ({ ...current, flattenAnnotations: event.target.checked }))}
                  className="mt-0.5 accent-orange-500"
                />
                <span>
                  <span className="block text-xs font-medium text-zinc-200">Flatten annotations by default</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">Embed text, pen, highlight, and images as permanent PDF page content. If disabled, current overlay markup is omitted from the saved PDF.</span>
                </span>
              </label>
              <div>
                <span className="block text-xs font-medium text-zinc-200">Default Save As folder</span>
                <div className="mt-2 flex gap-2">
                  <input
                    aria-label="Default Save As folder"
                    value={preferences.defaultSaveFolder}
                    onChange={(event) => setPreferences((current) => ({ ...current, defaultSaveFolder: event.target.value }))}
                    placeholder="Use the last system folder"
                    className="h-9 min-w-0 flex-1 rounded-md border border-white/15 bg-[#15171b] px-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-orange-500/70"
                  />
                  <button
                    type="button"
                    className="h-9 rounded-md bg-white/10 px-3 text-xs font-medium text-zinc-200 hover:bg-white/15"
                    onClick={() => void chooseDefaultSaveFolder()}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-white/10 bg-black/15 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Editing defaults</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-zinc-300">Text</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Default text font"
                    value={textStyle.fontFamily}
                    onChange={(event) => setTextStyle((style) => ({ ...style, fontFamily: event.target.value as TextStyle["fontFamily"] }))}
                    className="h-9 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200"
                  >
                    <option value="helvetica">Arial</option>
                    <option value="times">Times</option>
                    <option value="courier">Courier</option>
                  </select>
                  <input
                    aria-label="Default text size"
                    type="number"
                    min="6"
                    max="96"
                    value={textStyle.size}
                    onChange={(event) => setTextStyle((style) => ({ ...style, size: Math.min(96, Math.max(6, Number(event.target.value) || 6)) }))}
                    className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200"
                  />
                  <input aria-label="Default text color" type="color" value={textStyle.color} onChange={(event) => setTextStyle((style) => ({ ...style, color: event.target.value }))} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-300">Pen</p>
                <div className="mt-2 flex items-center gap-2">
                  <input aria-label="Default pen color" type="color" value={preferences.penStyle.color} onChange={(event) => setPreferences((current) => ({ ...current, penStyle: { ...current.penStyle, color: event.target.value } }))} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
                  <label className="text-[11px] text-zinc-500">Width</label>
                  <input aria-label="Default pen width" type="number" min="1" max="20" value={preferences.penStyle.width} onChange={(event) => setPreferences((current) => ({ ...current, penStyle: { ...current.penStyle, width: Math.min(20, Math.max(1, Number(event.target.value) || 1)) } }))} className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-zinc-300">Highlighter</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input aria-label="Default highlighter color" type="color" value={preferences.highlightStyle.color} onChange={(event) => setPreferences((current) => ({ ...current, highlightStyle: { ...current.highlightStyle, color: event.target.value } }))} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
                  <label className="text-[11px] text-zinc-500">Width</label>
                  <input aria-label="Default highlighter width" type="number" min="4" max="60" value={preferences.highlightStyle.width} onChange={(event) => setPreferences((current) => ({ ...current, highlightStyle: { ...current.highlightStyle, width: Math.min(60, Math.max(4, Number(event.target.value) || 4)) } }))} className="h-9 w-16 rounded-md border border-white/15 bg-[#15171b] px-2 text-xs text-zinc-200" />
                  <label className="text-[11px] text-zinc-500">Opacity</label>
                  <input aria-label="Default highlighter opacity" type="range" min="10" max="80" value={Math.round(preferences.highlightStyle.opacity * 100)} onChange={(event) => setPreferences((current) => ({ ...current, highlightStyle: { ...current.highlightStyle, opacity: Number(event.target.value) / 100 } }))} className="w-28 accent-yellow-400" />
                  <span className="w-9 text-right text-[11px] text-zinc-400">{Math.round(preferences.highlightStyle.opacity * 100)}%</span>
                </div>
              </div>
            </div>
          </section>

          <p className="mt-3 text-[11px] leading-5 text-zinc-500">
            Settings are stored only in this app's local webview storage. File association registration takes effect after installing a newly built package.
          </p>
        </AppDialog>
      )}
      {activeDialog === "overwrite" && (
        <AppDialog
          title="Overwrite current PDF?"
          description={`Save changes directly to ${fileName}?`}
          confirmLabel="Overwrite PDF"
          busy={dialogBusy}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmOverwriteSave}
        >
          <p className="text-xs leading-5 text-zinc-300">
            {preferences.automaticBackups
              ? "The existing file will be preserved first as a timestamped backup in the same folder."
              : "The existing file will be replaced. Automatic backups are currently disabled."}
          </p>
        </AppDialog>
      )}
      {activeDialog === "save" && (
        <AppDialog
          title={saveForceAs ? "Save PDF As" : "Save PDF"}
          description={isTauri()
            ? "Choose the file name here. You will choose its local folder in the system picker next."
            : "Choose the file name for the PDF downloaded to this device."}
          confirmLabel="Continue"
          confirmDisabled={!saveName.trim()}
          busy={dialogBusy}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmSave}
        >
          <label className="block text-xs font-medium text-zinc-300" htmlFor="save-file-name">
            File name
          </label>
          <input
            id="save-file-name"
            autoFocus
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder="document.pdf"
            className="mt-2 h-10 w-full rounded-md border border-white/15 bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/70"
          />
          <p className="mt-2 text-[11px] text-zinc-500">
            A .pdf extension will be added automatically when omitted.
          </p>
        </AppDialog>
      )}
      {activeDialog === "split" && (
        <AppDialog
          title="Split or Extract Pages"
          description={`Choose the pages to export into a new PDF. This document contains ${pages.length} pages.`}
          confirmLabel="Export Pages"
          confirmDisabled={!splitRanges.trim()}
          busy={dialogBusy}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmSplit}
        >
          <label className="block text-xs font-medium text-zinc-300" htmlFor="split-page-ranges">
            Pages or ranges
          </label>
          <input
            id="split-page-ranges"
            autoFocus
            value={splitRanges}
            onChange={(event) => {
              setSplitRanges(event.target.value);
              if (splitError) setSplitError("");
            }}
            placeholder="1-3, 5, 8-10"
            aria-invalid={Boolean(splitError)}
            aria-describedby={splitError ? "split-range-error" : "split-range-help"}
            className={`mt-2 h-10 w-full rounded-md border bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 ${
              splitError ? "border-red-500/80 focus:border-red-400" : "border-white/15 focus:border-orange-500/70"
            }`}
          />
          {splitError ? (
            <p id="split-range-error" className="mt-2 text-xs text-red-300">{splitError}</p>
          ) : (
            <p id="split-range-help" className="mt-2 text-[11px] text-zinc-500">
              Separate pages and ranges with commas—for example, 1-3, 5.
            </p>
          )}
        </AppDialog>
      )}
      {activeDialog === "split-save" && (
        <AppDialog
          title="Save Extracted PDF"
          description={isTauri()
            ? "Name the new document, then choose where to save it. Your original PDF will remain unchanged."
            : "Name the extracted document before downloading it. Your original PDF will remain unchanged."}
          confirmLabel={isTauri() ? "Choose Location" : "Download PDF"}
          confirmDisabled={!saveName.trim() || !pendingSplitBytes}
          busy={dialogBusy}
          onCancel={() => {
            setPendingSplitBytes(null);
            setActiveDialog(null);
          }}
          onConfirm={confirmSplitSave}
        >
          <label className="block text-xs font-medium text-zinc-300" htmlFor="split-save-file-name">
            File name
          </label>
          <input
            id="split-save-file-name"
            autoFocus
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder="document-extract.pdf"
            className="mt-2 h-10 w-full rounded-md border border-white/15 bg-[#15171b] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/70"
          />
          <p className="mt-2 text-[11px] text-zinc-500">
            A .pdf extension will be added automatically when omitted.
          </p>
        </AppDialog>
      )}
      {successMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[210] flex w-[min(420px,calc(100vw-40px))] items-start gap-3 rounded-xl border border-emerald-400/30 bg-[#10241d] p-4 text-emerald-50 shadow-2xl"
        >
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" />
          <p className="min-w-0 flex-1 text-xs leading-5">{successMessage}</p>
          <button
            type="button"
            aria-label="Dismiss success message"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-200/70 hover:bg-white/10 hover:text-white"
            onClick={() => setSuccessMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-[220] flex w-[min(460px,calc(100vw-40px))] items-start gap-3 rounded-xl border border-red-400/40 bg-[#2a1215] p-4 text-red-50 shadow-2xl"
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Unable to open PDF</p>
            <p className="mt-1 break-words text-xs leading-5 text-red-100/80">{error}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss error message"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-200/70 hover:bg-white/10 hover:text-white"
            onClick={() => setError(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <header className="flex h-12 shrink-0 items-center border-b border-white/10 bg-panel px-3">
        <button className={iconButton} onClick={() => setSidebarOpen((value) => !value)}>
          <Menu size={17} />
        </button>
        <img
          src="/app-icon.png"
          alt=""
          aria-hidden="true"
          className="ml-1.5 h-7 w-7 shrink-0 rounded-[7px]"
        />
        <div className="ml-2 min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{fileName}</div>
          <div className={`truncate text-[10px] ${error ? "text-red-400" : "text-zinc-500"}`}>
            {status}
          </div>
        </div>
        <div className="ml-3 flex shrink-0 items-center">
          <button aria-label="Open PDF" className={iconButton} onClick={openPdf}>
            <FolderOpen size={16} /> <span className="hidden min-[1050px]:inline">Open</span>
          </button>
          <button aria-label="Save PDF" className={iconButton} disabled={!pdfDocument} onClick={() => requestSave(false)}>
            <Save size={16} /> <span className="hidden min-[1050px]:inline">Save</span>
          </button>
          <button aria-label="Save PDF As" className={iconButton} disabled={!pdfDocument} onClick={() => requestSave(true)}>
            <FileDown size={16} /> <span className="hidden min-[1120px]:inline">Save As</span>
          </button>
          <div className="mx-2 h-6 w-px bg-white/10" aria-hidden="true" />
          <button
            aria-label="Preferences"
            className={iconButton}
            onClick={() => {
              setPreferenceStatus("");
              setActiveDialog("preferences");
            }}
          >
            <Settings size={16} /> <span className="hidden min-[1050px]:inline">Preferences</span>
          </button>
        </div>
      </header>

      <div className="hidden">
        <div className="flex shrink-0 flex-col justify-start gap-2 border-r border-white/10 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Edit</span>
          <div className="flex items-center">
            <button className={iconButton} disabled={!documentPrepared} onClick={() => void mergePdf()}><FilePlus2 size={16} /> Merge</button>
            <button className={iconButton} disabled={!documentPrepared} onClick={() => void splitPdf()}><Scissors size={16} /> Split</button>
            <button className={iconButton} title={`Duplicate selected page ${selectedPage}`} disabled={!documentPrepared} onClick={duplicateSelectedPage}><Copy size={16} /> Duplicate</button>
            <button
              className={iconButton + " text-red-300 hover:bg-red-400/10 hover:text-red-200"}
              title={`Delete selected page ${selectedPage}`}
              disabled={!documentPrepared || (pdfDocument?.numPages ?? 0) <= 1}
              onClick={deleteSelectedPage}
            ><Trash2 size={16} /> Delete</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-start gap-2 border-r border-white/10 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">History</span>
          <div className="flex items-center">
            <button className={iconButton + " text-sky-300 hover:bg-sky-400/10 hover:text-sky-200"} title="Undo last edit" disabled={!editor.canUndo} onClick={editor.undo}><Undo2 size={16} /> Undo</button>
            <button className={iconButton + " text-sky-300 hover:bg-sky-400/10 hover:text-sky-200"} title="Redo last edit" disabled={!editor.canRedo} onClick={editor.redo}><Redo2 size={16} /> Redo</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-start gap-2 border-r border-white/10 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">Rotate · Page {selectedPage}</span>
          <div className="flex items-center">
            <button className={iconButton + " text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"} title={`Rotate selected page ${selectedPage} left`} disabled={!documentPrepared} onClick={() => rotateSelectedPage(-90)}><RotateCcw size={16} /> Left</button>
            <button className={iconButton + " text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"} title={`Rotate selected page ${selectedPage} right`} disabled={!documentPrepared} onClick={() => rotateSelectedPage(90)}><RotateCw size={16} /> Right</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-start gap-2 border-r border-white/10 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-orange-400/80">Markup</span>
          <div className="flex items-center">
            <button className={iconButton + selectedToolClass("select")} onClick={() => setActiveTool("select")}><MousePointer2 size={16} /> Select</button>
            <button className={iconButton + selectedToolClass("text")} onClick={() => setActiveTool("text")} disabled={!pdfDocument}><Type size={16} /> Text</button>
            {activeTool === "text" && (
              <div className="ml-1 flex h-9 items-center gap-1 rounded-md border border-white/10 bg-black/15 px-1.5">
                <select
                  aria-label="Text font"
                  value={textStyle.fontFamily}
                  onChange={(event) => setTextStyle((style) => ({ ...style, fontFamily: event.target.value as TextStyle["fontFamily"] }))}
                  className="h-7 rounded border border-white/10 bg-[#24272d] px-1 text-xs text-zinc-200"
                >
                  <option value="helvetica">Arial</option>
                  <option value="times">Times</option>
                  <option value="courier">Courier</option>
                </select>
                <input
                  aria-label="Text size"
                  type="number"
                  min="6"
                  max="96"
                  value={textStyle.size}
                  onChange={(event) => setTextStyle((style) => ({ ...style, size: Math.min(96, Math.max(6, Number(event.target.value) || 6)) }))}
                  className="h-7 w-12 rounded border border-white/10 bg-[#24272d] px-1 text-xs text-zinc-200"
                  title="Font size"
                />
                <button
                  aria-label="Bold"
                  className={`h-7 w-7 rounded text-xs font-bold ${textStyle.bold ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`}
                  onClick={() => setTextStyle((style) => ({ ...style, bold: !style.bold }))}
                >
                  B
                </button>
                <button
                  aria-label="Italic"
                  className={`h-7 w-7 rounded text-xs italic ${textStyle.italic ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`}
                  onClick={() => setTextStyle((style) => ({ ...style, italic: !style.italic }))}
                >
                  I
                </button>
                <input
                  aria-label="Text color"
                  type="color"
                  value={textStyle.color}
                  onChange={(event) => setTextStyle((style) => ({ ...style, color: event.target.value }))}
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                  title="Text color"
                />
              </div>
            )}
            <button className={iconButton + selectedToolClass("pen")} onClick={() => setActiveTool("pen")} disabled={!pdfDocument}><PenLine size={16} /> Pen</button>
            <button className={iconButton + selectedToolClass("highlight")} onClick={() => setActiveTool("highlight")} disabled={!pdfDocument}><Highlighter size={16} /> Highlight</button>
            <button className={iconButton + selectedToolClass("image")} onClick={() => setActiveTool("image")} disabled={!pdfDocument}><ImagePlus size={16} /> Image</button>
            <button className={iconButton + selectedToolClass("redact")} onClick={() => setActiveTool("redact")} disabled={!pdfDocument}><ScanLine size={16} /> Redact</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-start gap-2 border-r border-white/10 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
          <div className="flex items-center">
            <button
              className={iconButton + (ocrRunning ? " bg-emerald-500/10 text-emerald-300" : "")}
              disabled={!pdfDocument || ocrRunning}
              onClick={() => void runOcr()}
              title="Recognize text on image-only pages using the bundled offline OCR engine"
            >
              <ScanText size={16} /> {ocrRunning ? `${Math.round(ocrProgress * 100)}%` : "OCR"}
            </button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.flattenForms()} title="Flatten interactive form fields"><FileCheck2 size={16} /> Forms</button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.optimize()} title="Recompress PDF structure"><Minimize2 size={16} /> Optimize</button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.sanitize()} title="Remove document metadata"><ShieldCheck size={16} /> Sanitize</button>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 flex-col justify-start gap-2 px-2 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">View</span>
          <div className="flex items-center gap-1">
            <button
              className={iconButton + (searchOpen ? " bg-white/10 text-white" : "")}
              disabled={!pdfDocument}
              onClick={() => {
                setSearchOpen((open) => !open);
                window.setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              title="Find in document (Ctrl/Command+F)"
            >
              <Search size={16} /> Find
            </button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.max(0.25, value - 0.1)); setViewMode("custom"); }}><ZoomOut size={16} /></button>
          <input
            aria-label="Zoom"
            type="range"
            min="25"
            max="400"
            value={Math.round(zoom * 100)}
            disabled={!pdfDocument}
            onChange={(event) => { setZoom(Number(event.target.value) / 100); setViewMode("custom"); }}
            className="w-24 accent-orange-500"
          />
          <span className="w-11 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button className={iconButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.min(4, value + 0.1)); setViewMode("custom"); }}><ZoomIn size={16} /></button>
          <button className={iconButton + (viewMode === "fit-width" ? " bg-white/10" : "")} disabled={!pdfDocument} onClick={() => setViewMode("fit-width")}>Fit width</button>
            <button className={iconButton + (viewMode === "fit-page" ? " bg-white/10" : "")} disabled={!pdfDocument} onClick={() => setViewMode("fit-page")}>Fit page</button>
          </div>
        </div>
      </div>

      <div className="relative z-30 flex h-20 w-full shrink-0 items-stretch overflow-visible border-b border-white/10 bg-[#1b1e23] px-1">
        <div className="flex min-w-0 flex-[1_1_0%] flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2 min-[1680px]:hidden">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page Edit</span>
          <div className="flex justify-center">
            <ToolbarDropdown label="Page Edit" tooltip="Open actions for the selected page" tooltipAlign="start" icon={<FilePlus2 size={16} />}>
              <button data-tooltip="Append all pages from another local PDF" data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={() => void mergePdf()}><FilePlus2 size={15} /> Merge PDF</button>
              <button data-tooltip="Export chosen page ranges as a new PDF" data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={() => void splitPdf()}><Scissors size={15} /> Split or extract</button>
              <button data-tooltip="Make a copy of the selected page" data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={duplicateSelectedPage}><Copy size={15} /> Duplicate selected page</button>
              <button data-tooltip="Remove the selected page from the document" data-tooltip-align="start" className={dropdownItem + " text-red-300"} disabled={!documentPrepared || (pdfDocument?.numPages ?? 0) <= 1} onClick={deleteSelectedPage}><Trash2 size={15} /> Delete selected page</button>
            </ToolbarDropdown>
          </div>
        </div>
        <div className="hidden min-w-0 flex-[2.2_1_0%] flex-col gap-2 border-r border-white/10 px-2 pb-1 pt-2 min-[1680px]:flex">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page Edit</span>
          <div className="flex justify-center">
            <button data-tooltip="Append all pages from another local PDF" data-tooltip-align="start" className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void mergePdf()}><FilePlus2 size={16} /> Merge</button>
            <button data-tooltip="Export chosen page ranges as a new PDF" className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void splitPdf()}><Scissors size={16} /> Split</button>
            <button data-tooltip="Make a copy of the selected page" className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={duplicateSelectedPage}><Copy size={16} /> Duplicate</button>
            <button data-tooltip="Remove the selected page from the document" className={iconButton + " toolbar-tooltip text-red-300"} disabled={!documentPrepared || (pdfDocument?.numPages ?? 0) <= 1} onClick={deleteSelectedPage}><Trash2 size={16} /> Delete</button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[1.1_1_0%] flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">History</span>
          <div className="flex justify-center">
            <button className={compactToolButton + " text-sky-300"} data-tooltip="Undo the most recent document change" disabled={!editor.canUndo} onClick={editor.undo}><Undo2 size={16} /><span className="hidden min-[1200px]:inline">Undo</span></button>
            <button className={compactToolButton + " text-sky-300"} data-tooltip="Restore the most recently undone change" disabled={!editor.canRedo} onClick={editor.redo}><Redo2 size={16} /><span className="hidden min-[1200px]:inline">Redo</span></button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[1.1_1_0%] flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">Rotate</span>
          <div className="flex justify-center">
            <button className={compactToolButton + " text-amber-300"} data-tooltip="Rotate the selected page 90 degrees counterclockwise" disabled={!documentPrepared} onClick={() => rotateSelectedPage(-90)}><RotateCcw size={16} /><span className="hidden min-[1200px]:inline">Left</span></button>
            <button className={compactToolButton + " text-amber-300"} data-tooltip="Rotate the selected page 90 degrees clockwise" disabled={!documentPrepared} onClick={() => rotateSelectedPage(90)}><RotateCw size={16} /><span className="hidden min-[1200px]:inline">Right</span></button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[2.4_1_0%] flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-orange-400/80">Markup</span>
          <div className="flex justify-center">
            <button className={compactToolButton + selectedToolClass("select")} data-tooltip="Select, move, resize, or delete an annotation" onClick={() => setActiveTool("select")}><MousePointer2 size={16} /><span className="hidden min-[1400px]:inline">Select</span></button>
            <button className={compactToolButton + selectedToolClass("text")} data-tooltip="Click a page to place and edit a text box" onClick={() => setActiveTool("text")} disabled={!pdfDocument}><Type size={16} /><span className="hidden min-[1400px]:inline">Text</span></button>
            <button className={compactToolButton + selectedToolClass("pen")} data-tooltip="Draw freehand ink on a page" onClick={() => setActiveTool("pen")} disabled={!pdfDocument}><PenLine size={16} /><span className="hidden min-[1400px]:inline">Pen</span></button>
            <button className={compactToolButton + selectedToolClass("highlight")} data-tooltip="Draw a translucent highlight over page content" onClick={() => setActiveTool("highlight")} disabled={!pdfDocument}><Highlighter size={16} /><span className="hidden min-[1400px]:inline">Highlight</span></button>
            <button className={compactToolButton + selectedToolClass("image")} data-tooltip="Click a page to insert a local image or signature" onClick={() => setActiveTool("image")} disabled={!pdfDocument}><ImagePlus size={16} /><span className="hidden min-[1400px]:inline">Image</span></button>
            <button className={compactToolButton + selectedToolClass("redact")} data-tooltip="Drag over content to permanently cover it when exported" onClick={() => setActiveTool("redact")} disabled={!pdfDocument}><ScanLine size={16} /><span className="hidden min-[1400px]:inline">Redact</span></button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[1.1_1_0%] flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2 min-[1680px]:hidden">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
          <div className="flex justify-center">
            <ToolbarDropdown label="Document" tooltip="Open document-wide cleanup and export tools" icon={<FileCheck2 size={16} />}>
              <button data-tooltip="Make form values permanent page content; fields can no longer be edited" className={dropdownItem} disabled={!pdfDocument} onClick={() => void editor.flattenForms()}><FileCheck2 size={15} /> Flatten forms</button>
              <button data-tooltip="Compress PDF structure; images are unchanged, so size may not decrease" className={dropdownItem} disabled={!pdfDocument} onClick={() => void editor.optimize()}><Minimize2 size={15} /> Optimize PDF</button>
              <button data-tooltip="Clear basic metadata only; attachments, scripts, layers, and comments may remain" className={dropdownItem} disabled={!pdfDocument} onClick={() => void editor.sanitize()}><ShieldCheck size={15} /> Sanitize metadata</button>
            </ToolbarDropdown>
          </div>
        </div>
        <div className="hidden min-w-0 flex-[2_1_0%] flex-col gap-2 border-r border-white/10 px-2 pb-1 pt-2 min-[1680px]:flex">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
          <div className="flex justify-center">
            <button className={iconButton + " toolbar-tooltip"} disabled={!pdfDocument} onClick={() => void editor.flattenForms()} data-tooltip="Make form values permanent page content; fields can no longer be edited"><FileCheck2 size={16} /> Flatten Forms</button>
            <button className={iconButton + " toolbar-tooltip"} disabled={!pdfDocument} onClick={() => void editor.optimize()} data-tooltip="Compress PDF structure; images are unchanged, so size may not decrease"><Minimize2 size={16} /> Optimize</button>
            <button className={iconButton + " toolbar-tooltip"} disabled={!pdfDocument} onClick={() => void editor.sanitize()} data-tooltip="Clear basic metadata only; attachments, scripts, layers, and comments may remain"><ShieldCheck size={16} /> Sanitize</button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[2.1_1_0%] flex-col gap-2 px-1.5 pb-1 pt-2">
          <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">View</span>
          <div className="flex items-center justify-center gap-0.5">
            <button className={compactToolButton + (searchOpen ? " bg-white/10 text-white" : "")} disabled={!pdfDocument} onClick={toggleSearch} data-tooltip="Search prepared text; image-only pages are OCR-processed in the background (Ctrl/Command+F)" data-tooltip-align="end"><Search size={16} /><span className="hidden min-[1200px]:inline">Find</span></button>
            <button className={compactToolButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.max(0.25, value - 0.1)); setViewMode("custom"); }} data-tooltip="Decrease document zoom by 10%" data-tooltip-align="end"><ZoomOut size={16} /></button>
            <label className="flex h-8 items-center rounded border border-white/10 bg-black/15 px-1 text-xs text-zinc-400">
              <input aria-label="Zoom percentage" type="number" min="25" max="400" value={Math.round(zoom * 100)} disabled={!pdfDocument} onChange={(event) => { setZoom(Math.min(4, Math.max(0.25, Number(event.target.value) / 100))); setViewMode("custom"); }} className="w-9 bg-transparent text-right text-xs text-zinc-300 outline-none" />%
            </label>
            <button className={compactToolButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.min(4, value + 0.1)); setViewMode("custom"); }} data-tooltip="Increase document zoom by 10%" data-tooltip-align="end"><ZoomIn size={16} /></button>
            <ToolbarDropdown label="Fit" tooltip="Choose how pages scale within the workspace" tooltipAlign="end" icon={<Minimize2 size={16} />} className="[&_div]:left-auto [&_div]:right-0">
              <button data-tooltip="Scale the current page to the available workspace width" data-tooltip-align="end" className={dropdownItem + (viewMode === "fit-width" ? " bg-white/10 text-white" : "")} disabled={!pdfDocument} onClick={() => setViewMode("fit-width")}><Minimize2 size={15} /> Fit to width</button>
              <button data-tooltip="Scale the current page to fit entirely within the workspace" data-tooltip-align="end" className={dropdownItem + (viewMode === "fit-page" ? " bg-white/10 text-white" : "")} disabled={!pdfDocument} onClick={() => setViewMode("fit-page")}><FileCheck2 size={15} /> Fit entire page</button>
            </ToolbarDropdown>
          </div>
        </div>
      </div>

      {activeTool === "text" && pdfDocument && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-orange-500/15 bg-[#202329] px-3">
          <Type size={15} className="text-orange-300" />
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-orange-300/70">Text</span>
          <select aria-label="Text font" value={textStyle.fontFamily} onChange={(event) => setTextStyle((style) => ({ ...style, fontFamily: event.target.value as TextStyle["fontFamily"] }))} className="h-7 rounded border border-white/10 bg-[#24272d] px-2 text-xs text-zinc-200">
            <option value="helvetica">Arial</option><option value="times">Times</option><option value="courier">Courier</option>
          </select>
          <input aria-label="Text size" type="number" min="6" max="96" value={textStyle.size} onChange={(event) => setTextStyle((style) => ({ ...style, size: Math.min(96, Math.max(6, Number(event.target.value) || 6)) }))} className="h-7 w-12 rounded border border-white/10 bg-[#24272d] px-1 text-xs text-zinc-200" />
          <button aria-label="Bold" className={`h-7 w-7 rounded text-xs font-bold ${textStyle.bold ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`} onClick={() => setTextStyle((style) => ({ ...style, bold: !style.bold }))}>B</button>
          <button aria-label="Italic" className={`h-7 w-7 rounded text-xs italic ${textStyle.italic ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`} onClick={() => setTextStyle((style) => ({ ...style, italic: !style.italic }))}>I</button>
          <input aria-label="Text color" type="color" value={textStyle.color} onChange={(event) => setTextStyle((style) => ({ ...style, color: event.target.value }))} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
          <span className="ml-1 text-[11px] text-zinc-500">Click anywhere on the page to type</span>
        </div>
      )}

      {searchOpen && (
        <div className="flex h-11 shrink-0 items-center justify-end gap-1.5 border-b border-white/10 bg-[#202329] px-3 shadow-md">
          <Search size={15} className="text-zinc-500" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Find in document"
            placeholder="Find in document"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") moveSearchResult(event.shiftKey ? -1 : 1);
              if (event.key === "Escape") setSearchOpen(false);
            }}
            className="h-8 w-64 rounded-md border border-white/10 bg-[#17191e] px-2.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/60"
          />
          <span className="min-w-16 text-center text-[11px] text-zinc-500">
            {searchQuery.trim()
              ? searchResults.length
                ? `${searchResultIndex + 1} of ${searchResults.length}`
                : ocrRunning
                  ? "OCR…"
                  : "No results"
              : `${extractedPageCount}/${pages.length} pages`}
          </span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
            disabled={!searchResults.length}
            onClick={() => moveSearchResult(-1)}
            title="Previous result (Shift+Enter)"
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
            disabled={!searchResults.length}
            onClick={() => moveSearchResult(1)}
            title="Next result (Enter)"
          >
            <ChevronDown size={16} />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={() => setSearchOpen(false)}
            title="Close find"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {(ocrRunning || ocrStatus) && (
        <div
          role="status"
          aria-label="Background OCR status"
          className="relative flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b border-emerald-500/10 bg-emerald-950/20 px-3"
        >
          <ScanText size={14} className="shrink-0 text-emerald-400" />
          <span className="truncate text-[11px] text-emerald-200/80">{ocrStatus}</span>
          <button
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-300/60 hover:bg-white/10 hover:text-emerald-200"
            onClick={ocrRunning ? cancelOcr : () => setOcrStatus("")}
            title={ocrRunning ? "Cancel OCR" : "Dismiss OCR status"}
          >
            <X size={14} />
          </button>
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-emerald-400 transition-[width] duration-200"
            style={{ width: `${Math.round(ocrProgress * 100)}%` }}
          />
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-panel">
            <div className="grid grid-cols-2 border-b border-white/10">
              <button className={`flex h-10 items-center justify-center gap-1.5 text-xs ${sidebarTab === "pages" ? "border-b-2 border-accent text-white" : "text-zinc-500"}`} onClick={() => setSidebarTab("pages")}><FilePlus2 size={14} /> Pages</button>
              <button className={`flex h-10 items-center justify-center gap-1.5 text-xs ${sidebarTab === "bookmarks" ? "border-b-2 border-accent text-white" : "text-zinc-500"}`} onClick={() => setSidebarTab("bookmarks")}><BookOpen size={14} /> Bookmarks</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {sidebarTab === "pages" ? (
                <div className="space-y-2">
                  {pages.map((page) => <Thumbnail key={page.pageNumber} page={page} selected={selectedPage === page.pageNumber} reorderEnabled={documentPrepared} onClick={() => jumpToPage(page.pageNumber)} onMove={(from, to) => {
                    if (!documentPrepared) return;
                    void editor.reorder(from, to);
                    setSelectedPage(to);
                    setCurrentPage(to);
                  }} />)}
                </div>
              ) : (
                <p className="p-3 text-center text-xs leading-5 text-zinc-500">Bookmarks will appear here when the document contains an outline.</p>
              )}
            </div>
          </aside>
        )}

        <section className="relative flex min-w-0 flex-1 flex-col bg-[#30343b]">
          {!pdfDocument && !busy ? (
            <button onClick={openPdf} className="m-auto flex max-w-md flex-col items-center rounded-2xl border border-dashed border-zinc-500 px-16 py-14 text-zinc-300 transition hover:border-accent hover:bg-white/5">
              <FolderOpen size={42} strokeWidth={1.4} className="mb-4 text-zinc-400" />
              <span className="text-base font-semibold">Open a PDF</span>
              <span className="mt-2 text-sm text-zinc-500">or drag and drop a local file</span>
              <span className="mt-5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-400">100% local · never uploaded</span>
            </button>
          ) : (
            <div ref={workspaceRef} className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto p-8">
              {pages.map((page) => (
                <PageCanvas
                  key={page.pageNumber}
                  page={page}
                  scale={zoom}
                  onVisible={setCurrentPage}
                  annotations={editor.annotations.filter((annotation) => annotation.page === page.pageNumber)}
                  activeTool={activeTool}
                  onAddAnnotation={editor.addAnnotation}
                  textStyle={textStyle}
                  penStyle={preferences.penStyle}
                  highlightStyle={preferences.highlightStyle}
                  searchMatches={searchResults.filter((match) => match.page === page.pageNumber)}
                  activeSearchMatchId={searchResults[searchResultIndex]?.id ?? null}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelectAnnotation={setSelectedAnnotationId}
                  onUpdateAnnotation={editor.updateAnnotation}
                  onRemoveAnnotation={editor.removeAnnotation}
                />
              ))}
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#252930]/85 backdrop-blur-sm">
              <div
                className="w-[min(24rem,calc(100%_-_3rem))] rounded-2xl border border-white/10 bg-panel px-6 py-5 shadow-2xl"
                role="status"
                aria-label="Document loading status"
                aria-live="polite"
              >
                <div className="flex items-center gap-3">
                  <LoaderCircle size={22} className="shrink-0 animate-spin text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Opening document</p>
                    <p className="mt-1 truncate text-xs text-zinc-400">{loadingStage}</p>
                  </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.max(4, Math.round(loadingProgress * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          )}
          {!busy && pdfDocument && preparedPageCount < pdfDocument.numPages && (
            <div
              className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-panel/95 px-3 py-2 text-xs text-zinc-300 shadow-lg backdrop-blur"
              role="status"
              aria-label="Page preparation status"
            >
              <LoaderCircle size={14} className="animate-spin text-accent" />
              Preparing pages {preparedPageCount} of {pdfDocument.numPages}
            </div>
          )}
          {searchOpen && searchResults.length > 0 && (
            <div className="pointer-events-none absolute bottom-2 right-1 top-2 z-20 w-2 rounded-full bg-black/15">
              {searchResults.map((match, index) => {
                const active = index === searchResultIndex;
                const position = ((match.page - 1 + match.y) / Math.max(pages.length, 1)) * 100;
                return (
                  <button
                    key={match.id}
                    aria-label={`Search result ${index + 1} on page ${match.page}`}
                    className={`pointer-events-auto absolute right-0 h-1.5 w-2 -translate-y-1/2 rounded-full shadow-sm transition ${active ? "z-10 bg-red-500 ring-1 ring-red-200" : "bg-yellow-300 hover:bg-yellow-200"}`}
                    style={{ top: `${position}%` }}
                    onClick={() => focusSearchResult(index)}
                    title={`Result ${index + 1} · page ${match.page}`}
                  />
                );
              })}
            </div>
          )}
          {pdfDocument && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-lg border border-white/10 bg-panel/95 px-2 py-1 shadow-xl backdrop-blur">
              <button className={iconButton + " pointer-events-auto"} disabled={currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)}><ChevronLeft size={16} /></button>
              <span className="min-w-20 text-center text-xs text-zinc-300">{currentPage} / {pdfDocument.numPages}</span>
              <button className={iconButton + " pointer-events-auto"} disabled={currentPage >= pages.length} onClick={() => jumpToPage(currentPage + 1)}><ChevronRight size={16} /></button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
