import {
  Copy,
  FileCheck2,
  FilePlus2,
  Highlighter,
  ImagePlus,
  Minimize2,
  MousePointer2,
  PanelLeft,
  PenLine,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Scissors,
  Search,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { Tool, ViewMode } from "../editorUiTypes";
import {
  ToolbarDropdown,
  compactToolButton,
  dropdownItem,
  iconButton
} from "./ToolbarDropdown";

type Action = () => void | Promise<void>;

export function EditorToolbar({
  pageCount,
  selectionCount,
  documentPrepared,
  hasDocument,
  passwordProtected,
  canUndo,
  canRedo,
  activeTool,
  sidebarOpen,
  searchOpen,
  zoom,
  viewMode,
  onMerge,
  onSplit,
  onDuplicate,
  onDelete,
  onToggleSidebar,
  onUndo,
  onRedo,
  onRotate,
  onToolChange,
  onFlattenForms,
  onOptimize,
  onSanitize,
  onToggleSearch,
  onZoomChange,
  onViewModeChange
}: {
  pageCount: number;
  selectionCount: number;
  documentPrepared: boolean;
  hasDocument: boolean;
  passwordProtected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeTool: Tool;
  sidebarOpen: boolean;
  searchOpen: boolean;
  zoom: number;
  viewMode: ViewMode;
  onMerge: Action;
  onSplit: Action;
  onDuplicate: Action;
  onDelete: Action;
  onToggleSidebar: Action;
  onUndo: Action;
  onRedo: Action;
  onRotate: (amount: number) => void;
  onToolChange: (tool: Tool) => void;
  onFlattenForms: Action;
  onOptimize: Action;
  onSanitize: Action;
  onToggleSearch: Action;
  onZoomChange: (zoom: number) => void;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const selectedToolClass = (tool: Tool) =>
    activeTool === tool ? " bg-accent/20 text-orange-200" : "";
  const markupDisabled = !hasDocument || passwordProtected;
  const selectedPagesLabel = selectionCount === 1
    ? "selected page"
    : `${selectionCount} selected pages`;

  return (
    <div className="editor-toolbar relative z-30 grid h-20 w-full shrink-0 grid-cols-[1fr_1.1fr_1.1fr_2.4fr_1.1fr_2.1fr] items-stretch overflow-visible border-b border-white/10 bg-toolbar px-1 min-[1680px]:grid-cols-[2.2fr_1.1fr_1.1fr_2.4fr_2fr_2.1fr]">
      <div className="flex min-w-0 flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2 min-[1680px]:hidden">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page Edit</span>
        <div className="flex justify-center">
          <ToolbarDropdown label="Page Edit" tooltip="Open actions for the selected page" tooltipAlign="start" icon={<FilePlus2 size={16} />}>
            <button data-tooltip="Append all pages from another local PDF" data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onMerge()}><FilePlus2 size={15} /> Merge PDF</button>
            <button data-tooltip={`Export ${selectedPagesLabel} as a new PDF`} data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onSplit()}><Scissors size={15} /> Split or extract</button>
            <button data-tooltip={`Make a copy of ${selectedPagesLabel}`} data-tooltip-align="start" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onDuplicate()}><Copy size={15} /> Duplicate {selectionCount === 1 ? "page" : "pages"}</button>
            <button data-tooltip={`Remove ${selectedPagesLabel} from the document`} data-tooltip-align="start" className={dropdownItem + " text-red-300"} disabled={!documentPrepared || pageCount <= selectionCount} onClick={() => void onDelete()}><Trash2 size={15} /> Delete {selectionCount === 1 ? "page" : "pages"}</button>
            <button data-tooltip="Show or hide page thumbnails and document bookmarks" data-tooltip-align="start" className={dropdownItem} aria-pressed={sidebarOpen} onClick={() => void onToggleSidebar()}><PanelLeft size={15} /> {sidebarOpen ? "Hide" : "Show"} navigation pane</button>
          </ToolbarDropdown>
        </div>
      </div>
      <div className="hidden min-w-0 flex-col gap-2 border-r border-white/10 px-2 pb-1 pt-2 min-[1680px]:flex">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page Edit</span>
        <div className="flex justify-center">
          <button data-tooltip="Append all pages from another local PDF" data-tooltip-align="start" className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onMerge()}><FilePlus2 size={16} /> Merge</button>
          <button data-tooltip={`Export ${selectedPagesLabel} as a new PDF`} className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onSplit()}><Scissors size={16} /> Split</button>
          <button data-tooltip={`Make a copy of ${selectedPagesLabel}`} className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onDuplicate()}><Copy size={16} /> Duplicate</button>
          <button data-tooltip={`Remove ${selectedPagesLabel} from the document`} className={iconButton + " toolbar-tooltip text-red-300"} disabled={!documentPrepared || pageCount <= selectionCount} onClick={() => void onDelete()}><Trash2 size={16} /> Delete</button>
          <button aria-label={`${sidebarOpen ? "Hide" : "Show"} navigation pane`} aria-pressed={sidebarOpen} data-tooltip="Show or hide page thumbnails and document bookmarks" className={iconButton + (sidebarOpen ? " bg-white/10 text-zinc-100" : "")} onClick={() => void onToggleSidebar()}><PanelLeft size={16} /><span className="hidden min-[1850px]:inline">Navigation</span></button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">History</span>
        <div className="flex justify-center">
          <button className={compactToolButton + " text-sky-300"} data-tooltip="Undo the most recent document change" disabled={!canUndo} onClick={() => void onUndo()}><Undo2 size={16} /><span className="hidden min-[1200px]:inline">Undo</span></button>
          <button className={compactToolButton + " text-sky-300"} data-tooltip="Restore the most recently undone change" disabled={!canRedo} onClick={() => void onRedo()}><Redo2 size={16} /><span className="hidden min-[1200px]:inline">Redo</span></button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">Rotate</span>
        <div className="flex justify-center">
          <button className={compactToolButton + " text-amber-300"} data-tooltip={`Rotate ${selectedPagesLabel} 90 degrees counterclockwise`} disabled={!documentPrepared} onClick={() => onRotate(-90)}><RotateCcw size={16} /><span className="hidden min-[1200px]:inline">Left</span></button>
          <button className={compactToolButton + " text-amber-300"} data-tooltip={`Rotate ${selectedPagesLabel} 90 degrees clockwise`} disabled={!documentPrepared} onClick={() => onRotate(90)}><RotateCw size={16} /><span className="hidden min-[1200px]:inline">Right</span></button>
        </div>
      </div>

      <div data-testid="markup-toolbar-group" className="flex min-w-0 flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-orange-400/80">Markup</span>
        <div className="flex justify-center">
          <button aria-label="Select" className={compactToolButton + selectedToolClass("select")} data-tooltip="Select, move, resize, or delete an annotation" onClick={() => onToolChange("select")}><MousePointer2 size={16} /><span className="hidden min-[1400px]:inline">Select</span></button>
          <button className={compactToolButton + selectedToolClass("text")} data-tooltip="Click a page to place and edit a text box" onClick={() => onToolChange("text")} disabled={markupDisabled}><Type size={16} /><span className="hidden min-[1400px]:inline">Text</span></button>
          <button className={compactToolButton + selectedToolClass("pen")} data-tooltip="Draw freehand ink on a page" onClick={() => onToolChange("pen")} disabled={markupDisabled}><PenLine size={16} /><span className="hidden min-[1400px]:inline">Pen</span></button>
          <button className={compactToolButton + selectedToolClass("highlight")} data-tooltip="Draw a translucent highlight over page content" onClick={() => onToolChange("highlight")} disabled={markupDisabled}><Highlighter size={16} /><span className="hidden min-[1400px]:inline">Highlight</span></button>
          <button className={compactToolButton + selectedToolClass("image")} data-tooltip="Click a page to insert a local image or signature" onClick={() => onToolChange("image")} disabled={markupDisabled}><ImagePlus size={16} /><span className="hidden min-[1400px]:inline">Image</span></button>
          <button className={compactToolButton + selectedToolClass("redact")} data-tooltip="Drag over content to permanently cover it when exported" onClick={() => onToolChange("redact")} disabled={markupDisabled}><ScanLine size={16} /><span className="hidden min-[1400px]:inline">Redact</span></button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-r border-white/10 px-1.5 pb-1 pt-2 min-[1680px]:hidden">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
        <div className="flex justify-center">
          <ToolbarDropdown label="Document" tooltip="Open document-wide cleanup and export tools" icon={<FileCheck2 size={16} />}>
            <button data-tooltip="Make form values permanent page content; fields can no longer be edited" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onFlattenForms()}><FileCheck2 size={15} /> Flatten forms</button>
            <button data-tooltip="Compress PDF structure; images are unchanged, so size may not decrease" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onOptimize()}><Minimize2 size={15} /> Optimize PDF</button>
            <button data-tooltip="Clear basic metadata only; attachments, scripts, layers, and comments may remain" className={dropdownItem} disabled={!documentPrepared} onClick={() => void onSanitize()}><ShieldCheck size={15} /> Sanitize metadata</button>
          </ToolbarDropdown>
        </div>
      </div>
      <div className="hidden min-w-0 flex-col gap-2 border-r border-white/10 px-2 pb-1 pt-2 min-[1680px]:flex">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">Document</span>
        <div className="flex justify-center">
          <button className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onFlattenForms()} data-tooltip="Make form values permanent page content; fields can no longer be edited"><FileCheck2 size={16} /> Flatten Forms</button>
          <button className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onOptimize()} data-tooltip="Compress PDF structure; images are unchanged, so size may not decrease"><Minimize2 size={16} /> Optimize</button>
          <button className={iconButton + " toolbar-tooltip"} disabled={!documentPrepared} onClick={() => void onSanitize()} data-tooltip="Clear basic metadata only; attachments, scripts, layers, and comments may remain"><ShieldCheck size={16} /> Sanitize</button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 px-1.5 pb-1 pt-2">
        <span className="mx-1 border-b border-white/10 px-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">View</span>
        <div className="flex items-center justify-center gap-0.5">
          <button className={compactToolButton + (searchOpen ? " bg-white/10 text-white" : "")} disabled={!hasDocument} onClick={() => void onToggleSearch()} data-tooltip="Search prepared text; image-only pages are OCR-processed in the background (Ctrl/Command+F)" data-tooltip-align="end"><Search size={16} /><span className="hidden min-[1200px]:inline">Find</span></button>
          <button className={compactToolButton} disabled={!hasDocument} onClick={() => onZoomChange(Math.max(0.25, zoom - 0.1))} data-tooltip="Decrease document zoom by 10%" data-tooltip-align="end"><ZoomOut size={16} /></button>
          <label className="flex h-8 items-center rounded border border-white/10 bg-black/15 px-1 text-xs text-zinc-400">
            <input aria-label="Zoom percentage" type="number" min="25" max="400" value={Math.round(zoom * 100)} disabled={!hasDocument} onChange={(event) => onZoomChange(Math.min(4, Math.max(0.25, Number(event.target.value) / 100)))} className="w-9 bg-transparent text-right text-xs text-zinc-300 outline-none" />%
          </label>
          <button className={compactToolButton} disabled={!hasDocument} onClick={() => onZoomChange(Math.min(4, zoom + 0.1))} data-tooltip="Increase document zoom by 10%" data-tooltip-align="end"><ZoomIn size={16} /></button>
          <ToolbarDropdown label="Fit" tooltip="Choose how pages scale within the workspace" tooltipAlign="end" icon={<Minimize2 size={16} />} className="[&_div]:left-auto [&_div]:right-0">
            <button data-tooltip="Scale the current page to the available workspace width" data-tooltip-align="end" className={dropdownItem + (viewMode === "fit-width" ? " bg-white/10 text-white" : "")} disabled={!hasDocument} onClick={() => onViewModeChange("fit-width")}><Minimize2 size={15} /> Fit to width</button>
            <button data-tooltip="Scale the current page to fit entirely within the workspace" data-tooltip-align="end" className={dropdownItem + (viewMode === "fit-page" ? " bg-white/10 text-white" : "")} disabled={!hasDocument} onClick={() => onViewModeChange("fit-page")}><FileCheck2 size={15} /> Fit entire page</button>
          </ToolbarDropdown>
        </div>
      </div>
    </div>
  );
}
