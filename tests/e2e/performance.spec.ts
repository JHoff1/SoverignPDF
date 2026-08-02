import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const threshold = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback);

async function createPdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`VerityPDF performance page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 18,
      font
    });
  }
  return Buffer.from(await pdf.save());
}

async function createImageOnlyPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 620, width: 468, height: 80 });
  return Buffer.from(await pdf.save());
}

async function loadPdf(page: import("@playwright/test").Page, pages: number) {
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: `performance-${pages}-pages.pdf`,
      mimeType: "application/pdf",
      buffer: await createPdf(pages)
    });
}

test("keeps startup, rendering, zoom, memory, and scrolling within budgets", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const metrics: Record<string, number> = {};

  const startupStart = Date.now();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open PDF" })).toBeVisible();
  metrics.startupMs = Date.now() - startupStart;

  const renderStart = Date.now();
  await loadPdf(page, 3);
  const firstCanvas = page.locator('[data-page-mounted="1"] canvas').first();
  await expect(firstCanvas).toBeVisible();
  await expect.poll(() => firstCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  metrics.initialPageRenderMs = Date.now() - renderStart;

  const originalWidth = await firstCanvas.evaluate(
    (canvas: HTMLCanvasElement) => canvas.width
  );
  const zoomStart = Date.now();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => firstCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(originalWidth);
  metrics.zoomRerenderMs = Date.now() - zoomStart;

  await page.reload();
  const largeLoadStart = Date.now();
  await loadPdf(page, 120);
  await expect(page.locator('[data-virtual-page="120"]')).toHaveCount(1);
  await page.locator('[data-virtual-page="120"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page-mounted="120"]')).toHaveCount(1);
  metrics.largeDocumentScrollMs = Date.now() - largeLoadStart;
  metrics.mountedPages = await page.locator("[data-page-mounted]").count();

  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const performance = await session.send("Performance.getMetrics");
  metrics.jsHeapMb =
    (performance.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0) /
    1024 /
    1024;

  await testInfo.attach("performance-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json"
  });

  expect(metrics.startupMs).toBeLessThan(threshold("PERF_STARTUP_MS", 8_000));
  expect(metrics.initialPageRenderMs).toBeLessThan(
    threshold("PERF_INITIAL_RENDER_MS", 8_000)
  );
  expect(metrics.zoomRerenderMs).toBeLessThan(
    threshold("PERF_ZOOM_RENDER_MS", 5_000)
  );
  expect(metrics.largeDocumentScrollMs).toBeLessThan(
    threshold("PERF_LARGE_SCROLL_MS", 15_000)
  );
  expect(metrics.mountedPages).toBeLessThanOrEqual(
    threshold("PERF_MAX_MOUNTED_PAGES", 20)
  );
  expect(metrics.jsHeapMb).toBeLessThan(threshold("PERF_MAX_HEAP_MB", 350));
});

test("keeps offline OCR within its background-processing budget", async ({
  page
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const startedAt = Date.now();
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: "performance-ocr.pdf",
      mimeType: "application/pdf",
      buffer: await createImageOnlyPdf()
    });
  await expect(
    page.getByRole("status").filter({ hasText: /OCR complete/ })
  ).toBeVisible({ timeout: threshold("PERF_OCR_MS", 60_000) });
  const ocrMs = Date.now() - startedAt;
  await testInfo.attach("ocr-performance.json", {
    body: Buffer.from(JSON.stringify({ ocrMs }, null, 2)),
    contentType: "application/json"
  });
  expect(ocrMs).toBeLessThan(threshold("PERF_OCR_MS", 60_000));
});
