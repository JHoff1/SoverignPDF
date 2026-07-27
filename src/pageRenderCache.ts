import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

type CachedPageRender = {
  canvas: HTMLCanvasElement;
  pixels: number;
};

const MAX_PAGE_RENDER_CACHE_PIXELS = 6_000_000;
const pageRenderCache = new Map<string, CachedPageRender>();
const pageRenderCacheIds = new WeakMap<PDFPageProxy, number>();
let nextPageRenderCacheId = 1;
let pageRenderCachePixels = 0;

export function pageRenderCacheKey(
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

export function getCachedPageRender(key: string) {
  const cached = pageRenderCache.get(key);
  if (!cached) return null;
  pageRenderCache.delete(key);
  pageRenderCache.set(key, cached);
  return cached.canvas;
}

export function cachePageRender(key: string, canvas: HTMLCanvasElement) {
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
