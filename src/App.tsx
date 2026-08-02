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
  FileDown,
  FilePlus2,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Printer,
  Save,
  Settings,
  Type,
  X
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Worker as TesseractWorker } from "tesseract.js";
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
  localPathKey,
  normalizeLocalPath,
  parsePageRanges
} from "./localUtils";
import {
  clearAllRecoveries,
  clearRecovery,
  deleteRecoveryRevision,
  listRecoverySnapshots,
  readRecovery,
  saveRecovery,
  type RecoverySnapshot
} from "./recoveryStore";
import {
  isUsableRecoverySnapshot,
  migrateRecoverySnapshot,
  requestRecoveryWindow,
  recoveryStartupAction
} from "./recoveryStartup";
import { iconButton } from "./components/ToolbarDropdown";
import { printPdfPages } from "./printDocument";
import { SearchPanel } from "./components/SearchPanels";
import {
  awaitOcrStartup,
  friendlyOcrStatus,
  OcrStartupCanceledError
} from "./lib/ocrStartup";
import { loadPdfRuntime } from "./lib/pdfRuntime";
import { PrintDialog } from "./components/PrintDialog";
import { PageThumbnail } from "./components/PageThumbnail";
import { SelectedAnnotationToolbar } from "./components/SelectedAnnotationToolbar";
import { VirtualizedPdfPage } from "./components/VirtualizedPdfPage";
import { EditorToolbar } from "./components/EditorToolbar";
import { PdfPageCanvas } from "./components/PdfPageCanvas";
import { RecoveryAvailableNotice } from "./components/RecoveryAvailableNotice";
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
import {
  BookmarksPanel,
  type BookmarkItem
} from "./components/BookmarksPanel";
import {
  MergeDialog,
  type MergeCandidate
} from "./components/MergeDialog";
import { ExportSummaryDialog } from "./components/ExportSummaryDialog";
import {
  isReleaseNewer,
  normalizeReleaseVersion,
  type UpdateCheckStatus
} from "./lib/updateCheck";
import { version as APP_VERSION } from "../package.json";
import { createDiagnosticReport } from "./diagnostics";

