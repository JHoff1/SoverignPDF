import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Copy,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileCheck2,
  FilePlus2,
  FolderOpen,
  Highlighter,
  ImagePlus,
  Menu,
  Minimize2,
  MousePointer2,
  PenLine,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  Redo2,
  ScanLine,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "@tauri-apps/api/core";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import {
  useDocumentEditor,
  type Annotation,
  type Point
} from "./editor/useDocumentEditor";

GlobalWorkerOptions.workerSrc = pdfWorker;

type ViewMode = "fit-width" | "fit-page" | "custom";
type Tool = "select" | "text" | "pen" | "highlight" | "image" | "redact";

const iconButton =
  "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

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
  onAddAnnotation
}: {
  page: PDFPageProxy;
  scale: number;
  onVisible: (page: number) => void;
  annotations: Annotation[];
  activeTool: Tool;
  onAddAnnotation: (annotation: Annotation) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Point[]>([]);

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
    if (!canvas) return;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    });
    return () => task.cancel();
  }, [page, scale]);

  return (
    <div
      ref={hostRef}
      id={`page-${page.pageNumber}`}
      className="relative shrink-0 bg-white shadow-2xl"
      aria-label={`Page ${page.pageNumber}`}
    >
      <canvas ref={canvasRef} className="block" />
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
          if (activeTool === "text") {
            const text = window.prompt("Text to add");
            if (text) onAddAnnotation({
              id: crypto.randomUUID(), kind: "text", page: page.pageNumber,
              ...point, text, size: 18, color: "#202124"
            });
          } else if (activeTool === "pen" || activeTool === "highlight" || activeTool === "redact") {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraft([point]);
          } else if (activeTool === "image") {
            window.dispatchEvent(new CustomEvent("sovereign:add-image", {
              detail: { page: page.pageNumber, ...point }
            }));
          }
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
              id: crypto.randomUUID(),
              kind: activeTool,
              page: page.pageNumber,
              points: draft,
              color: activeTool === "highlight" ? "#ffe45c" : "#df5b43",
              width: activeTool === "highlight" ? 16 : 2,
              opacity: activeTool === "highlight" ? 0.35 : 1
            });
          } else if (draft.length > 1 && activeTool === "redact") {
            const first = draft[0];
            const last = draft[draft.length - 1];
            onAddAnnotation({
              id: crypto.randomUUID(),
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
          if (annotation.kind === "text") {
            return <text key={annotation.id} x={annotation.x} y={annotation.y} fontSize={annotation.size / 800} fill={annotation.color}>{annotation.text}</text>;
          }
          if (annotation.kind === "pen" || annotation.kind === "highlight") {
            return <polyline key={annotation.id} points={annotation.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={annotation.color} strokeWidth={annotation.width / 800} opacity={annotation.opacity} strokeLinecap="round" strokeLinejoin="round" />;
          }
          if (annotation.kind === "image") {
            return <image key={annotation.id} href={annotation.dataUrl} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
          }
          return <rect key={annotation.id} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} fill="black" />;
        })}
        {draft.length > 1 && activeTool !== "redact" && <polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={activeTool === "highlight" ? "#ffe45c" : "#df5b43"} strokeWidth={(activeTool === "highlight" ? 16 : 2) / 800} opacity={activeTool === "highlight" ? 0.35 : 1} strokeLinecap="round" />}
        {draft.length > 1 && activeTool === "redact" && <rect x={Math.min(draft[0].x, draft[draft.length - 1].x)} y={Math.min(draft[0].y, draft[draft.length - 1].y)} width={Math.abs(draft[draft.length - 1].x - draft[0].x)} height={Math.abs(draft[draft.length - 1].y - draft[0].y)} fill="black" opacity="0.8" />}
      </svg>
    </div>
  );
}

