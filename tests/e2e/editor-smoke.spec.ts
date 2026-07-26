import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

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

  await expect(page.getByRole("alert")).toContainText("Unable to open PDF");
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
  await pageTwo.click({ position: { x: 180, y: 120 } });
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
