import {
  getDocument,
  type PDFDocumentProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderPrintPages(
  pageNumbers: number[],
  bytes?: Uint8Array,
  existingDocument?: PDFDocumentProxy
) {
  const document = existingDocument ??
    await getDocument({ data: new Uint8Array(bytes!).buffer }).promise;
  try {
    const images: string[] = [];
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2400 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable for printing.");
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL("image/png"));
      page.cleanup();
    }
    return images;
  } finally {
    if (!existingDocument) await document.destroy();
  }
}

export async function printPdfPages({
  bytes,
  document,
  pageNumbers,
  title
}: {
  bytes?: Uint8Array;
  document?: PDFDocumentProxy;
  pageNumbers: number[];
  title: string;
}) {
  if (!bytes && !document) throw new Error("No PDF is available to print.");
  const images = await renderPrintPages(pageNumbers, bytes, document);
  const iframe = window.document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.border = "0";

  const pages = images
    .map(
      (source, index) =>
        `<section class="page"><img src="${source}" alt="Printed PDF page ${pageNumbers[index]}"></section>`
    )
    .join("");
  iframe.srcdoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 0.25in; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: white; }
      .page {
        display: flex;
        width: 100%;
        min-height: calc(100vh - 0.5in);
        align-items: center;
        justify-content: center;
        break-after: page;
        page-break-after: always;
      }
      .page:last-child { break-after: auto; page-break-after: auto; }
      img { display: block; max-width: 100%; max-height: calc(100vh - 0.5in); object-fit: contain; }
    </style>
  </head>
  <body>${pages}</body>
</html>`;

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        reject(new Error("The local print preview could not be created."));
        return;
      }
      const cleanup = () => iframe.remove();
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 300_000);
      try {
        printWindow.focus();
        printWindow.print();
        resolve();
      } catch (cause) {
        cleanup();
        reject(cause);
      }
    };
    iframe.onerror = () => {
      iframe.remove();
      reject(new Error("The local print preview could not be loaded."));
    };
    window.document.body.appendChild(iframe);
  });
}
