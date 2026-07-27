import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FilePlus2,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Menu,
  Printer,
  Save,
  Settings,
  Type,
  X
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  PhysicalPosition,
  PhysicalSize,
  getCurrentWindow
} from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  GlobalWorkerOptions,
  PasswordResponses,
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
import {
  clearRecovery,
  readRecovery,
  saveRecovery,
  type RecoverySnapshot
} from "./recoveryStore";
import { iconButton } from "./components/ToolbarDropdown";
import {
  printPdfPages,
  type PrintOrientation
} from "./printDocument";
import { OcrStatus, SearchPanel } from "./components/SearchPanels";
import { PrintDialog } from "./components/PrintDialog";
import { PageThumbnail } from "./components/PageThumbnail";
import { SelectedAnnotationToolbar } from "./components/SelectedAnnotationToolbar";
import { VirtualizedPdfPage } from "./components/VirtualizedPdfPage";
import { EditorToolbar } from "./components/EditorToolbar";
import { PdfPageCanvas } from "./components/PdfPageCanvas";
import {
  PreferencesDialog,
  type DesktopPlatform
} from "./components/PreferencesDialog";
import {
  OverwriteDialog,
  PasswordDialog,
  RecoveryDialog,
  SaveNameDialog,
  SplitRangeDialog,
  UnsavedCloseDialog
} from "./components/DocumentDialogs";
import type {
  SearchMatch,
  SearchSpan,
  Tool,
  ViewMode
} from "./editorUiTypes";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  loadPreferences,
  type AppPreferences
} from "./preferences";
import { StatusBar } from "./components/StatusBar";
import { ShortcutsDialog } from "./components/ShortcutsDialog";

GlobalWorkerOptions.workerSrc = pdfWorker;

const WINDOW_BOUNDS_KEY = "sovereignpdf.window-bounds.v1";

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function cloneForPdfJs(bytes: Uint8Array) {
  return new Uint8Array(bytes).buffer;
}

async function readLocalPdf(path: string) {
  const bytes = await readFile(path);
  return bytes.slice().buffer;
}

async function writeLocalPdfAtomically(
  path: string,
  bytes: Uint8Array,
  approvedPath?: string
) {
  const temporaryPath = await invoke<string>("prepare_atomic_pdf_write", {
    path,
    approvedPath
  });
  try {
    await writeFile(temporaryPath, bytes);
    await invoke("finish_atomic_pdf_write", { temporaryPath, path });
  } catch (cause) {
    await invoke("cancel_atomic_pdf_write", { temporaryPath }).catch(() => undefined);
    throw cause;
  }
}