// Keep the pre-rebrand keys to preserve window and session state on upgrade.
const WINDOW_BOUNDS_KEY = "sovereignpdf.window-bounds.v1";
const SESSION_KEY = "sovereignpdf.last-session.v1";
const GITHUB_REPOSITORY_URL = "https://github.com/JHoff1/VerityPDF";
const WEBSITE_URL = "https://www.veritypdf.com/";
const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases/latest`;
const GITHUB_RELEASE_API_URL =
  "https://api.github.com/repos/JHoff1/VerityPDF/releases/latest";
const GITHUB_ISSUES_URL = "https://github.com/JHoff1/VerityPDF/issues/new";
const PRIVACY_POLICY_URL =
  "https://github.com/JHoff1/VerityPDF/blob/main/PRIVACY.md";

type StoredSession = {
  sourcePath: string;
  fileName: string;
  currentPage: number;
  scrollTop: number;
  zoom: number;
  viewMode: ViewMode;
  sidebarTab: "pages" | "bookmarks";
  sidebarOpen: boolean;
  activeTool: Tool;
  updatedAt: number;
};

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause && typeof cause === "object") {
    try {
      const serialized = JSON.stringify(cause);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the context-specific message.
    }
  }
  return fallback;
}

function cloneForPdfJs(bytes: Uint8Array) {
  return new Uint8Array(bytes).buffer;
}

async function readLocalPdf(path: string) {
  const response = await invoke<ArrayBuffer>("read_pdf_file", { path });
  return response.slice(0);
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
  const { PDFDocument } = await import("pdf-lib");
  const { getDocument } = await loadPdfRuntime();
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
  const [selectedPages, setSelectedPages] = useState<Set<number>>(
    () => new Set([1])
  );
  const [zoom, setZoom] = useState(preferences.zoom);
  const [viewMode, setViewMode] = useState<ViewMode>(preferences.viewMode);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>(preferences.textStyle);
  const [sidebarTab, setSidebarTab] = useState<"pages" | "bookmarks">("pages");
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceScrollTop, setWorkspaceScrollTop] = useState(0);
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
  const [activeDialog, setActiveDialog] = useState<"preferences" | "shortcuts" | "merge" | "export-summary" | "save" | "overwrite" | "split" | "split-save" | "print" | "password" | "unsaved-close" | "recovery" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveForceAs, setSaveForceAs] = useState(false);
  const [splitRanges, setSplitRanges] = useState("");
  const [splitError, setSplitError] = useState("");
  const [printRanges, setPrintRanges] = useState("");
  const [printError, setPrintError] = useState("");
  const [pendingSplitBytes, setPendingSplitBytes] = useState<Uint8Array | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [preferenceStatus, setPreferenceStatus] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordIncorrect, setPasswordIncorrect] = useState(false);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [formsFlattened, setFormsFlattened] = useState(false);
  const [metadataSanitized, setMetadataSanitized] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null);
  const [deferredRecovery, setDeferredRecovery] = useState<RecoverySnapshot | null>(null);
  const [recoveryActionBusy, setRecoveryActionBusy] = useState(false);
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const browserFileInput = useRef<HTMLInputElement>(null);
  const mergeFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageSelectionAnchor = useRef(1);
  const sessionRestoreAttempted = useRef(false);

  const openExternalProjectPage = async (
    url: string,
    failureMessage: string
  ) => {
    try {
      if (isTauri()) {
        await openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (cause) {
      setError(errorMessage(cause, failureMessage));
    }
  };

  const reportIssue = () =>
    openExternalProjectPage(
      GITHUB_ISSUES_URL,
      "The GitHub issue page could not be opened."
    );

  const exportDiagnostics = async () => {
    const report = createDiagnosticReport({
      version: APP_VERSION,
      platform: window.navigator.platform,
      desktop: isTauri(),
      pageCount: pdfDocument?.numPages ?? 0,
      annotationCount: editor.annotations.length,
      dirty: editor.isDirty,
      theme: preferences.theme,
      viewMode,
      flattenAnnotations: preferences.flattenAnnotations,
      automaticBackups: preferences.automaticBackups,
      restoreSession: preferences.restoreSession,
      lastError: error
    });
    try {
      if (isTauri()) {
        const destination = await save({
          defaultPath: "VerityPDF-diagnostics.txt",
          filters: [{ name: "Text report", extensions: ["txt"] }]
        });
        if (!destination) return;
        await writeFile(destination, new TextEncoder().encode(report));
      } else {
        const url = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = "VerityPDF-diagnostics.txt";
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setPreferenceStatus("Privacy-scrubbed diagnostic report saved locally.");
    } catch (cause) {
      setError(errorMessage(cause, "The diagnostic report could not be saved."));
    }
  };

  const checkForUpdates = async () => {
    if (updateStatus === "checking") return;
    setUpdateStatus("checking");
    setLatestVersion(null);
    try {
      const response = await fetch(GITHUB_RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json"
        },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);

      const release = await response.json() as { tag_name?: unknown };
      const releaseVersion = normalizeReleaseVersion(release.tag_name);
      if (!releaseVersion) throw new Error("GitHub returned an invalid release version.");

      setLatestVersion(releaseVersion);
      setUpdateStatus(
        isReleaseNewer(releaseVersion, APP_VERSION) ? "available" : "current"
      );
    } catch {
      setUpdateStatus("unavailable");
    }
  };

  const copyErrorDetails = async () => {
    if (!error) return;
    const details = [
      "VerityPDF error report",
      `Platform: ${navigator.platform || "Unknown"}`,
      `Error: ${error}`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setSuccessMessage("Error details copied. Review them before including them in a report.");
    } catch {
      setSuccessMessage("The error details could not be copied.");
    }
  };
  const pendingSessionRestore = useRef<StoredSession | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const pendingImage = useRef<{ page: number; x: number; y: number } | null>(null);
  const lastRenderedBytes = useRef<Uint8Array | null>(null);
  const renderGeneration = useRef(0);
  const passwordUpdater = useRef<((password: string) => void) | null>(null);
  const passwordLoadingTask = useRef<PDFDocumentLoadingTask | null>(null);
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

  const refreshRecoverySnapshots = useCallback(() => {
    void listRecoverySnapshots()
      .then(setRecoverySnapshots)
      .catch(() => setRecoverySnapshots([]));
  }, []);

  useEffect(() => {
    dirtyRef.current = editor.isDirty;
  }, [editor.isDirty]);

  useEffect(() => {
    let cancelled = false;
    refreshRecoverySnapshots();
    void (async () => {
      let sourceRecoveryId = recoveryId;
      let requestedRecoveryWindow = false;
      let explicitPdfPending = false;
      if (isTauri()) {
        const [requestedId, openedPaths] = await Promise.all([
          invoke<string | null>("opened_recovery_id", {
            windowLabel: recoveryId
          }),
          invoke<string[]>("opened_pdf_paths", {
            windowLabel: recoveryId
          })
        ]);
        if (requestedId) {
          sourceRecoveryId = requestedId;
          requestedRecoveryWindow = true;
        }
        explicitPdfPending = openedPaths.some((path) =>
          path.toLowerCase().endsWith(".pdf")
        );
      }

      let snapshot: RecoverySnapshot | undefined;
      try {
        snapshot = await readRecovery(sourceRecoveryId);
      } catch {
        if (requestedRecoveryWindow) {
          setError(
            "The requested recovery snapshot could not be read. It remains stored locally so you can retry from Preferences."
          );
        }
        return;
      }
      if (cancelled) return;
      if (snapshot && !isUsableRecoverySnapshot(snapshot)) {
        setError(
          "A local recovery snapshot was found but its document data is invalid. The snapshot has been kept for manual review or deletion in Preferences."
        );
        return;
      }
      const recoveryAction = recoveryStartupAction({
        hasSnapshot: Boolean(snapshot),
        requestedRecoveryWindow,
        explicitPdfPending,
        documentOpen: Boolean(editor.bytes)
      });
      if (!snapshot || recoveryAction === "none") return;

      if (recoveryAction === "restore-requested-window") {
        const migrationCompleted = await migrateRecoverySnapshot({
          snapshot,
          targetId: recoveryId,
          save: saveRecovery,
          clear: clearRecovery
        });
        if (cancelled) return;
        editor.restore(new Uint8Array(snapshot.bytes), snapshot.annotations);
        setFileName(snapshot.fileName);
        setSourcePath(snapshot.sourcePath);
        setCurrentPage(1);
        setSelectedPage(1);
        setSelectedPages(new Set([1]));
        setSuccessMessage(
          !migrationCompleted
            ? "Your recovered work opened. The original recovery snapshot was kept because local cleanup could not be completed."
            : "Your locally recovered unsaved work opened in a new window."
        );
        void invoke("mark_window_document_open", {
          windowLabel: recoveryId
        });
        void getCurrentWindow().setTitle(
          `${snapshot.fileName} — VerityPDF`
        );
        refreshRecoverySnapshots();
        return;
      }

      if (recoveryAction === "defer-for-explicit-pdf") {
        setPendingRecovery(null);
        setDeferredRecovery(snapshot);
        return;
      }
      setPendingRecovery(snapshot);
      setActiveDialog("recovery");
    })().catch(() => {
      // Recovery is best-effort and must never prevent the editor from opening.
    });
    return () => {
      cancelled = true;
    };
  }, [
    editor.bytes,
    editor.restore,
    recoveryId,
    refreshRecoverySnapshots
  ]);

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
      }).then(() => {
        setRecoveryNotice("Recovery snapshot updated");
        refreshRecoverySnapshots();
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    editor.annotations,
    editor.bytes,
    editor.isDirty,
    fileName,
    recoveryId,
    refreshRecoverySnapshots,
    sourcePath
  ]);

  useEffect(() => {
    if (!recoveryNotice) return;
    const timeout = window.setTimeout(() => setRecoveryNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [recoveryNotice]);

  useEffect(() => {
    const forgetCompletedSession = () => {
      window.localStorage.removeItem(SESSION_KEY);
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || allowWindowClose.current) {
        forgetCompletedSession();
        return;
      }
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
      if (!dirtyRef.current || allowWindowClose.current) {
        forgetCompletedSession();
        return;
      }
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
    if (!preferences.restoreSession) {
      window.localStorage.removeItem(SESSION_KEY);
      return;
    }
    if (!sourcePath || !isTauri()) return;
    const timeout = window.setTimeout(() => {
      const session: StoredSession = {
        sourcePath,
        fileName,
        currentPage,
        scrollTop: workspaceScrollTop,
        zoom,
        viewMode,
        sidebarTab,
        sidebarOpen,
        activeTool,
        updatedAt: Date.now()
      };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    activeTool,
    currentPage,
    fileName,
    preferences.restoreSession,
    sidebarOpen,
    sidebarTab,
    sourcePath,
    viewMode,
    workspaceScrollTop,
    zoom
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    // Native windows are configured to start maximized. Older releases then
    // restored a saved unmaximized size after the webview loaded, overriding
    // that native setting. Discard the legacy geometry and consistently honor
    // the maximized startup behavior for every document window.
    window.localStorage.removeItem(WINDOW_BOUNDS_KEY);
    void appWindow.maximize().catch(() => undefined);
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
        const { Util } = await loadPdfRuntime();
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
    const { getDocument, PasswordResponses } = await loadPdfRuntime();
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
    setFormsFlattened(false);
    setMetadataSanitized(false);
    if (isTauri()) {
      const windowLabel = getCurrentWebview().label;
      void invoke("mark_window_document_open", { windowLabel });
      void getCurrentWindow().setTitle(`${name} — VerityPDF`);
    }
    if (path) {
      const normalizedPath = normalizeLocalPath(path);
      const normalizedKey = localPathKey(normalizedPath);
      setPreferences((current) => ({
        ...current,
        recentFiles: [
          normalizedPath,
          ...current.recentFiles.filter((item) => localPathKey(item) !== normalizedKey)
        ].slice(0, 8)
      }));
    }
    setCurrentPage(1);
    setSelectedPage(1);
    setSelectedPages(new Set([1]));
    pageSelectionAnchor.current = 1;
    setZoom(preferences.zoom);
    setViewMode(preferences.viewMode);
  }, [editor.load, preferences.viewMode, preferences.zoom]);

  const readAndLoadPdf = useCallback(async (path: string) => {
    const normalizedPath = normalizeLocalPath(path);
    setBusy(true);
    setLoadingStage(`Reading ${baseName(normalizedPath)}…`);
    setLoadingProgress(0.02);
    setError(null);
    try {
      loadPdf(
        await readLocalPdf(normalizedPath),
        baseName(normalizedPath),
        normalizedPath
      );
    } catch (cause) {
      setBusy(false);
      throw cause;
    }
  }, [loadPdf]);

  useEffect(() => {
    if (
      !isTauri() ||
      !preferences.restoreSession ||
      editor.bytes ||
      sessionRestoreAttempted.current ||
      recoveryId !== "main"
    ) return;
    const timeout = window.setTimeout(() => {
      if (activeDialog) return;
      sessionRestoreAttempted.current = true;
      try {
        const session = JSON.parse(
          window.localStorage.getItem(SESSION_KEY) ?? "null"
        ) as StoredSession | null;
        if (!session?.sourcePath) return;
        pendingSessionRestore.current = session;
        void readAndLoadPdf(session.sourcePath).catch(() => {
          pendingSessionRestore.current = null;
          window.localStorage.removeItem(SESSION_KEY);
        });
      } catch {
        window.localStorage.removeItem(SESSION_KEY);
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    activeDialog,
    editor.bytes,
    preferences.restoreSession,
    readAndLoadPdf,
    recoveryId
  ]);

  useEffect(() => {
    const session = pendingSessionRestore.current;
    if (!session || !documentPrepared) return;
    pendingSessionRestore.current = null;
    const restoredPage = Math.min(
      Math.max(1, session.currentPage),
      pages.length
    );
    setCurrentPage(restoredPage);
    setSelectedPage(restoredPage);
    setSelectedPages(new Set([restoredPage]));
    pageSelectionAnchor.current = restoredPage;
    setZoom(Math.min(4, Math.max(0.25, session.zoom)));
    setViewMode(session.viewMode);
    setSidebarTab(session.sidebarTab);
    setSidebarOpen(session.sidebarOpen);
    setActiveTool(session.activeTool);
    window.setTimeout(() => {
      if (workspaceRef.current) {
        workspaceRef.current.scrollTop = Math.max(0, session.scrollTop);
      }
    }, 100);
    setSuccessMessage(`Restored your previous session for ${session.fileName}.`);
  }, [documentPrepared, pages.length]);

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
        const detail = errorMessage(cause, "The file could not be read.");
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
          setError(`VerityPDF could not create a document window. ${event.payload}`);
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
      const detail = errorMessage(cause, "The request could not be completed.");
      setError(`VerityPDF could not process the file-open request. ${detail}`);
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
      const detail = errorMessage(cause, "The file could not be read.");
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
    setSelectedPages((current) => {
      const valid = [...current].filter((page) => page <= pdfDocument.numPages);
      return new Set(valid.length ? valid : [Math.min(selectedPage, pdfDocument.numPages)]);
    });
  }, [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument) {
      setBookmarks([]);
      setBookmarksLoading(false);
      return;
    }
    let cancelled = false;
    setBookmarksLoading(true);
    void (async () => {
      const outline = await pdfDocument.getOutline();
      type OutlineEntry = NonNullable<typeof outline>[number];
      const resolvePage = async (destination: OutlineEntry["dest"]) => {
        const explicitDestination = typeof destination === "string"
          ? await pdfDocument.getDestination(destination)
          : destination;
        if (!explicitDestination?.length) return null;
        const reference = explicitDestination[0];
        if (typeof reference === "number") return reference + 1;
        try {
          return await pdfDocument.getPageIndex(reference) + 1;
        } catch {
          return null;
        }
      };
      const convert = async (
        items: OutlineEntry[],
        prefix = "bookmark"
      ): Promise<BookmarkItem[]> => Promise.all(items.map(async (item, index) => ({
        id: `${prefix}-${index}`,
        title: item.title || "Untitled bookmark",
        page: await resolvePage(item.dest),
        children: await convert(item.items ?? [], `${prefix}-${index}`)
      })));
      const nextBookmarks = await convert(outline ?? []);
      if (!cancelled) setBookmarks(nextBookmarks);
    })().catch(() => {
      if (!cancelled) setBookmarks([]);
    }).finally(() => {
      if (!cancelled) setBookmarksLoading(false);
    });
    return () => {
      cancelled = true;
    };
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
    setSelectedPages(new Set([pageNumber]));
    pageSelectionAnchor.current = pageNumber;
  }, []);

  const selectedPageNumbers = useMemo(
    () => [...selectedPages].sort((left, right) => left - right),
    [selectedPages]
  );

  const selectThumbnailPage = useCallback((
    pageNumber: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ) => {
    setSelectedPage(pageNumber);
    setCurrentPage(pageNumber);
    if (modifiers.shiftKey) {
      const start = Math.min(pageSelectionAnchor.current, pageNumber);
      const end = Math.max(pageSelectionAnchor.current, pageNumber);
      setSelectedPages(new Set(
        Array.from({ length: end - start + 1 }, (_, index) => start + index)
      ));
      return;
    }
    if (modifiers.ctrlKey || modifiers.metaKey) {
      setSelectedPages((current) => {
        const next = new Set(current);
        if (next.has(pageNumber) && next.size > 1) next.delete(pageNumber);
        else next.add(pageNumber);
        return next;
      });
      pageSelectionAnchor.current = pageNumber;
      return;
    }
    window.document
      .getElementById(`page-${pageNumber}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSelectedPages(new Set([pageNumber]));
    pageSelectionAnchor.current = pageNumber;
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
      setOcrStatus("");
      setOcrProgress(1);
      setSuccessMessage("This PDF already contains searchable text.");
      return;
    }

    setOcrRunning(true);
    setOcrProgress(0);
    setOcrStatus("Loading offline OCR engine…");
    ocrCancelRequested.current = false;
    let worker: TesseractWorker | null = null;
    let activePage = 0;
    try {
      const [{ createWorker }, { simd }] = await Promise.all([
        import("tesseract.js"),
        import("wasm-feature-detect")
      ]);
      const assetUrl = (path: string) => new URL(path, window.location.href).href;
      const supportsSimd = await simd();
      const createLocalWorker = (corePath: string) =>
        awaitOcrStartup({
          start: () => createWorker("eng", 1, {
            // Keep every OCR runtime asset together under one local directory.
            workerPath: assetUrl("ocr/core/worker.min.js"),
            corePath: assetUrl(corePath),
            langPath: assetUrl("ocr/lang"),
            cacheMethod: "none",
            logger: (message) => {
              if (typeof message.progress === "number") {
                setOcrProgress((activePage + message.progress) / pageIndexes.length);
              }
              if (message.status) setOcrStatus(friendlyOcrStatus(message.status));
            }
          }),
          timeoutMs: 15_000,
          isCanceled: () => ocrCancelRequested.current,
          dispose: async (lateWorker) => {
            await lateWorker.terminate().catch(() => undefined);
          }
        });

      if (supportsSimd) {
        setOcrStatus("Loading accelerated offline OCR engine…");
        try {
          worker = await createLocalWorker("ocr/core/tesseract-core-simd-lstm.wasm.js");
        } catch (cause) {
          if (cause instanceof OcrStartupCanceledError) throw cause;
          setOcrStatus("Accelerated OCR unavailable; loading compatibility engine…");
        }
      }
      if (!worker) {
        worker = await createLocalWorker("ocr/core/tesseract-core-lstm.wasm.js");
      }
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
      const completionMessage = ocrCancelRequested.current
        ? "OCR canceled."
        : `OCR complete · ${pageIndexes.length} page${pageIndexes.length === 1 ? "" : "s"} recognized`;
      setOcrStatus("");
      setSuccessMessage(completionMessage);
    } catch (cause) {
      const startupFailed = !ocrCancelRequested.current && !worker;
      const message = ocrCancelRequested.current
        ? "OCR canceled."
        : startupFailed
          ? "OCR unavailable: the offline engine could not start. Reopen the document to retry."
          : cause instanceof Error ? `OCR failed: ${cause.message}` : "OCR failed.";
      setOcrStatus("");
      if (ocrCancelRequested.current) {
        setSuccessMessage(message);
      } else {
        setError(message);
      }
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
        "This encrypted PDF is open in protected viewing mode. VerityPDF will not rewrite it because doing so could corrupt its encryption."
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
        void clearRecovery(recoveryId)
          .then(refreshRecoverySnapshots)
          .catch(() => undefined);
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
      void clearRecovery(recoveryId)
        .then(refreshRecoverySnapshots)
        .catch(() => undefined);
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
    refreshRecoverySnapshots,
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

  const restoreRecoveryRevision = useCallback((snapshot: RecoverySnapshot) => {
    editor.restore(new Uint8Array(snapshot.bytes), snapshot.annotations);
    setFileName(snapshot.fileName);
    setSourcePath(snapshot.sourcePath);
    setCurrentPage(1);
    setSelectedPage(1);
    setSelectedPages(new Set([1]));
    setActiveDialog(null);
    setSuccessMessage(
      `Recovered the ${new Date(snapshot.updatedAt).toLocaleString()} snapshot of ${snapshot.fileName}.`
    );
  }, [editor]);

  const removeRecoveryRevision = useCallback(async (snapshot: RecoverySnapshot) => {
    await deleteRecoveryRevision(snapshot.id, snapshot.updatedAt);
    refreshRecoverySnapshots();
    setPreferenceStatus("Recovery snapshot deleted from this computer.");
  }, [refreshRecoverySnapshots]);

  const discardRecovery = useCallback(async () => {
    setRecoveryActionBusy(true);
    try {
      await clearRecovery(recoveryId);
      setPendingRecovery(null);
      setActiveDialog(null);
      refreshRecoverySnapshots();
    } catch (cause) {
      setError(errorMessage(
        cause,
        "The recovery snapshot could not be discarded."
      ));
    } finally {
      setRecoveryActionBusy(false);
    }
  }, [recoveryId, refreshRecoverySnapshots]);

  const openDeferredRecovery = useCallback(async () => {
    if (!deferredRecovery) return;
    setRecoveryActionBusy(true);
    try {
      if (!isTauri()) {
        editor.restore(
          new Uint8Array(deferredRecovery.bytes),
          deferredRecovery.annotations
        );
        setFileName(deferredRecovery.fileName);
        setSourcePath(deferredRecovery.sourcePath);
        setDeferredRecovery(null);
        return;
      }
      const result = await requestRecoveryWindow(
        deferredRecovery.id,
        (recoveryId) => invoke<string>("create_recovery_window", {
          recoveryId
        })
      );
      if (!result.opened) throw result.cause;
      setDeferredRecovery(null);
    } catch (cause) {
      setError(errorMessage(
        cause,
        "The recovered document window could not be opened."
      ));
    } finally {
      setRecoveryActionBusy(false);
    }
  }, [deferredRecovery, editor]);

  const discardDeferredRecovery = useCallback(async () => {
    if (!deferredRecovery) return;
    setRecoveryActionBusy(true);
    try {
      await clearRecovery(deferredRecovery.id);
      setDeferredRecovery(null);
      refreshRecoverySnapshots();
      setSuccessMessage("The local recovery snapshot was discarded.");
    } catch (cause) {
      setError(errorMessage(
        cause,
        "The recovery snapshot could not be discarded."
      ));
    } finally {
      setRecoveryActionBusy(false);
    }
  }, [deferredRecovery, refreshRecoverySnapshots]);

  const continueSaveRequest = useCallback((forceSaveAs = false) => {
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

  const requestSave = useCallback((forceSaveAs = false) => {
    const actualSaveAs = forceSaveAs || !sourcePath;
    if (preferences.showExportSummary) {
      setSaveForceAs(actualSaveAs);
      setActiveDialog("export-summary");
      return;
    }
    continueSaveRequest(actualSaveAs);
  }, [continueSaveRequest, preferences.showExportSummary, sourcePath]);

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
          title: fileName
        });
      } else {
        const bytes = await prepareExportBytes();
        if (!bytes) throw new Error("The PDF could not be prepared for printing.");
        await printPdfPages({
          bytes: new Uint8Array(bytes),
          pageNumbers: parsed.pages,
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
    printRanges
  ]);

  const closeAfterSaving = useCallback(async () => {
    setDialogBusy(true);
    try {
      const saved = await savePdf(!sourcePath);
      if (!saved) return;
      window.localStorage.removeItem(SESSION_KEY);
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
    window.localStorage.removeItem(SESSION_KEY);
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

  const buildMergeCandidate = useCallback(async (
    bytes: Uint8Array,
    name: string,
    current = false
  ): Promise<MergeCandidate> => {
    const { getDocument } = await loadPdfRuntime();
    const document = await getDocument({ data: cloneForPdfJs(bytes) }).promise;
    const previews: string[] = [];
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(4, document.numPages);
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const raw = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 120 / raw.width });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      previews.push(canvas.toDataURL("image/jpeg", 0.72));
    }
    const candidate: MergeCandidate = {
      id: createLocalId(),
      name,
      bytes,
      pageCount: document.numPages,
      size: bytes.byteLength,
      current,
      previews
    };
    await document.destroy();
    return candidate;
  }, []);

  const stageMergeDocuments = useCallback(async (
    documents: Array<{ bytes: Uint8Array; name: string }>
  ) => {
    if (!editor.bytes || !documents.length) return;
    setBusy(true);
    setLoadingStage("Preparing merge previews…");
    setLoadingProgress(0.1);
    setError(null);
    try {
      const additions = await Promise.all(
        documents.map((document) =>
          buildMergeCandidate(document.bytes, document.name)
        )
      );
      let currentCandidates = mergeCandidates;
      if (!currentCandidates.length) {
        currentCandidates = [
          await buildMergeCandidate(editor.bytes, fileName, true)
        ];
      }
      setMergeCandidates([...currentCandidates, ...additions]);
      setActiveDialog("merge");
    } catch (cause) {
      setError(errorMessage(cause, "One of the selected PDFs could not be prepared."));
    } finally {
      setBusy(false);
    }
  }, [buildMergeCandidate, editor.bytes, fileName, mergeCandidates]);

  const chooseMergeFiles = useCallback(async () => {
    if (!isTauri()) {
      mergeFileInput.current?.click();
      return;
    }
    const paths = await open({
      multiple: true,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    const selectedPaths = typeof paths === "string" ? [paths] : paths;
    if (!selectedPaths?.length) return;
    try {
      await stageMergeDocuments(await Promise.all(selectedPaths.map(async (path) => ({
        name: baseName(path),
        bytes: new Uint8Array(await readLocalPdf(path))
      }))));
    } catch (cause) {
      setError(errorMessage(cause, "The selected PDFs could not be read."));
    }
  }, [stageMergeDocuments]);

  const mergePdf = useCallback(async () => {
    if (!documentPrepared) return;
    if (!mergeCandidates.length) setMergeCandidates([]);
    await chooseMergeFiles();
  }, [chooseMergeFiles, documentPrepared, mergeCandidates.length]);

  const confirmMerge = useCallback(async () => {
    if (mergeCandidates.length < 2) return;
    setDialogBusy(true);
    try {
      await editor.mergeMany(mergeCandidates.map((candidate) => ({
        bytes: candidate.bytes,
        current: candidate.current
      })));
      setFormsFlattened(false);
      setMetadataSanitized(false);
      setMergeCandidates([]);
      setActiveDialog(null);
      setSelectedPages(new Set([1]));
      setSelectedPage(1);
      setCurrentPage(1);
      setSuccessMessage("The staged PDFs were merged in the selected order.");
    } catch (cause) {
      setError(errorMessage(cause, "The PDFs could not be merged."));
    } finally {
      setDialogBusy(false);
    }
  }, [editor, mergeCandidates]);

  const flattenDocumentForms = useCallback(async () => {
    await editor.flattenForms();
    setFormsFlattened(true);
  }, [editor]);

  const sanitizeDocumentMetadata = useCallback(async () => {
    await editor.sanitize();
    setMetadataSanitized(true);
  }, [editor]);

  const splitPdf = useCallback(() => {
    if (!documentPrepared) return;
    setSplitRanges(selectedPageNumbers.join(","));
    setSplitError("");
    setActiveDialog("split");
  }, [documentPrepared, selectedPageNumbers]);

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
          "Your new document has been downloaded. Your original document is untouched and remains loaded in VerityPDF."
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
        "Your new document has been saved in the location you selected. Your original document is untouched and remains loaded in VerityPDF."
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
    if (
      !pdfDocument ||
      !documentPrepared ||
      pdfDocument.numPages - selectedPageNumbers.length < 1
    ) return;
    const nextSelection = Math.min(
      selectedPageNumbers[0],
      pdfDocument.numPages - selectedPageNumbers.length
    );
    void editor.removePages(selectedPageNumbers);
    setSelectedPage(nextSelection);
    setCurrentPage(nextSelection);
    setSelectedPages(new Set([nextSelection]));
    pageSelectionAnchor.current = nextSelection;
  }, [documentPrepared, editor, pdfDocument, selectedPageNumbers]);

  const duplicateSelectedPage = useCallback(() => {
    if (!documentPrepared) return;
    void editor.duplicatePages(selectedPageNumbers);
  }, [documentPrepared, editor, selectedPageNumbers]);

  const rotateSelectedPage = useCallback((amount: number) => {
    if (!documentPrepared) return;
    void editor.rotatePages(selectedPageNumbers, amount);
  }, [documentPrepared, editor, selectedPageNumbers]);

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
      setPreferenceStatus("Windows Default Apps settings opened. Choose VerityPDF for .pdf files.");
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
    window.localStorage.removeItem(SESSION_KEY);
    const reset = clonePlain(DEFAULT_PREFERENCES);
    setPreferences(reset);
    setTextStyle(reset.textStyle);
    setZoom(reset.zoom);
    setViewMode(reset.viewMode);
    setSidebarWidth(reset.sidebarWidth);
    setPropertiesWidth(reset.propertiesWidth);
    void clearAllRecoveries()
      .then(() => setRecoverySnapshots([]))
      .catch(() => undefined);
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
        setSelectedPage(currentPage);
        setSelectedPages(new Set([currentPage]));
        pageSelectionAnchor.current = currentPage;
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
    currentPage,
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
    if (!pdfDocument) return "Drop a local PDF here or choose Open";
    return `${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}`;
  }, [busy, pdfDocument]);

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
    if (recoveryNotice) return recoveryNotice;
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
    recoveryNotice,
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
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          if (files.length) {
            void Promise.all(files.map(async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer())
            })))
              .then(stageMergeDocuments)
              .catch((cause) => {
                setError(errorMessage(cause, "The selected PDFs could not be read."));
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
          recoverySnapshots={recoverySnapshots}
          onRestoreRecovery={restoreRecoveryRevision}
          onDeleteRecovery={removeRecoveryRevision}
          onReportIssue={reportIssue}
          onExportDiagnostics={exportDiagnostics}
          onOpenPrivacyPolicy={() => openExternalProjectPage(
            PRIVACY_POLICY_URL,
            "The privacy policy could not be opened."
          )}
          onOpenRepository={() => openExternalProjectPage(
            GITHUB_REPOSITORY_URL,
            "The project repository could not be opened."
          )}
          onOpenWebsite={() => openExternalProjectPage(
            WEBSITE_URL,
            "The VerityPDF website could not be opened."
          )}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "shortcuts" && (
        <ShortcutsDialog onClose={() => setActiveDialog(null)} />
      )}
      {activeDialog === "merge" && (
        <MergeDialog
          candidates={mergeCandidates}
          busy={dialogBusy}
          onAdd={chooseMergeFiles}
          onMove={(index, direction) => {
            setMergeCandidates((current) => {
              const next = [...current];
              const target = index + direction;
              if (target < 0 || target >= next.length) return current;
              [next[index], next[target]] = [next[target], next[index]];
              return next;
            });
          }}
          onRemove={(id) => setMergeCandidates((current) =>
            current.filter((candidate) => candidate.id !== id)
          )}
          onCancel={() => {
            setMergeCandidates([]);
            setActiveDialog(null);
          }}
          onConfirm={confirmMerge}
        />
      )}
      {activeDialog === "export-summary" && (
        <ExportSummaryDialog
          saveAs={saveForceAs}
          annotationCount={editor.annotations.length}
          flattenAnnotations={
            preferences.flattenAnnotations ||
            editor.annotations.some((annotation) => annotation.kind === "redaction")
          }
          redactionPageCount={new Set(
            editor.annotations
              .filter((annotation) => annotation.kind === "redaction")
              .map((annotation) => annotation.page)
          ).size}
          formsFlattened={formsFlattened}
          metadataSanitized={metadataSanitized}
          estimatedSize={
            (editor.bytes?.byteLength ?? 0) +
            editor.annotations.length * 160
          }
          onCancel={() => setActiveDialog(null)}
          onContinue={() => continueSaveRequest(saveForceAs)}
        />
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
          busy={recoveryActionBusy}
          onRecover={recoverUnsavedWork}
          onDiscard={discardRecovery}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {deferredRecovery && !successMessage && !error && (
        <RecoveryAvailableNotice
          snapshot={deferredRecovery}
          busy={recoveryActionBusy}
          onOpen={openDeferredRecovery}
          onDiscard={discardDeferredRecovery}
          onDismiss={() => setDeferredRecovery(null)}
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
          busy={dialogBusy}
          onRangesChange={(value) => {
            setPrintRanges(value);
            if (printError) setPrintError("");
          }}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="h-8 rounded-md bg-red-100/10 px-2.5 text-[11px] font-semibold text-red-50 hover:bg-red-100/15"
                onClick={() => void reportIssue()}
              >
                Report issue
              </button>
              <button
                type="button"
                className="h-8 rounded-md border border-red-100/15 px-2.5 text-[11px] font-medium text-red-100/80 hover:bg-red-100/10"
                onClick={() => void copyErrorDetails()}
              >
                Copy error details
              </button>
            </div>
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
        <img
          src="/app-icon.png"
          alt=""
          aria-hidden="true"
          className="h-7 w-7 shrink-0 rounded-[7px]"
        />
        <div className="ml-2 flex shrink-0 items-center">
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
        </div>
        <div className="mx-2 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{fileName}</div>
          <div className="truncate text-[10px] text-zinc-500">
            {status}
          </div>
        </div>
        <div className="ml-3 flex shrink-0 items-center">
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
        selectionCount={selectedPageNumbers.length}
        documentPrepared={documentPrepared}
        hasDocument={Boolean(pdfDocument)}
        passwordProtected={passwordProtected}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        activeTool={activeTool}
        sidebarOpen={sidebarOpen}
        searchOpen={searchOpen}
        zoom={zoom}
        viewMode={viewMode}
        onMerge={mergePdf}
        onSplit={splitPdf}
        onDuplicate={duplicateSelectedPage}
        onDelete={deleteSelectedPage}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onRotate={rotateSelectedPage}
        onToolChange={setActiveTool}
        onFlattenForms={flattenDocumentForms}
        onOptimize={editor.optimize}
        onSanitize={sanitizeDocumentMetadata}
        onToggleSearch={toggleSearch}
        onZoomChange={(nextZoom) => {
          setZoom(nextZoom);
          setViewMode("custom");
        }}
        onViewModeChange={setViewMode}
      />

      {activeTool === "text" && pdfDocument && (
        <div className="grid h-11 shrink-0 grid-cols-[1fr_1.1fr_1.1fr_5.6fr] border-b border-orange-500/15 bg-[#202329] px-1 min-[1680px]:grid-cols-[2.2fr_1.1fr_1.1fr_6.5fr]">
          <div className="col-span-3" aria-hidden="true" />
          <div
            data-testid="text-formatting-controls"
            className="flex min-w-0 items-center gap-2 border-l border-orange-500/15 px-3"
          >
            <Type size={15} className="shrink-0 text-orange-300" />
            <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-orange-300/70">Text</span>
            <select aria-label="Text font" value={textStyle.fontFamily} onChange={(event) => setTextStyle((style) => ({ ...style, fontFamily: event.target.value as TextStyle["fontFamily"] }))} className="h-7 rounded border border-white/10 bg-[#24272d] px-2 text-xs text-zinc-200">
              <option value="helvetica">Arial</option><option value="times">Times</option><option value="courier">Courier</option>
            </select>
            <input aria-label="Text size" type="number" min="6" max="96" value={textStyle.size} onChange={(event) => setTextStyle((style) => ({ ...style, size: Math.min(96, Math.max(6, Number(event.target.value) || 6)) }))} className="h-7 w-12 rounded border border-white/10 bg-[#24272d] px-1 text-xs text-zinc-200" />
            <button aria-label="Bold" className={`h-7 w-7 shrink-0 rounded text-xs font-bold ${textStyle.bold ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`} onClick={() => setTextStyle((style) => ({ ...style, bold: !style.bold }))}>B</button>
            <button aria-label="Italic" className={`h-7 w-7 shrink-0 rounded text-xs italic ${textStyle.italic ? "bg-accent/30 text-orange-100" : "text-zinc-400 hover:bg-white/10"}`} onClick={() => setTextStyle((style) => ({ ...style, italic: !style.italic }))}>I</button>
            <input aria-label="Text color" type="color" value={textStyle.color} onChange={(event) => setTextStyle((style) => ({ ...style, color: event.target.value }))} className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
            <span className="ml-1 hidden min-w-0 truncate text-[11px] text-zinc-500 min-[1100px]:inline">Click anywhere on the page to type</span>
          </div>
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
                  {pages.map((page) => <PageThumbnail key={page.pageNumber} page={page} selected={selectedPages.has(page.pageNumber)} selectedPages={selectedPageNumbers} reorderEnabled={documentPrepared} onClick={(event) => selectThumbnailPage(page.pageNumber, event)} onMove={(from, to) => {
                    if (!documentPrepared) return;
                    const selectedSet = new Set(from);
                    const remaining = pages
                      .map((item) => item.pageNumber)
                      .filter((pageNumber) => !selectedSet.has(pageNumber));
                    const targetIndex = remaining.findIndex((pageNumber) => pageNumber >= to);
                    const insertionIndex = targetIndex === -1 ? remaining.length : targetIndex;
                    const order = [
                      ...remaining.slice(0, insertionIndex),
                      ...from,
                      ...remaining.slice(insertionIndex)
                    ];
                    const nextSelection = order.flatMap((oldPage, index) =>
                      selectedSet.has(oldPage) ? [index + 1] : []
                    );
                    void editor.reorderPages(from, to);
                    setSelectedPage(nextSelection[0]);
                    setCurrentPage(nextSelection[0]);
                    setSelectedPages(new Set(nextSelection));
                    pageSelectionAnchor.current = nextSelection[0];
                  }} />)}
                </div>
              ) : (
                <BookmarksPanel
                  bookmarks={bookmarks}
                  loading={bookmarksLoading}
                  onNavigate={jumpToPage}
                />
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
            <div
              ref={workspaceRef}
              className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto p-8"
              onScroll={(event) => setWorkspaceScrollTop(event.currentTarget.scrollTop)}
            >
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
                    onTextFinished={() => setActiveTool("select")}
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
        selectedPageCount={selectedPageNumbers.length}
        width={currentPageDimensions?.width ?? null}
        height={currentPageDimensions?.height ?? null}
        fileSize={editor.bytes?.byteLength ?? 0}
        zoom={zoom}
        dirty={editor.isDirty}
        activity={backgroundActivity}
        onCancelActivity={ocrRunning ? cancelOcr : undefined}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        updateStatus={updateStatus}
        latestVersion={latestVersion}
        onCheckForUpdates={() => {
          void checkForUpdates();
        }}
        onOpenLatestRelease={() => {
          void openExternalProjectPage(
            GITHUB_RELEASES_URL,
            "The VerityPDF releases page could not be opened."
          );
        }}
      />
    </div>
  );
}
