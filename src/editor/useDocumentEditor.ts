import { useCallback, useMemo, useState } from "react";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFPage
} from "pdf-lib";
import { clonePlain, createLocalId } from "../localUtils";

export type Point = { x: number; y: number };
export type TextFont = "helvetica" | "times" | "courier";
export type TextStyle = {
  size: number;
  color: string;
  fontFamily: TextFont;
  bold: boolean;
  italic: boolean;
};

export type Annotation =
  | {
      id: string;
      kind: "text";
      page: number;
      x: number;
      y: number;
      text: string;
      size: number;
      color: string;
      fontFamily: TextFont;
      bold: boolean;
      italic: boolean;
    }
  | {
      id: string;
      kind: "pen";
      page: number;
      points: Point[];
      color: string;
      width: number;
      opacity: number;
    }
  | {
      id: string;
      kind: "highlight";
      page: number;
      points: Point[];
      color: string;
      width: number;
      opacity: number;
    }
  | {
      id: string;
      kind: "image";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      dataUrl: string;
    }
  | {
      id: string;
      kind: "redaction";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

type Snapshot = {
  bytes: Uint8Array;
  annotations: Annotation[];
  label: string;
};

function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function colorFromHex(hex: string) {
  const value = hex.replace("#", "");
  const parsed = Number.parseInt(value.length === 3
    ? value.split("").map((item) => item + item).join("")
    : value, 16);
  return rgb(
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  );
}

function pointOnPage(page: PDFPage, point: Point) {
  const { width, height } = page.getSize();
  return { x: point.x * width, y: height - point.y * height };
}

function standardFontFor(style: TextStyle) {
  if (style.fontFamily === "times") {
    if (style.bold && style.italic) return StandardFonts.TimesRomanBoldItalic;
    if (style.bold) return StandardFonts.TimesRomanBold;
    if (style.italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (style.fontFamily === "courier") {
    if (style.bold && style.italic) return StandardFonts.CourierBoldOblique;
    if (style.bold) return StandardFonts.CourierBold;
    if (style.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (style.bold && style.italic) return StandardFonts.HelveticaBoldOblique;
  if (style.bold) return StandardFonts.HelveticaBold;
  if (style.italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

export async function flattenPdf(
  source: Uint8Array,
  annotations: Annotation[]
) {
  const pdf = await PDFDocument.load(source);
  const fonts = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>();

  for (const annotation of annotations) {
    const page = pdf.getPage(annotation.page - 1);
    if (!page) continue;
    const { width, height } = page.getSize();

    if (annotation.kind === "text") {
      const fontName = standardFontFor(annotation);
      let font = fonts.get(fontName);
      if (!font) {
        font = await pdf.embedFont(fontName);
        fonts.set(fontName, font);
      }
      page.drawText(annotation.text, {
        x: annotation.x * width,
        y: height - annotation.y * height - annotation.size,
        size: annotation.size,
        font,
        color: colorFromHex(annotation.color)
      });
    } else if (annotation.kind === "pen" || annotation.kind === "highlight") {
      for (let index = 1; index < annotation.points.length; index += 1) {
        page.drawLine({
          start: pointOnPage(page, annotation.points[index - 1]),
          end: pointOnPage(page, annotation.points[index]),
          thickness: annotation.width,
          color: colorFromHex(annotation.color),
          opacity: annotation.opacity,
          lineCap: 1
        });
      }
    } else if (annotation.kind === "redaction") {
      page.drawRectangle({
        x: annotation.x * width,
        y: height - (annotation.y + annotation.height) * height,
        width: annotation.width * width,
        height: annotation.height * height,
        color: rgb(0, 0, 0)
      });
    } else {
      const raw = annotation.dataUrl.split(",")[1];
      const data = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
      const image = annotation.dataUrl.startsWith("data:image/png")
        ? await pdf.embedPng(data)
        : await pdf.embedJpg(data);
      page.drawImage(image, {
        x: annotation.x * width,
        y: height - (annotation.y + annotation.height) * height,
        width: annotation.width * width,
        height: annotation.height * height
      });
    }
  }

  return pdf.save({ useObjectStreams: true });
}

export function useDocumentEditor() {
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedHistoryIndex, setSavedHistoryIndex] = useState(-1);

  const current = history[historyIndex] ?? null;

  const load = useCallback((bytes: Uint8Array) => {
    setHistory([{ bytes: cloneBytes(bytes), annotations: [], label: "Open document" }]);
    setHistoryIndex(0);
    setSavedHistoryIndex(0);
  }, []);

  const restore = useCallback((bytes: Uint8Array, annotations: Annotation[]) => {
    setHistory([{
      bytes: cloneBytes(bytes),
      annotations: clonePlain(annotations),
      label: "Recover unsaved work"
    }]);
    setHistoryIndex(0);
    setSavedHistoryIndex(-1);
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    setHistoryIndex(-1);
    setSavedHistoryIndex(-1);
  }, []);

  const commit = useCallback((snapshot: Snapshot) => {
    setHistory((previous) => {
      const next = previous.slice(0, historyIndex + 1);
      next.push({
        ...snapshot,
        // PDF bytes are treated as immutable. Keeping the same reference for
        // annotation-only commits prevents PDF.js from rebuilding every page.
        bytes: snapshot.bytes,
        annotations: clonePlain(snapshot.annotations)
      });
      return next.slice(-40);
    });
    setHistoryIndex((previous) => Math.min(previous + 1, 39));
  }, [historyIndex]);

  const transformPdf = useCallback(async (
    label: string,
    operation: (pdf: PDFDocument) => Promise<void> | void,
    transformAnnotations?: (items: Annotation[]) => Annotation[]
  ) => {
    if (!current) return;
    const pdf = await PDFDocument.load(current.bytes);
    await operation(pdf);
    const bytes = await pdf.save({ useObjectStreams: true });
    commit({
      bytes,
      annotations: transformAnnotations
        ? transformAnnotations(current.annotations)
        : current.annotations,
      label
    });
  }, [commit, current]);

  const rotate = useCallback((pageNumber: number, amount: number) =>
    transformPdf("Rotate page", (pdf) => {
      const page = pdf.getPage(pageNumber - 1);
      page.setRotation(degrees((page.getRotation().angle + amount + 360) % 360));
    }), [transformPdf]);

  const remove = useCallback((pageNumber: number) =>
    transformPdf("Delete page", (pdf) => pdf.removePage(pageNumber - 1), (items) =>
      items
        .filter((item) => item.page !== pageNumber)
        .map((item) => item.page > pageNumber ? { ...item, page: item.page - 1 } : item)
    ), [transformPdf]);

  const duplicate = useCallback((pageNumber: number) =>
    transformPdf("Duplicate page", async (pdf) => {
      const [copy] = await pdf.copyPages(pdf, [pageNumber - 1]);
      pdf.insertPage(pageNumber, copy);
    }, (items) => {
      const shifted = items.map((item) =>
        item.page > pageNumber ? { ...item, page: item.page + 1 } : item
      );
      const copies = items
        .filter((item) => item.page === pageNumber)
        .map((item) => ({ ...clonePlain(item), id: createLocalId(), page: pageNumber + 1 }));
      return [...shifted, ...copies];
    }), [transformPdf]);

  const reorder = useCallback((from: number, to: number) =>
    transformPdf("Reorder page", async (pdf) => {
      if (from === to) return;
      const [copy] = await pdf.copyPages(pdf, [from - 1]);
      pdf.removePage(from - 1);
      pdf.insertPage(to - 1, copy);
    }, (items) => items.map((item) => {
      if (item.page === from) return { ...item, page: to };
      if (from < to && item.page > from && item.page <= to) return { ...item, page: item.page - 1 };
      if (from > to && item.page >= to && item.page < from) return { ...item, page: item.page + 1 };
      return item;
    })), [transformPdf]);

  const merge = useCallback(async (otherBytes: Uint8Array) => {
    if (!current) return;
    const target = await PDFDocument.load(current.bytes);
    const source = await PDFDocument.load(otherBytes);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
    commit({
      bytes: await target.save({ useObjectStreams: true }),
      annotations: current.annotations,
      label: "Merge document"
    });
  }, [commit, current]);

  const extract = useCallback(async (pageNumbers: number[]) => {
    if (!current) return null;
    const source = await PDFDocument.load(current.bytes);
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, pageNumbers.map((page) => page - 1));
    pages.forEach((page) => output.addPage(page));
    return output.save({ useObjectStreams: true });
  }, [current]);

  const addAnnotation = useCallback((annotation: Annotation) => {
    if (!current) return;
    commit({
      bytes: current.bytes,
      annotations: [...current.annotations, annotation],
      label: `Add ${annotation.kind}`
    });
  }, [commit, current]);

  const flattenForms = useCallback(() =>
    transformPdf("Flatten form fields", (pdf) => {
      pdf.getForm().flatten();
    }), [transformPdf]);

  const sanitize = useCallback(() =>
    transformPdf("Sanitize metadata", (pdf) => {
      pdf.setTitle("");
      pdf.setAuthor("");
      pdf.setSubject("");
      pdf.setKeywords([]);
      pdf.setProducer("SovereignPDF");
      pdf.setCreator("SovereignPDF");
    }), [transformPdf]);

  const optimize = useCallback(() =>
    transformPdf("Optimize document", () => {
      // Re-saving with object streams removes unused indirect objects and
      // recompresses the document structure without sending data elsewhere.
    }), [transformPdf]);

  const removeAnnotation = useCallback((id: string) => {
    if (!current) return;
    commit({
      bytes: current.bytes,
      annotations: current.annotations.filter((item) => item.id !== id),
      label: "Delete annotation"
    });
  }, [commit, current]);

  const updateAnnotation = useCallback((
    id: string,
    updates: Partial<Annotation>,
    label = "Update annotation"
  ) => {
    if (!current) return;
    commit({
      bytes: current.bytes,
      annotations: current.annotations.map((item) =>
        item.id === id ? { ...item, ...updates } as Annotation : item
      ),
      label
    });
  }, [commit, current]);

  return useMemo(() => ({
    bytes: current?.bytes ?? null,
    annotations: current?.annotations ?? [],
    isDirty: Boolean(current) && historyIndex !== savedHistoryIndex,
    canUndo: historyIndex > 0,
    canRedo: historyIndex >= 0 && historyIndex < history.length - 1,
    undoLabel: history[historyIndex]?.label,
    load,
    clear,
    restore,
    markSaved: () => setSavedHistoryIndex(historyIndex),
    undo: () => setHistoryIndex((value) => Math.max(0, value - 1)),
    redo: () => setHistoryIndex((value) => Math.min(history.length - 1, value + 1)),
    rotate,
    remove,
    duplicate,
    reorder,
    merge,
    extract,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    flattenForms,
    sanitize,
    optimize,
    flattened: () => current ? flattenPdf(current.bytes, current.annotations) : null
  }), [
    addAnnotation, clear, current, duplicate, extract, history, historyIndex, load, restore,
    flattenForms, merge, optimize, remove, removeAnnotation, reorder, rotate,
    sanitize, savedHistoryIndex, updateAnnotation
  ]);
}