async function rasterizeForSecureRedaction(
  bytes: Uint8Array,
  redactedPages: Set<number>
) {
  const source = await getDocument({ data: cloneForPdfJs(bytes) }).promise;
  const editableSource = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    if (!redactedPages.has(pageNumber)) {
      const [copiedPage] = await output.copyPages(editableSource, [pageNumber - 1]);
      output.addPage(copiedPage);
      continue;
    }
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
  const [zoom, setZoom] = useState(preferences.zoom);
  const [viewMode, setViewMode] = useState<ViewMode>(preferences.viewMode);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>(preferences.textStyle);
  const [sidebarTab, setSidebarTab] = useState<"pages" | "bookmarks">("pages");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(preferences.sidebarWidth);
  const [propertiesWidth, setPropertiesWidth] = useState(preferences.propertiesWidth);
  const [renderingPages, setRenderingPages] = useState<Set<number>>(() => new Set());
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingStage, setLoadingStage] = useState("Opening document…");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [preparedPageCount, setPreparedPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<"preferences" | "shortcuts" | "save" | "overwrite" | "split" | "split-save" | "print" | "password" | "unsaved-close" | "recovery" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveForceAs, setSaveForceAs] = useState(false);
  const [splitRanges, setSplitRanges] = useState("");
  const [splitError, setSplitError] = useState("");
  const [printRanges, setPrintRanges] = useState("");
  const [printError, setPrintError] = useState("");
  const [printOrientation, setPrintOrientation] = useState<PrintOrientation>("portrait");
  const [pendingSplitBytes, setPendingSplitBytes] = useState<Uint8Array | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [preferenceStatus, setPreferenceStatus] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordIncorrect, setPasswordIncorrect] = useState(false);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null);
  const browserFileInput = useRef<HTMLInputElement>(null);
  const mergeFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const pendingImage = useRef<{ page: number; x: number; y: number } | null>(null);
  const lastRenderedBytes = useRef<Uint8Array | null>(null);
  const renderGeneration = useRef(0);
  const passwordUpdater = useRef<((password: string) => void) | null>(null);
  const passwordLoadingTask = useRef<ReturnType<typeof getDocument> | null>(null);
  const allowWindowClose = useRef(false);
  const dirtyRef = useRef(false);
  const ocrAttemptedBytes = useRef<Uint8Array | null>(null);
  const ocrWorker = useRef<TesseractWorker | null>(null);
  const ocrCancelRequested = useRef(false);
  const desktopPlatform = useMemo<DesktopPlatform>(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("windows")) return "windows";
    if (userAgent.includes("mac os")) return "macos";
    if (userAgent.includes("linux")) return "linux";
    return "unknown";
  }, []);
  const documentPrepared = Boolean(
    !passwordProtected &&
    pdfDocument &&
    pages.length === pdfDocument.numPages &&
    preparedPageCount === pdfDocument.numPages
  );
  const selectedAnnotation = useMemo(
    () => editor.annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null,
    [editor.annotations, selectedAnnotationId]
  );
  const recoveryId = useMemo(
    () => isTauri() ? getCurrentWebview().label : "browser-main",
    []
  );

  useEffect(() => {
    dirtyRef.current = editor.isDirty;
  }, [editor.isDirty]);

  useEffect(() => {
    let cancelled = false;
    void readRecovery(recoveryId).then((snapshot) => {
      if (cancelled || !snapshot || editor.bytes) return;
      setPendingRecovery(snapshot);
      setActiveDialog("recovery");
    }).catch(() => {
      // Recovery is best-effort and must never prevent the editor from opening.
    });
    return () => {
      cancelled = true;
    };
  }, [editor.bytes, recoveryId]);

  useEffect(() => {
    if (!editor.isDirty || !editor.bytes) return;
    const timeout = window.setTimeout(() => {
      const bytes = new Uint8Array(editor.bytes!);
      void saveRecovery({
        id: recoveryId,
        fileName,
        sourcePath,
        bytes: bytes.buffer,
        annotations: clonePlain(editor.annotations),
        updatedAt: Date.now()
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    editor.annotations,
    editor.bytes,
    editor.isDirty,
    fileName,
    recoveryId,
    sourcePath
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || allowWindowClose.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    if (!isTauri()) {
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWindow().onCloseRequested((event) => {
      if (!dirtyRef.current || allowWindowClose.current) return;
      event.preventDefault();
      setActiveDialog("unsaved-close");
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      dispose = unlisten;
    });
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      dispose?.();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      const nextTheme = preferences.theme === "system"
        ? media.matches ? "light" : "dark"
        : preferences.theme;
      setResolvedTheme(nextTheme);
      window.document.documentElement.dataset.theme = nextTheme;
      window.document.documentElement.style.colorScheme = nextTheme;
      if (isTauri()) {
        void getCurrentWindow().setTheme(nextTheme).catch(() => undefined);
      }
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [preferences.theme]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPreferences((current) => ({
        ...current,
        zoom,
        viewMode,
        sidebarWidth,
        propertiesWidth
      }));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [propertiesWidth, sidebarWidth, viewMode, zoom]);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let movedUnlisten: (() => void) | undefined;
    let resizedUnlisten: (() => void) | undefined;
    let saveTimer = 0;
    const persistBounds = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        void Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
          appWindow.isMaximized()
        ]).then(([position, size, maximized]) => {
          window.localStorage.setItem(WINDOW_BOUNDS_KEY, JSON.stringify({
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized
          }));
        }).catch(() => undefined);
      }, 350);
    };
    void (async () => {
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(WINDOW_BOUNDS_KEY) ?? "null"
        ) as {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          maximized?: boolean;
        } | null;
        if (stored && !stored.maximized) {
          await appWindow.unmaximize();
          if (
            Number.isFinite(stored.width) &&
            Number.isFinite(stored.height)
          ) {
            await appWindow.setSize(new PhysicalSize(
              Math.max(900, stored.width!),
              Math.max(600, stored.height!)
            ));
          }
          if (Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
            await appWindow.setPosition(new PhysicalPosition(stored.x!, stored.y!));
          }
        } else if (stored?.maximized) {
          await appWindow.maximize();
        }
      } catch {
        // Invalid or off-screen historical geometry should never block startup.
      }
      const listeners = await Promise.all([
        appWindow.onMoved(persistBounds),
        appWindow.onResized(persistBounds)
      ]);
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
      } else {
        [movedUnlisten, resizedUnlisten] = listeners;
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(saveTimer);
      movedUnlisten?.();
      resizedUnlisten?.();
    };
  }, []);

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
      const loadingTask = getDocument({ data: cloneForPdfJs(data) });
      passwordLoadingTask.current = loadingTask;
      loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        if (generation !== renderGeneration.current) return;
        passwordUpdater.current = updatePassword;
        setPasswordProtected(true);
        setPasswordIncorrect(reason === PasswordResponses.INCORRECT_PASSWORD);
        setPasswordValue("");
        setBusy(false);
        setActiveDialog("password");
      };
      nextDocument = await loadingTask.promise;
      passwordLoadingTask.current = null;
      passwordUpdater.current = null;
      setActiveDialog((current) => current === "password" ? null : current);
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
    setPasswordProtected(false);
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
    setZoom(preferences.zoom);
    setViewMode(preferences.viewMode);
  }, [editor.load, preferences.viewMode, preferences.zoom]);

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

  const handleRenderingChange = useCallback((pageNumber: number, rendering: boolean) => {
    setRenderingPages((current) => {
      const next = new Set(current);
      if (rendering) next.add(pageNumber);
      else next.delete(pageNumber);
      if (next.size === current.size && [...next].every((page) => current.has(page))) {
        return current;
      }
      return next;
    });
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
      .getElementById(`page-${match.page}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      window.document
        .getElementById(`search-match-${match.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
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

  const downloadBytes = useCallback((bytes: Uint8Array, name: string) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const prepareExportBytes = useCallback(async () => {
    const redactedPages = new Set(
      editor.annotations
        .filter((item) => item.kind === "redaction")
        .map((item) => item.page)
    );
    const hasRedactions = redactedPages.size > 0;
    const shouldFlatten = preferences.flattenAnnotations || hasRedactions;
    const prepared = shouldFlatten ? await editor.flattened() : editor.bytes;
    if (!prepared) return null;
    return hasRedactions
      ? rasterizeForSecureRedaction(prepared, redactedPages)
      : prepared;
  }, [editor, preferences.flattenAnnotations]);

  const savePdf = useCallback(async (
    forceSaveAs = false,
    requestedName = fileName
  ) => {
    if (passwordProtected) {
      setError(
        "This encrypted PDF is open in protected viewing mode. SovereignPDF will not rewrite it because doing so could corrupt its encryption."
      );
      return false;
    }
    setSaving(true);
    try {
      const bytes = await prepareExportBytes();
      if (!bytes) return false;
      if (!isTauri()) {
        downloadBytes(bytes, requestedName);
        setFileName(requestedName);
        editor.markSaved();
        void clearRecovery(recoveryId).catch(() => undefined);
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
          await writeLocalPdfAtomically(backupPath(path), existing, path);
        } catch {
          // A new destination has no existing file to back up.
        }
      }
      await writeLocalPdfAtomically(path, bytes);
      setSourcePath(path);
      setFileName(baseName(path));
      editor.markSaved();
      void clearRecovery(recoveryId).catch(() => undefined);
      return true;
    } finally {
      setSaving(false);
    }
  }, [
    downloadBytes,
    editor,
    fileName,
    passwordProtected,
    preferences,
    prepareExportBytes,
    recoveryId,
    sourcePath
  ]);

  const submitPassword = useCallback(() => {
    if (!passwordValue || !passwordUpdater.current) return;
    const updatePassword = passwordUpdater.current;
    setActiveDialog(null);
    setBusy(true);
    setLoadingStage(passwordIncorrect ? "Trying password again…" : "Unlocking PDF…");
    updatePassword(passwordValue);
    setPasswordValue("");
  }, [passwordIncorrect, passwordValue]);

  const cancelPassword = useCallback(() => {
    renderGeneration.current += 1;
    passwordUpdater.current = null;
    const task = passwordLoadingTask.current;
    passwordLoadingTask.current = null;
    void task?.destroy();
    lastRenderedBytes.current = null;
    editor.clear();
    setPdfDocument(null);
    setPages([]);
    setPreparedPageCount(0);
    setFileName("No document open");
    setSourcePath(null);
    setBusy(false);
    setActiveDialog(null);
    setError("The password-protected PDF was not opened.");
  }, [editor]);

  const recoverUnsavedWork = useCallback(() => {
    if (!pendingRecovery) return;
    editor.restore(
      new Uint8Array(pendingRecovery.bytes),
      pendingRecovery.annotations
    );
    setFileName(pendingRecovery.fileName);
    setSourcePath(pendingRecovery.sourcePath);
    setPendingRecovery(null);
    setActiveDialog(null);
    setSuccessMessage("Your locally recovered unsaved work has been restored.");
  }, [editor, pendingRecovery]);

  const discardRecovery = useCallback(() => {
    void clearRecovery(recoveryId).catch(() => undefined);
    setPendingRecovery(null);
    setActiveDialog(null);
  }, [recoveryId]);

  const requestSave = useCallback((forceSaveAs = false) => {
    if (!forceSaveAs && isTauri() && sourcePath) {
      if (preferences.confirmOverwrite) {
        setActiveDialog("overwrite");
        return;
      }
      void savePdf(false).catch((cause) => {
        setError(errorMessage(cause, "The PDF could not be saved."));
      });
      return;
    }
    setSaveName(fileName);
    setSaveForceAs(forceSaveAs || !sourcePath);
    setActiveDialog("save");
  }, [fileName, preferences.confirmOverwrite, savePdf, sourcePath]);

  const requestPrint = useCallback(() => {
    if (!pdfDocument) return;
    setPrintRanges(`1-${pdfDocument.numPages}`);
    setPrintError("");
    setActiveDialog("print");
  }, [pdfDocument]);

  const confirmPrint = useCallback(async () => {
    if (!pdfDocument) return;
    const parsed = parsePageRanges(printRanges, pdfDocument.numPages);
    if (parsed.error) {
      setPrintError(parsed.error);
      return;
    }
    setDialogBusy(true);
    setPrintError("");
    try {
      if (passwordProtected) {
        await printPdfPages({
          document: pdfDocument,
          pageNumbers: parsed.pages,
          orientation: printOrientation,
          title: fileName
        });
      } else {
        const bytes = await prepareExportBytes();
        if (!bytes) throw new Error("The PDF could not be prepared for printing.");
        await printPdfPages({
          bytes: new Uint8Array(bytes),
          pageNumbers: parsed.pages,
          orientation: printOrientation,
          title: fileName
        });
      }
      setActiveDialog(null);
    } catch (cause) {
      setPrintError(cause instanceof Error ? cause.message : "The PDF could not be printed.");
    } finally {
      setDialogBusy(false);
    }
  }, [
    fileName,
    passwordProtected,
    pdfDocument,
    prepareExportBytes,
    printOrientation,
    printRanges
  ]);

  const closeAfterSaving = useCallback(async () => {
    setDialogBusy(true);
    try {
      const saved = await savePdf(!sourcePath);
      if (!saved) return;
      allowWindowClose.current = true;
      setActiveDialog(null);
      if (isTauri()) await getCurrentWindow().destroy();
    } catch (cause) {
      setError(errorMessage(cause, "The PDF could not be saved, so the window remains open."));
    } finally {
      setDialogBusy(false);
    }
  }, [savePdf, sourcePath]);

  const discardAndClose = useCallback(async () => {
    await clearRecovery(recoveryId).catch(() => undefined);
    allowWindowClose.current = true;
    setActiveDialog(null);
    if (isTauri()) await getCurrentWindow().destroy();
  }, [recoveryId]);

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
    } catch (cause) {
      setError(errorMessage(cause, "The PDF could not be saved."));
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
    } catch (cause) {
      setError(errorMessage(cause, "The PDF could not be saved."));
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
      await writeLocalPdfAtomically(path, pendingSplitBytes);
      setSuccessMessage(
        "Your new document has been saved in the location you selected. Your original document is untouched and remains loaded in SovereignPDF."
      );
      setPendingSplitBytes(null);
      setActiveDialog(null);
    } catch (cause) {
      setError(errorMessage(cause, "The extracted PDF could not be saved."));
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
    window.localStorage.removeItem(WINDOW_BOUNDS_KEY);
    const reset = clonePlain(DEFAULT_PREFERENCES);
    setPreferences(reset);
    setTextStyle(reset.textStyle);
    setZoom(reset.zoom);
    setViewMode(reset.viewMode);
    setSidebarWidth(reset.sidebarWidth);
    setPropertiesWidth(reset.propertiesWidth);
    setPreferenceStatus("Recent file paths and locally stored preferences were cleared.");
  }, []);

  const moveSelectedAnnotation = useCallback((
    annotation: Annotation,
    deltaX: number,
    deltaY: number
  ) => {
    if (annotation.kind === "text") {
      editor.updateAnnotation(annotation.id, {
        x: Math.min(0.98, Math.max(0, annotation.x + deltaX)),
        y: Math.min(0.98, Math.max(0, annotation.y + deltaY))
      }, "Move text");
      return;
    }
    if (annotation.kind === "image" || annotation.kind === "redaction") {
      editor.updateAnnotation(annotation.id, {
        x: Math.min(1 - annotation.width, Math.max(0, annotation.x + deltaX)),
        y: Math.min(1 - annotation.height, Math.max(0, annotation.y + deltaY))
      }, `Move ${annotation.kind}`);
      return;
    }
    const xs = annotation.points.map((point) => point.x);
    const ys = annotation.points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const constrainedX = Math.min(1 - maxX, Math.max(-minX, deltaX));
    const constrainedY = Math.min(1 - maxY, Math.max(-minY, deltaY));
    editor.updateAnnotation(annotation.id, {
      points: annotation.points.map((point) => ({
        x: point.x + constrainedX,
        y: point.y + constrainedY
      }))
    }, `Move ${annotation.kind}`);
  }, [editor]);

  const startPanelResize = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    panel: "sidebar" | "properties"
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? sidebarWidth : propertiesWidth;
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const width = panel === "sidebar"
        ? startWidth + delta
        : startWidth - delta;
      if (panel === "sidebar") {
        setSidebarWidth(Math.min(360, Math.max(168, width)));
      } else {
        setPropertiesWidth(Math.min(420, Math.max(240, width)));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.document.body.classList.remove("resizing-panel");
    };
    window.document.body.classList.add("resizing-panel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [propertiesWidth, sidebarWidth]);

  useEffect(() => {
    const handleAppShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(
        target?.matches("input, textarea, select, [contenteditable='true']")
      );
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (command && key === "/") {
        event.preventDefault();
        setActiveDialog("shortcuts");
        return;
      }
      if (command && key === "o") {
        event.preventDefault();
        void openPdf();
        return;
      }
      if (command && key === "s") {
        event.preventDefault();
        if (pdfDocument) requestSave(event.shiftKey);
        return;
      }
      if (command && key === "p") {
        event.preventDefault();
        requestPrint();
        return;
      }
      if (command && key === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.select(), 0);
        return;
      }
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) void editor.redo();
        else void editor.undo();
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        void editor.redo();
        return;
      }
      if (command && (key === "0" || key === "1")) {
        event.preventDefault();
        if (!pdfDocument) return;
        if (key === "0") setViewMode("fit-page");
        else {
          setZoom(1);
          setViewMode("custom");
        }
        return;
      }
      if (editing) return;
      if (event.key === "Escape" && !activeDialog) {
        window.document
          .querySelectorAll<HTMLDetailsElement>("details[open]")
          .forEach((details) => details.removeAttribute("open"));
        setSelectedAnnotationId(null);
        setActiveTool("select");
        setSearchOpen(false);
        return;
      }
      if (
        selectedAnnotation &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const distance = event.shiftKey ? 0.012 : 0.0025;
        moveSelectedAnnotation(
          selectedAnnotation,
          event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
          event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0
        );
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !selectedAnnotationId &&
        documentPrepared
      ) {
        event.preventDefault();
        deleteSelectedPage();
      }
    };
    window.addEventListener("keydown", handleAppShortcut);
    return () => window.removeEventListener("keydown", handleAppShortcut);
  }, [
    activeDialog,
    deleteSelectedPage,
    documentPrepared,
    editor,
    moveSelectedAnnotation,
    openPdf,
    pdfDocument,
    requestPrint,
    requestSave,
    selectedAnnotation,
    selectedAnnotationId
  ]);

  const status = useMemo(() => {
    if (busy) return "Opening document…";
    if (error) return error;
    if (!pdfDocument) return "Drop a local PDF here or choose Open";
    return `${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}`;
  }, [busy, pdfDocument, error]);

  const currentPageDimensions = useMemo(() => {
    const page = pages[currentPage - 1];
    if (!page) return null;
    const viewport = page.getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }, [currentPage, pages]);

  const backgroundActivity = useMemo(() => {
    if (saving) return "Saving document…";
    if (busy) return loadingStage;
    if (ocrRunning) {
      return ocrStatus || `OCR ${Math.round(ocrProgress * 100)}%`;
    }
    if (pdfDocument && preparedPageCount < pdfDocument.numPages) {
      return `Preparing pages ${preparedPageCount} of ${pdfDocument.numPages}`;
    }
    if (renderingPages.size) {
      return `Rendering ${renderingPages.size} page${renderingPages.size === 1 ? "" : "s"}…`;
    }
    return "";
  }, [
    busy,
    loadingStage,
    ocrProgress,
    ocrRunning,
    ocrStatus,
    pdfDocument,
    preparedPageCount,
    renderingPages.size,
    saving
  ]);

  return (
    <div
      className="app-shell flex h-full flex-col bg-ink text-zinc-100"
      data-theme={resolvedTheme}
    >
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
        <PreferencesDialog
          preferences={preferences}
          textStyle={textStyle}
          desktopPlatform={desktopPlatform}
          status={preferenceStatus}
          onPreferencesChange={setPreferences}
          onTextStyleChange={setTextStyle}
          onOpenDefaultApps={openDefaultAppSettings}
          onClearLocalData={clearLocalPreferences}
          onChooseSaveFolder={chooseDefaultSaveFolder}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "shortcuts" && (
        <ShortcutsDialog onClose={() => setActiveDialog(null)} />
      )}
      {activeDialog === "password" && (
        <PasswordDialog
          value={passwordValue}
          incorrect={passwordIncorrect}
          onChange={setPasswordValue}
          onCancel={cancelPassword}
          onConfirm={submitPassword}
        />
      )}
      {activeDialog === "recovery" && pendingRecovery && (
        <RecoveryDialog
          snapshot={pendingRecovery}
          onRecover={recoverUnsavedWork}
          onDiscard={discardRecovery}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "unsaved-close" && (
        <UnsavedCloseDialog
          busy={dialogBusy}
          onSave={closeAfterSaving}
          onDiscard={discardAndClose}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "overwrite" && (
        <OverwriteDialog
          fileName={fileName}
          automaticBackups={preferences.automaticBackups}
          busy={dialogBusy}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmOverwriteSave}
        />
      )}
      {activeDialog === "save" && (
        <SaveNameDialog
          mode="save"
          saveAs={saveForceAs}
          desktop={isTauri()}
          value={saveName}
          busy={dialogBusy}
          onChange={setSaveName}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmSave}
        />
      )}
      {activeDialog === "print" && (
        <PrintDialog
          pageCount={pages.length}
          ranges={printRanges}
          error={printError}
          orientation={printOrientation}
          busy={dialogBusy}
          onRangesChange={(value) => {
            setPrintRanges(value);
            if (printError) setPrintError("");
          }}
          onOrientationChange={setPrintOrientation}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmPrint}
        />
      )}
      {activeDialog === "split" && (
        <SplitRangeDialog
          pageCount={pages.length}
          value={splitRanges}
          error={splitError}
          busy={dialogBusy}
          onChange={(value) => {
            setSplitRanges(value);
            if (splitError) setSplitError("");
          }}
          onCancel={() => setActiveDialog(null)}
          onConfirm={confirmSplit}
        />
      )}
      {activeDialog === "split-save" && (
        <SaveNameDialog
          mode="split"
          desktop={isTauri()}
          value={saveName}
          busy={dialogBusy}
          hasBytes={Boolean(pendingSplitBytes)}
          onChange={setSaveName}
          onCancel={() => {
            setPendingSplitBytes(null);
            setActiveDialog(null);
          }}
          onConfirm={confirmSplitSave}
        />
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
            <p className="text-xs font-semibold">Unable to complete that action</p>
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
          <button
            aria-label="Print PDF"
            className={iconButton + " toolbar-tooltip"}
            data-tooltip="Print chosen pages using the system print dialog (Ctrl/Command+P)"
            data-tooltip-align="end"
            disabled={!pdfDocument}
            onClick={requestPrint}
          >
            <Printer size={16} /> <span className="hidden min-[1120px]:inline">Print</span>
          </button>
          <div className="mx-2 h-6 w-px bg-white/10" aria-hidden="true" />
          <button
            aria-label="Keyboard shortcuts"
            className={iconButton + " toolbar-tooltip"}
            data-tooltip="Search keyboard shortcuts (Ctrl/Command+/)"
            data-tooltip-align="end"
            onClick={() => setActiveDialog("shortcuts")}
          >
            <Keyboard size={16} />
            <span className="hidden min-[1280px]:inline">Shortcuts</span>
          </button>
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

      <EditorToolbar
        pageCount={pdfDocument?.numPages ?? 0}
        documentPrepared={documentPrepared}
        hasDocument={Boolean(pdfDocument)}
        passwordProtected={passwordProtected}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        activeTool={activeTool}
        searchOpen={searchOpen}
        zoom={zoom}
        viewMode={viewMode}
        onMerge={mergePdf}
        onSplit={splitPdf}
        onDuplicate={duplicateSelectedPage}
        onDelete={deleteSelectedPage}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onRotate={rotateSelectedPage}
        onToolChange={setActiveTool}
        onFlattenForms={editor.flattenForms}
        onOptimize={editor.optimize}
        onSanitize={editor.sanitize}
        onToggleSearch={toggleSearch}
        onZoomChange={(nextZoom) => {
          setZoom(nextZoom);
          setViewMode("custom");
        }}
        onViewModeChange={setViewMode}
      />

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
        <SearchPanel
          inputRef={searchInputRef}
          query={searchQuery}
          resultCount={searchResults.length}
          resultIndex={searchResultIndex}
          ocrRunning={ocrRunning}
          extractedPageCount={extractedPageCount}
          pageCount={pages.length}
          onQueryChange={setSearchQuery}
          onMove={moveSearchResult}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <OcrStatus
        running={ocrRunning}
        status={ocrStatus}
        progress={ocrProgress}
        onCancel={cancelOcr}
        onDismiss={() => setOcrStatus("")}
      />

      <main className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside
            className="sidebar-panel flex shrink-0 flex-col bg-panel"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="grid grid-cols-2 border-b border-white/10">
              <button className={`flex h-10 items-center justify-center gap-1.5 text-xs ${sidebarTab === "pages" ? "border-b-2 border-accent text-white" : "text-zinc-500"}`} onClick={() => setSidebarTab("pages")}><FilePlus2 size={14} /> Pages</button>
              <button className={`flex h-10 items-center justify-center gap-1.5 text-xs ${sidebarTab === "bookmarks" ? "border-b-2 border-accent text-white" : "text-zinc-500"}`} onClick={() => setSidebarTab("bookmarks")}><BookOpen size={14} /> Bookmarks</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {sidebarTab === "pages" ? (
                <div className="space-y-2">
                  {pages.map((page) => <PageThumbnail key={page.pageNumber} page={page} selected={selectedPage === page.pageNumber} reorderEnabled={documentPrepared} onClick={() => jumpToPage(page.pageNumber)} onMove={(from, to) => {
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
        {sidebarOpen && (
          <div
            role="separator"
            aria-label="Resize page sidebar"
            aria-orientation="vertical"
            className="panel-resizer relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent transition hover:bg-orange-400/50"
            onPointerDown={(event) => startPanelResize(event, "sidebar")}
          />
        )}

        <section className="relative flex min-w-0 flex-1 flex-col bg-workspace">
          {!pdfDocument && !busy ? (
            <div className="m-auto flex w-full max-w-lg flex-col items-center px-6 py-8">
              <button
                onClick={openPdf}
                className="group flex w-full flex-col items-center rounded-2xl border border-dashed border-zinc-500/80 bg-black/5 px-10 py-12 text-zinc-300 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-accent hover:bg-white/5 hover:shadow-xl"
              >
                <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 transition group-hover:bg-orange-500/10">
                  <FolderOpen size={30} strokeWidth={1.5} className="text-zinc-400 group-hover:text-orange-300" />
                </span>
                <span className="text-base font-semibold">Open a PDF</span>
                <span className="mt-2 text-sm text-zinc-500">Choose a file or drag it anywhere into this window</span>
                <span className="mt-5 rounded-full border border-emerald-400/15 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-400">100% local · never uploaded</span>
              </button>
              {preferences.recentFiles.length > 0 && (
                <div className="mt-6 w-full">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Recent documents</h2>
                    <button
                      className="text-[10px] text-zinc-500 transition hover:text-zinc-200"
                      onClick={() => setPreferences((current) => ({ ...current, recentFiles: [] }))}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-panel/60">
                    {preferences.recentFiles.slice(0, 5).map((path) => (
                      <button
                        key={path}
                        className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2.5 text-left text-xs text-zinc-300 transition last:border-0 hover:bg-white/5"
                        onClick={() => {
                          void readAndLoadPdf(path).catch((cause) => {
                            setError(`Could not open “${baseName(path)}”. ${errorMessage(cause, "The file could not be read.")}`);
                          });
                        }}
                      >
                        <FilePlus2 size={14} className="shrink-0 text-zinc-500" />
                        <span className="min-w-0 flex-1 truncate">{baseName(path)}</span>
                        <span className="hidden max-w-52 truncate text-[10px] text-zinc-600 sm:block">{path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div ref={workspaceRef} className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto p-8">
              {pages.map((page) => (
                <VirtualizedPdfPage
                  key={page.pageNumber}
                  page={page}
                  scale={zoom}
                >
                  <PdfPageCanvas
                    page={page}
                    pageId={null}
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
                    onRenderingChange={handleRenderingChange}
                  />
                </VirtualizedPdfPage>
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
        {selectedAnnotation && activeTool === "select" && (
          <>
            <div
              role="separator"
              aria-label="Resize annotation properties"
              aria-orientation="vertical"
              className="panel-resizer relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent transition hover:bg-orange-400/50"
              onPointerDown={(event) => startPanelResize(event, "properties")}
            />
            <div
              className="properties-panel shrink-0 border-l border-white/10"
              style={{ width: `${propertiesWidth}px` }}
            >
              <SelectedAnnotationToolbar
                annotation={selectedAnnotation}
                onUpdate={editor.updateAnnotation}
                onRemove={(id) => {
                  editor.removeAnnotation(id);
                  setSelectedAnnotationId(null);
                }}
              />
            </div>
          </>
        )}
      </main>
      <StatusBar
        currentPage={currentPage}
        pageCount={pdfDocument?.numPages ?? 0}
        width={currentPageDimensions?.width ?? null}
        height={currentPageDimensions?.height ?? null}
        fileSize={editor.bytes?.byteLength ?? 0}
        zoom={zoom}
        dirty={editor.isDirty}
        activity={backgroundActivity}
      />
    </div>
  );
}
