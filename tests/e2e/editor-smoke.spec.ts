import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function syntheticPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText("SovereignPDF Regression Test", {
      x: 72,
      y: 700,
      size: 24,
      font
    });
    page.drawText(`Page ${pageNumber} of 3`, {
      x: 72,
      y: 650,
      size: 18,
      font
    });
    page.drawText(
      pageNumber === 2
        ? "SEARCH_TARGET appears on this page."
        : "This is synthetic local test content.",
      { x: 72, y: 610, size: 14, font }
    );
  }
  return Buffer.from(await pdf.save());
}

async function imageOnlyPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 620, width: 468, height: 80 });
  return Buffer.from(await pdf.save());
}

async function largePdf(pageCount = 120) {
  const pdf = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Large document page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 18
    });
  }
  return Buffer.from(await pdf.save());
}

test("fresh preferences use privacy-conscious save defaults", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences" }).click();

  await expect(
    page.getByRole("checkbox", {
      name: /Confirm before overwriting/
    })
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: /Create automatic backup copies/
    })
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: /Flatten annotations by default/
    })
  ).toBeChecked();
  await expect(page.getByText("Network access is disabled.")).toBeVisible();
});

test("shows a visible error when a selected PDF cannot be parsed", async ({ page }) => {
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await pdfInputs.nth(0).setInputFiles({
    name: "damaged.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("This is not a PDF.")
  });

  await expect(page.getByRole("alert")).toContainText("Unable to complete that action");
});

test("shows document and page loading feedback instead of a blank preview", async ({
  page
}) => {
  await page.addInitScript(() => {
    const readBlob = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      return readBlob.call(this);
    };
  });
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await pdfInputs.nth(0).setInputFiles({
    name: "loading-state.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  const loadingStatus = page.getByRole("status", {
    name: "Document loading status"
  });
  await expect(loadingStatus).toBeVisible();
  await expect(loadingStatus).toContainText("Reading loading-state.pdf");
  await expect(page.locator('[aria-label="Page 1"]')).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Rendering page 1" })
  ).toBeHidden({ timeout: 15_000 });
});

