import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export function VirtualizedPdfPage({
  page,
  scale,
  children
}: {
  page: PDFPageProxy;
  scale: number;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const viewport = useMemo(
    () => page.getViewport({ scale }),
    [page, scale]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: "1800px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      id={`page-${page.pageNumber}`}
      aria-label={`Page ${page.pageNumber}`}
      data-virtual-page={page.pageNumber}
      className="relative shrink-0 bg-zinc-100 shadow-2xl"
      style={{
        width: `${Math.ceil(viewport.width)}px`,
        height: `${Math.ceil(viewport.height)}px`
      }}
    >
      {nearViewport ? children : (
        <div
          className="page-skeleton absolute inset-0 flex items-center justify-center overflow-hidden text-xs text-zinc-400"
          aria-label={`Page ${page.pageNumber} placeholder`}
        >
          <span className="relative z-10 rounded-full bg-white/80 px-3 py-1.5 shadow-sm">
            Page {page.pageNumber}
          </span>
        </div>
      )}
    </div>
  );
}
