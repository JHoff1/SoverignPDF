import { useCallback, useMemo, useRef, useState } from "react";
import type { PDFDocument, PDFPage } from "pdf-lib";
import { clonePlain, createLocalId } from "../localUtils";

let pdfLibPromise: Promise<typeof import("pdf-lib")> | null = null;

function loadPdfLib() {
  pdfLibPromise ??= import("pdf-lib");
  return pdfLibPromise;
}

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

function colorFromHex(
  hex: string,
  rgb: typeof import("pdf-lib")["rgb"]
) {
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

function standardFontFor(
  style: TextStyle,
  StandardFonts: typeof import("pdf-lib")["StandardFonts"]
) {
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
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.load(source);
  const fonts = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>();

  for (const annotation of annotations) {
    const page = pdf.getPage(annotation.page - 1);
    if (!page) continue;
    const { width, height } = page.getSize();

    if (annotation.kind === "text") {
      const fontName = standardFontFor(annotation, StandardFonts);
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
        color: colorFromHex(annotation.color, rgb)
      });
    } else if (annotation.kind === "pen" || annotation.kind === "highlight") {
      for (let index = 1; index < annotation.points.length; index += 1) {
        page.drawLine({
          start: pointOnPage(page, annotation.points[index - 1]),
          end: pointOnPage(page, annotation.points[index]),
          thickness: annotation.width,
          color: colorFromHex(annotation.color, rgb),
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
  const historyRef = useRef<Snapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const currentRef = useRef<Snapshot | null>(null);
  const transformQueue = useRef<Promise<void>>(Promise.resolve());

  const current = history[historyIndex] ?? null;
  historyRef.current = history;
  historyIndexRef.current = historyIndex;
  currentRef.current = current;

  const load = useCallback((bytes: Uint8Array) => {
    const next = [{ bytes: cloneBytes(bytes), annotations: [], label: "Open document" }];
    historyRef.current = next;
    historyIndexRef.current = 0;
    currentRef.current = next[0];
    setHistory(next);
    setHistoryIndex(0);
    setSavedHistoryIndex(0);
  }, []);

  const restore = useCallback((bytes: Uint8Array, annotations: Annotation[]) => {
    const next = [{
      bytes: cloneBytes(bytes),
      annotations: clonePlain(annotations),
      label: "Recover unsaved work"
    }];
    historyRef.current = next;
    historyIndexRef.current = 0;
    currentRef.current = next[0];
    setHistory(next);
    setHistoryIndex(0);
    setSavedHistoryIndex(-1);
  }, []);

  const clear = useCallback(() => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    currentRef.current = null;
    setHistory([]);
    setHistoryIndex(-1);
    setSavedHistoryIndex(-1);
  }, []);

  const commit = useCallback((snapshot: Snapshot) => {
    const stored = {
      ...snapshot,
      // PDF bytes are treated as immutable. Keeping the same reference for
      // annotation-only commits prevents PDF.js from rebuilding every page.
      bytes: snapshot.bytes,
      annotations: clonePlain(snapshot.annotations)
    };
    const next = [
      ...historyRef.current.slice(0, historyIndexRef.current + 1),
      stored
    ].slice(-40);
    const nextIndex = next.length - 1;
    historyRef.current = next;
    historyIndexRef.current = nextIndex;
    currentRef.current = stored;
    setHistory(next);
    setHistoryIndex(nextIndex);
  }, []);

  const transformPdf = useCallback((
    label: string,
    operation: (pdf: PDFDocument) => Promise<void> | void,
    transformAnnotations?: (items: Annotation[]) => Annotation[]
  ) => {
    const task = transformQueue.current.then(async () => {
      const source = currentRef.current;
      if (!source) return;
      const { PDFDocument } = await loadPdfLib();
      const pdf = await PDFDocument.load(source.bytes);
      await operation(pdf);
      const bytes = await pdf.save({ useObjectStreams: true });
      commit({
        bytes,
        annotations: transformAnnotations
          ? transformAnnotations(source.annotations)
          : source.annotations,
        label
      });
    });
    transformQueue.current = task.catch(() => undefined);
    return task;
  }, [commit]);

  const rotate = useCallback((pageNumber: number, amount: number) =>
    transformPdf("Rotate page", async (pdf) => {
      const { degrees } = await loadPdfLib();
      const page = pdf.getPage(pageNumber - 1);
      page.setRotation(degrees((page.getRotation().angle + amount + 360) % 360));
    }), [transformPdf]);

  const rotatePages = useCallback((pageNumbers: number[], amount: number) =>
    transformPdf(
      `Rotate ${pageNumbers.length} pages`,
      async (pdf) => {
        const { degrees } = await loadPdfLib();
        pageNumbers.forEach((pageNumber) => {
          const page = pdf.getPage(pageNumber - 1);
          if (!page) return;
          page.setRotation(degrees((page.getRotation().angle + amount + 360) % 360));
        });
      }
    ), [transformPdf]);

  const remove = useCallback((pageNumber: number) =>
    transformPdf("Delete page", (pdf) => pdf.removePage(pageNumber - 1), (items) =>
      items
        .filter((item) => item.page !== pageNumber)
        .map((item) => item.page > pageNumber ? { ...item, page: item.page - 1 } : item)
    ), [transformPdf]);

  const removePages = useCallback((pageNumbers: number[]) => {
    const selected = new Set(pageNumbers);
    return transformPdf(
      `Delete ${pageNumbers.length} pages`,
      (pdf) => {
        [...selected]
          .sort((left, right) => right - left)
          .forEach((pageNumber) => pdf.removePage(pageNumber - 1));
      },
      (items) => items
        .filter((item) => !selected.has(item.page))
        .map((item) => ({
          ...item,
          page: item.page - pageNumbers.filter((page) => page < item.page).length
        }))
    );
  }, [transformPdf]);

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

  const duplicatePages = useCallback(async (pageNumbers: number[]) => {
    if (!current) return;
    const { PDFDocument } = await loadPdfLib();
    const selected = new Set(pageNumbers);
    const source = await PDFDocument.load(current.bytes);
    const output = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= source.getPageCount(); pageNumber += 1) {
      const copies = await output.copyPages(
        source,
        selected.has(pageNumber)
          ? [pageNumber - 1, pageNumber - 1]
          : [pageNumber - 1]
      );
      copies.forEach((page) => output.addPage(page));
    }
    const annotations: Annotation[] = [];
    current.annotations.forEach((item) => {
      const shiftedPage = item.page +
        pageNumbers.filter((page) => page < item.page).length;
      annotations.push({ ...item, page: shiftedPage } as Annotation);
      if (selected.has(item.page)) {
        annotations.push({
          ...clonePlain(item),
          id: createLocalId(),
          page: shiftedPage + 1
        } as Annotation);
      }
    });
    commit({
      bytes: await output.save({ useObjectStreams: true }),
      annotations,
      label: `Duplicate ${pageNumbers.length} pages`
    });
  }, [commit, current]);

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

  const reorderPages = useCallback(async (pageNumbers: number[], target: number) => {
    if (!current) return;
    const { PDFDocument } = await loadPdfLib();
    const selected = [...new Set(pageNumbers)].sort((left, right) => left - right);
    if (!selected.length || selected.includes(target)) return;
    const source = await PDFDocument.load(current.bytes);
    const original = Array.from(
      { length: source.getPageCount() },
      (_, index) => index + 1
    );
    const selectedSet = new Set(selected);
    const remaining = original.filter((pageNumber) => !selectedSet.has(pageNumber));
    const targetIndex = remaining.findIndex((pageNumber) => pageNumber >= target);
    const insertionIndex = targetIndex === -1 ? remaining.length : targetIndex;
    const order = [
      ...remaining.slice(0, insertionIndex),
      ...selected,
      ...remaining.slice(insertionIndex)
    ];
    const output = await PDFDocument.create();
    const copies = await output.copyPages(
      source,
      order.map((pageNumber) => pageNumber - 1)
    );
    copies.forEach((page) => output.addPage(page));
    const newPageByOldPage = new Map(
      order.map((oldPage, index) => [oldPage, index + 1])
    );
    commit({
      bytes: await output.save({ useObjectStreams: true }),
      annotations: current.annotations.map((item) => ({
        ...item,
        page: newPageByOldPage.get(item.page) ?? item.page
      } as Annotation)),
      label: `Reorder ${selected.length} pages`
    });
  }, [commit, current]);

  const merge = useCallback(async (otherBytes: Uint8Array) => {
    if (!current) return;
    const { PDFDocument } = await loadPdfLib();
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

  const mergeMany = useCallback(async (
    documents: Array<{ bytes: Uint8Array; current: boolean }>
  ) => {
    if (!current || !documents.length) return;
    const { PDFDocument } = await loadPdfLib();
    const output = await PDFDocument.create();
    let pagesBeforeCurrent = 0;
    let currentReached = false;
    for (const document of documents) {
      const source = await PDFDocument.load(document.bytes);
      const copies = await output.copyPages(source, source.getPageIndices());
      copies.forEach((page) => output.addPage(page));
      if (document.current) currentReached = true;
      else if (!currentReached) pagesBeforeCurrent += source.getPageCount();
    }
    commit({
      bytes: await output.save({ useObjectStreams: true }),
      annotations: current.annotations.map((item) => ({
        ...item,
        page: item.page + pagesBeforeCurrent
      } as Annotation)),
      label: `Merge ${documents.length} documents`
    });
  }, [commit, current]);

  const extract = useCallback(async (pageNumbers: number[]) => {
    if (!current) return null;
    const { PDFDocument } = await loadPdfLib();
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
      pdf.setProducer("");
      pdf.setCreator("");
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
    rotatePages,
    remove,
    removePages,
    duplicate,
    duplicatePages,
    reorder,
    reorderPages,
    merge,
    mergeMany,
    extract,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    flattenForms,
    sanitize,
    optimize,
    flattened: () => current ? flattenPdf(current.bytes, current.annotations) : null
  }), [
    addAnnotation, clear, current, duplicate, duplicatePages, extract, history, historyIndex, load, restore,
    flattenForms, merge, mergeMany, optimize, remove, removePages, removeAnnotation, reorder, reorderPages, rotate, rotatePages,
    sanitize, savedHistoryIndex, updateAnnotation
  ]);
}