test("loads, searches, rotates, annotates, and restores history", async ({
  page
}) => {
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await expect(pdfInputs).toHaveCount(2);
  await pdfInputs.nth(0).setInputFiles({
    name: "regression.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  await expect(page.getByText("regression.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("3 pages", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Find" }).click();
  await page
    .getByRole("searchbox", { name: "Find in document" })
    .fill("SEARCH_TARGET");
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search result 1 on page 2" })
  ).toBeVisible();

  const pageOne = page.locator('[aria-label="Page 1"]');
  const pageTwo = page.locator('[aria-label="Page 2"]');
  const pageThree = page.locator('[aria-label="Page 3"]');

  const pageTwoThumbnail = page.getByRole("button", { name: "2", exact: true });
  await pageTwoThumbnail.click();
  await expect(pageTwoThumbnail).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Right" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect
    .poll(async () => {
      const box = await pageTwo.boundingBox();
      return (box?.width ?? 0) > (box?.height ?? 0);
    })
    .toBe(true);
  const rotated = await Promise.all([
    pageOne.boundingBox(),
    pageTwo.boundingBox(),
    pageThree.boundingBox()
  ]);
  expect(rotated[0]?.height).toBeGreaterThan(rotated[0]?.width ?? 0);
  expect(rotated[1]?.width).toBeGreaterThan(rotated[1]?.height ?? 0);
  expect(rotated[2]?.height).toBeGreaterThan(rotated[2]?.width ?? 0);
  await expect(pageTwoThumbnail).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => {
      const box = await pageTwo.boundingBox();
      return (box?.height ?? 0) > (box?.width ?? 0);
    })
    .toBe(true);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect
    .poll(async () => {
      const box = await pageTwo.boundingBox();
      return (box?.width ?? 0) > (box?.height ?? 0);
    })
    .toBe(true);

  await page
    .locator(
      'button[data-tooltip="Click a page to place and edit a text box"]'
    )
    .click();
  const pageTwoAnnotationLayer = pageTwo.getByLabel("Annotation layer");
  await expect(pageTwoAnnotationLayer).toBeVisible();
  await pageTwoAnnotationLayer.click({ position: { x: 180, y: 120 } });
  const textInput = page.getByRole("textbox", { name: "Text annotation" });
  await expect(textInput).toHaveAttribute("placeholder", "Begin typing…");
  await textInput.fill("Regression note");
  await textInput.press("Enter");
  await expect(page.getByText("Regression note", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByText("Regression note", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Regression note", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Select" }).click();
  await page.locator('[data-annotation-kind="text"]').click();
  const annotationToolbar = page.getByRole("region", {
    name: "Edit selected text annotation"
  });
  await expect(annotationToolbar).toBeVisible();
  const selectedText = annotationToolbar.getByRole("textbox", {
    name: "Selected text content"
  });
  await selectedText.fill("Edited regression note");
  await selectedText.blur();
  await expect(
    page.getByText("Edited regression note", { exact: true })
  ).toBeVisible();

  await pageTwo.click({ position: { x: 400, y: 400 } });
  await expect(annotationToolbar).toBeHidden();
});

test("shows document status and provides searchable keyboard shortcuts", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "professional-status.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  const statusBar = page.getByRole("contentinfo", { name: "Document status" });
  await expect(statusBar).toContainText("Page 1 of 3");
  await expect(statusBar).toContainText("612 × 792 pt");
  await expect(statusBar).toContainText("Saved");

  await page.keyboard.press("Control+/");
  const shortcutDialog = page.getByRole("dialog", {
    name: "Keyboard shortcuts"
  });
  await expect(shortcutDialog).toBeVisible();
  await shortcutDialog
    .getByRole("textbox", { name: "Search keyboard shortcuts" })
    .fill("actual size");
  await expect(shortcutDialog).toContainText("Ctrl/⌘ 1");
  await shortcutDialog.getByRole("button", { name: "Done" }).click();

  await page.keyboard.press("Control+1");
  await expect(page.getByLabel("Zoom percentage")).toHaveValue("100");
});

test("persists the selected application theme locally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("toolbar does not overflow at the minimum window size", async ({
  page
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test("opens local print options from Ctrl+P and validates page ranges", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "print.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });
  await expect(page.getByText("3 pages", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+P");
  const dialog = page.getByRole("dialog", { name: "Print PDF" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Pages or ranges")).toHaveValue("1-3");
  await dialog.getByLabel(/landscape/i).check();
  await expect(dialog.getByLabel(/landscape/i)).toBeChecked();
  await dialog.getByLabel("Pages or ranges").fill("4");
  await dialog.getByRole("button", { name: "Open Print Dialog" }).click();
  await expect(dialog).toContainText("Pages must be between 1 and 3");
});

test("keeps distant pages virtualized in a large document", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await pdfInputs.nth(0).setInputFiles({
    name: "large.pdf",
    mimeType: "application/pdf",
    buffer: await largePdf()
  });

  await expect(page.getByText("120 pages", { exact: true })).toBeVisible();
  await expect(page.locator("[data-virtual-page]")).toHaveCount(120);
  await expect
    .poll(() => page.locator("[data-page-mounted]").count())
    .toBeLessThan(20);
});

test("secure redaction removes underlying text only from affected pages", async ({
  page
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "redaction.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });
  await expect(page.getByText("3 pages", { exact: true })).toBeVisible();

  await page.locator(
    'button[data-tooltip="Drag over content to permanently cover it when exported"]'
  ).click();
  const layer = page.locator('[aria-label="Page 1"] [aria-label="Annotation layer"]');
  await layer.dragTo(layer, {
    sourcePosition: { x: 60, y: 70 },
    targetPosition: { x: 360, y: 130 }
  });

  await page.getByRole("button", { name: "Save PDF As" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Continue" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = new Uint8Array(await import("node:fs/promises").then((fs) =>
    fs.readFile(path!)
  ));
  const pdf = await getDocument({ data: bytes }).promise;
  const pageOneText = (await (await pdf.getPage(1)).getTextContent()).items
    .map((item) => "str" in item ? item.str : "")
    .join(" ");
  const pageTwoText = (await (await pdf.getPage(2)).getTextContent()).items
    .map((item) => "str" in item ? item.str : "")
    .join(" ");
  expect(pageOneText).not.toContain("SovereignPDF Regression Test");
  expect(pageTwoText).toContain("SovereignPDF Regression Test");
  await pdf.destroy();
});

test("protects unsaved work and writes a local recovery snapshot", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "recovery.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });
  await page.locator(
    'button[data-tooltip="Click a page to place and edit a text box"]'
  ).click();
  await page.locator('[aria-label="Page 1"]').click({
    position: { x: 180, y: 120 }
  });
  const input = page.getByRole("textbox", { name: "Text annotation" });
  await input.fill("Recover this note");
  await input.press("Enter");

  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("sovereignpdf-local-recovery", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const snapshot = await new Promise<{ annotations?: unknown[] } | undefined>(
      (resolve, reject) => {
        const request = db.transaction("snapshots").objectStore("snapshots").get("browser-main");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    db.close();
    return snapshot?.annotations?.length ?? 0;
  })).toBe(1);

  const closeWasPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(closeWasPrevented).toBe(true);
});

test("starts offline OCR in the background for an image-only PDF", async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await pdfInputs.nth(0).setInputFiles({
    name: "image-only.pdf",
    mimeType: "application/pdf",
    buffer: await imageOnlyPdf()
  });

  await expect(page.getByText("image-only.pdf", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Find in document" })
  ).toHaveCount(0);
  const status = page.getByRole("status", { name: "Background OCR status" });
  await expect(status).toBeVisible({ timeout: 20_000 });
  await expect(status).toContainText(
    /Loading local OCR engine|initializing tesseract|Recognizing page|OCR complete/
  );
});