function Thumbnail({
  page,
  selected,
  onClick,
  onMove
}: {
  page: PDFPageProxy;
  selected: boolean;
  onClick: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const raw = page.getViewport({ scale: 1 });
    const scale = 112 / raw.width;
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvasContext: context, viewport });
    return () => task.cancel();
  }, [page]);

  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/page", String(page.pageNumber))}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData("text/page"));
        if (from) onMove(from, page.pageNumber);
      }}
      className={`group w-full rounded-lg border p-2 transition ${
        selected
          ? "border-accent bg-accent/10"
          : "border-transparent hover:border-zinc-600 hover:bg-white/5"
      }`}
    >
      <canvas ref={ref} className="mx-auto block bg-white shadow-md" />
      <span className="mt-2 block text-center text-xs text-zinc-400">
        {page.pageNumber}
      </span>
    </button>
  );
}

export default function App() {
  const editor = useDocumentEditor();
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [fileName, setFileName] = useState("No document open");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPage, setSelectedPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("fit-width");
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [sidebarTab, setSidebarTab] = useState<"pages" | "bookmarks">("pages");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browserFileInput = useRef<HTMLInputElement>(null);
  const mergeFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const pendingImage = useRef<{ page: number; x: number; y: number } | null>(null);
  const lastRenderedBytes = useRef<Uint8Array | null>(null);

  const renderPdf = useCallback(async (data: Uint8Array) => {
    setBusy(true);
    setError(null);
    try {
      const nextDocument = await getDocument({ data: cloneForPdfJs(data) }).promise;
      const nextPages = await Promise.all(
        Array.from({ length: nextDocument.numPages }, (_, index) =>
          nextDocument.getPage(index + 1)
        )
      );
      setPdfDocument((previous) => {
        previous?.destroy();
        return nextDocument;
      });
      setPages(nextPages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open this PDF.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!editor.bytes || editor.bytes === lastRenderedBytes.current) return;
    lastRenderedBytes.current = editor.bytes;
    void renderPdf(editor.bytes);
  }, [editor.bytes, renderPdf]);

  const loadPdf = useCallback((data: ArrayBuffer, name: string, path: string | null = null) => {
    editor.load(new Uint8Array(data));
    setFileName(name);
    setSourcePath(path);
    setCurrentPage(1);
    setSelectedPage(1);
  }, [editor]);

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
    loadPdf(await readLocalPdf(path), baseName(path), path);
  }, [loadPdf]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths.find((item) =>
          item.toLowerCase().endsWith(".pdf")
        );
        if (path) loadPdf(await readLocalPdf(path), baseName(path), path);
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // Browser-only Vite preview: native drag/drop events are unavailable.
      });
    return () => unlisten?.();
  }, [loadPdf]);

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
    if (!pages.length) return;
    setSelectedPage((page) => Math.min(Math.max(1, page), pages.length));
    setCurrentPage((page) => Math.min(Math.max(1, page), pages.length));
  }, [pages.length]);

  const jumpToPage = useCallback((pageNumber: number) => {
    window.document
      .getElementById(`page-${pageNumber}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(pageNumber);
    setSelectedPage(pageNumber);
  }, []);

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

  const savePdf = useCallback(async (forceSaveAs = false) => {
    const flattened = await editor.flattened();
    if (!flattened) return;
    const bytes = editor.annotations.some((item) => item.kind === "redaction")
      ? await rasterizeForSecureRedaction(flattened)
      : flattened;
    if (!isTauri()) {
      downloadBytes(bytes, fileName);
      return;
    }
    let path = forceSaveAs ? null : sourcePath;
    if (!path) {
      path = await save({
        defaultPath: fileName,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }]
      });
    }
    if (!path) return;
    await writeFile(path, bytes);
    setSourcePath(path);
    setFileName(baseName(path));
  }, [downloadBytes, editor, fileName, sourcePath]);

  const mergePdf = useCallback(async () => {
    if (!isTauri()) {
      mergeFileInput.current?.click();
      return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (typeof path === "string") {
      await editor.merge(new Uint8Array(await readLocalPdf(path)));
    }
  }, [editor]);

  const splitPdf = useCallback(async () => {
    if (!pages.length) return;
    const answer = window.prompt(
      `Pages to extract (example: 1-3,5). This document has ${pages.length} pages.`
    );
    if (!answer) return;
    const selected = new Set<number>();
    for (const part of answer.split(",")) {
      const [start, end = start] = part.trim().split("-").map(Number);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      for (let page = Math.max(1, start); page <= Math.min(pages.length, end); page += 1) {
        selected.add(page);
      }
    }
    const bytes = await editor.extract([...selected].sort((a, b) => a - b));
    if (!bytes) return;
    const name = fileName.replace(/\.pdf$/i, "") + "-extract.pdf";
    if (!isTauri()) {
      downloadBytes(bytes, name);
      return;
    }
    const path = await save({
      defaultPath: name,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (path) await writeFile(path, bytes);
  }, [downloadBytes, editor, fileName, pages.length]);

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
          void file.arrayBuffer().then((data) => loadPdf(data, file.name));
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
          if (file) void file.arrayBuffer().then((data) => editor.merge(new Uint8Array(data)));
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
            reader.onload = () => editor.addAnnotation({
              id: crypto.randomUUID(),
              kind: "image",
              ...placement,
              width: 0.24,
              height: 0.12,
              dataUrl: String(reader.result)
            });
            reader.readAsDataURL(file);
          }
          pendingImage.current = null;
          event.currentTarget.value = "";
        }}
      />
      <header className="flex h-12 shrink-0 items-center border-b border-white/10 bg-panel px-3">
        <button className={iconButton} onClick={() => setSidebarOpen((value) => !value)}>
          <Menu size={17} />
        </button>
        <div className="ml-2 min-w-0">
          <div className="truncate text-sm font-semibold">{fileName}</div>
          <div className={`truncate text-[10px] ${error ? "text-red-400" : "text-zinc-500"}`}>
            {status}
          </div>
        </div>
        <div className="ml-auto flex items-center">
          <button className={iconButton} onClick={openPdf}>
            <FolderOpen size={16} /> Open
          </button>
          <button className={iconButton} disabled={!pdfDocument} onClick={() => void savePdf(false)}>
            <Save size={16} /> Save
          </button>
          <button className={iconButton} disabled={!pdfDocument} onClick={() => void savePdf(true)}>
            <FileDown size={16} /> Save As
          </button>
        </div>
      </header>

      <div className="flex h-16 shrink-0 items-stretch overflow-x-auto border-b border-white/10 bg-[#1b1e23] px-2">
        <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/10 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Edit</span>
          <div className="flex items-center">
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void mergePdf()}><FilePlus2 size={16} /> Merge</button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void splitPdf()}><Scissors size={16} /> Split</button>
            <button className={iconButton} title={`Duplicate selected page ${selectedPage}`} disabled={!pdfDocument} onClick={() => void editor.duplicate(selectedPage)}><Copy size={16} /> Duplicate</button>
            <button
              className={iconButton + " text-red-300 hover:bg-red-400/10 hover:text-red-200"}
              title={`Delete selected page ${selectedPage}`}
              disabled={!pdfDocument || pages.length <= 1}
              onClick={() => {
                const nextSelection = Math.min(selectedPage, pages.length - 1);
                void editor.remove(selectedPage);
                setSelectedPage(nextSelection);
                setCurrentPage(nextSelection);
              }}
            ><Trash2 size={16} /> Delete</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/10 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">History</span>
          <div className="flex items-center">
            <button className={iconButton + " text-sky-300 hover:bg-sky-400/10 hover:text-sky-200"} title="Undo last edit" disabled={!editor.canUndo} onClick={editor.undo}><Undo2 size={16} /> Undo</button>
            <button className={iconButton + " text-sky-300 hover:bg-sky-400/10 hover:text-sky-200"} title="Redo last edit" disabled={!editor.canRedo} onClick={editor.redo}><Redo2 size={16} /> Redo</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/10 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">Rotate · Page {selectedPage}</span>
          <div className="flex items-center">
            <button className={iconButton + " text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"} title={`Rotate selected page ${selectedPage} left`} disabled={!pdfDocument} onClick={() => void editor.rotate(selectedPage, -90)}><RotateCcw size={16} /> Left</button>
            <button className={iconButton + " text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"} title={`Rotate selected page ${selectedPage} right`} disabled={!pdfDocument} onClick={() => void editor.rotate(selectedPage, 90)}><RotateCw size={16} /> Right</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/10 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-orange-400/80">Markup</span>
          <div className="flex items-center">
            <button className={iconButton + selectedToolClass("select")} onClick={() => setActiveTool("select")}><MousePointer2 size={16} /> Select</button>
            <button className={iconButton + selectedToolClass("text")} onClick={() => setActiveTool("text")} disabled={!pdfDocument}><Type size={16} /> Text</button>
            <button className={iconButton + selectedToolClass("pen")} onClick={() => setActiveTool("pen")} disabled={!pdfDocument}><PenLine size={16} /> Pen</button>
            <button className={iconButton + selectedToolClass("highlight")} onClick={() => setActiveTool("highlight")} disabled={!pdfDocument}><Highlighter size={16} /> Highlight</button>
            <button className={iconButton + selectedToolClass("image")} onClick={() => setActiveTool("image")} disabled={!pdfDocument}><ImagePlus size={16} /> Image</button>
            <button className={iconButton + selectedToolClass("redact")} onClick={() => setActiveTool("redact")} disabled={!pdfDocument}><ScanLine size={16} /> Redact</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/10 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
          <div className="flex items-center">
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.flattenForms()} title="Flatten interactive form fields"><FileCheck2 size={16} /> Forms</button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.optimize()} title="Recompress PDF structure"><Minimize2 size={16} /> Optimize</button>
            <button className={iconButton} disabled={!pdfDocument} onClick={() => void editor.sanitize()} title="Remove document metadata"><ShieldCheck size={16} /> Sanitize</button>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 flex-col justify-center gap-1.5 px-2">
          <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">View</span>
          <div className="flex items-center gap-1">
            <button className={iconButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.max(0.25, value - 0.1)); setViewMode("custom"); }}><ZoomOut size={16} /></button>
          <input
            aria-label="Zoom"
            type="range"
            min="25"
            max="250"
            value={Math.round(zoom * 100)}
            disabled={!pdfDocument}
            onChange={(event) => { setZoom(Number(event.target.value) / 100); setViewMode("custom"); }}
            className="w-24 accent-orange-500"
          />
          <span className="w-11 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button className={iconButton} disabled={!pdfDocument} onClick={() => { setZoom((value) => Math.min(2.5, value + 0.1)); setViewMode("custom"); }}><ZoomIn size={16} /></button>
          <button className={iconButton + (viewMode === "fit-width" ? " bg-white/10" : "")} disabled={!pdfDocument} onClick={() => { setZoom(1); setViewMode("fit-width"); }}>Fit width</button>
            <button className={iconButton + (viewMode === "fit-page" ? " bg-white/10" : "")} disabled={!pdfDocument} onClick={() => { setZoom(0.75); setViewMode("fit-page"); }}>Fit page</button>
          </div>
        </div>
      </div>

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
                  {pages.map((page) => <Thumbnail key={page.pageNumber} page={page} selected={selectedPage === page.pageNumber} onClick={() => jumpToPage(page.pageNumber)} onMove={(from, to) => { void editor.reorder(from, to); setSelectedPage(to); }} />)}
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
            <div className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto p-8">
              {pages.map((page) => <PageCanvas key={page.pageNumber} page={page} scale={zoom} onVisible={setCurrentPage} annotations={editor.annotations.filter((annotation) => annotation.page === page.pageNumber)} activeTool={activeTool} onAddAnnotation={editor.addAnnotation} />)}
            </div>
          )}
          {pdfDocument && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-lg border border-white/10 bg-panel/95 px-2 py-1 shadow-xl backdrop-blur">
              <button className={iconButton + " pointer-events-auto"} disabled={currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)}><ChevronLeft size={16} /></button>
              <span className="min-w-20 text-center text-xs text-zinc-300">{currentPage} / {pages.length}</span>
              <button className={iconButton + " pointer-events-auto"} disabled={currentPage >= pages.length} onClick={() => jumpToPage(currentPage + 1)}><ChevronRight size={16} /></button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
