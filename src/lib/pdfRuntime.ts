import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";

let runtimePromise: Promise<typeof PdfJs> | null = null;

export function loadPdfRuntime() {
  runtimePromise ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")
  ]).then(([runtime, worker]) => {
    runtime.GlobalWorkerOptions.workerSrc = worker.default;
    return runtime;
  });
  return runtimePromise;
}
