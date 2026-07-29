import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function syntheticPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText("VerityPDF Regression Test", {
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

async function seedRecoverySnapshot(
  page: Page,
  {
    corrupt = false,
    fileName = "recovered-choice.pdf",
    sourcePath = "C:\\Unavailable\\recovered-choice.pdf"
  }: {
    corrupt?: boolean;
    fileName?: string;
    sourcePath?: string | null;
  } = {}
) {
  const encodedPdf = (await syntheticPdf()).toString("base64");
  await page.evaluate(async ({ corruptValue, encoded, name, path }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("sovereignpdf-local-recovery", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("snapshots")) {
          request.result.createObjectStore("snapshots", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const bytes = corruptValue
      ? "invalid recovery bytes"
      : Uint8Array.from(atob(encoded), (character) =>
          character.charCodeAt(0)
        ).buffer;
    const snapshot = {
      id: "browser-main",
      fileName: name,
      sourcePath: path,
      bytes,
      annotations: [{
        id: "recovered-text",
        kind: "text",
        page: 1,
        x: 0.2,
        y: 0.2,
        text: "Recovered local note",
        size: 18,
        color: "#222222",
        fontFamily: "helvetica",
        bold: false,
        italic: false
      }],
      updatedAt: Date.now()
    };
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction("snapshots", "readwrite")
        .objectStore("snapshots")
        .put({ id: "browser-main", revisions: [snapshot] });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  }, {
    corruptValue: corrupt,
    encoded: encodedPdf,
    name: fileName,
    path: sourcePath
  });
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
  await expect(
    page.getByRole("checkbox", {
      name: /Restore interrupted sessions/
    })
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: /Show export summary before saving/
    })
  ).toBeChecked();
  await expect(
    page.getByText("No background network requests are made.", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "About VerityPDF" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Privacy policy" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Source code" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Website" })
  ).toBeVisible();
  await expect(page.getByText("AGPL-3.0")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report an issue on GitHub" })
  ).toBeVisible();
});

test("forgets a completed session when a clean window closes", async ({ page }) => {
  await page.goto("/");
  const sessionKey = "sovereignpdf.last-session.v1";
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      sourcePath: "C:\\Documents\\finished.pdf",
      fileName: "finished.pdf"
    }));
    window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
  }, sessionKey);

  await expect.poll(
    () => page.evaluate((key) => window.localStorage.getItem(key), sessionKey)
  ).toBeNull();
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
  await expect(page.getByRole("banner")).not.toContainText(
    "Unable to complete that action"
  );
  await expect(page.getByRole("banner")).toContainText(
    "Drop a local PDF here or choose Open"
  );
  await expect(
    page.getByRole("alert").getByRole("button", { name: "Report issue" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").getByRole("button", { name: "Copy error details" })
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await expect(
    page.getByText("This PDF does not contain a bookmark outline.")
  ).toBeVisible();
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
  await expect(
    page.getByRole("contentinfo", { name: "Document status" })
  ).toContainText("Page 2 of 3");

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
  await expect(pageTwoAnnotationLayer).toHaveAttribute(
    "data-active-tool",
    "select"
  );
  await expect(
    page.getByRole("region", { name: "Edit selected text annotation" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByText("Regression note", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Regression note", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Select" }).click();
  const textSelectionBox = page.locator('[data-annotation-kind="text"]');
  await textSelectionBox.click();
  const textBoxSpacing = await textSelectionBox.evaluate((selection) => {
    const id = selection.getAttribute("data-annotation-id");
    const text = document.querySelector(`[data-annotation-text="${id}"]`);
    if (!text) return null;
    const selectionBounds = selection.getBoundingClientRect();
    const textBounds = text.getBoundingClientRect();
    return {
      top: textBounds.top - selectionBounds.top,
      right: selectionBounds.right - textBounds.right,
      bottom: selectionBounds.bottom - textBounds.bottom,
      left: textBounds.left - selectionBounds.left
    };
  });
  expect(textBoxSpacing).not.toBeNull();
  expect(textBoxSpacing!.top).toBeGreaterThanOrEqual(7);
  expect(textBoxSpacing!.right).toBeGreaterThanOrEqual(7);
  expect(textBoxSpacing!.bottom).toBeGreaterThanOrEqual(7);
  expect(textBoxSpacing!.left).toBeGreaterThanOrEqual(7);
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

test("uses a dual-contrast cursor for markup tools", async ({ page }) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "cursor-contrast.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  await expect(page.locator('[aria-label="Page 1"]')).toBeVisible();
  await page.locator(
    'button[data-tooltip="Draw freehand ink on a page"]'
  ).click();
  const annotationLayers = page.getByTestId("annotation-layer");
  await expect.poll(async () => annotationLayers.count()).toBeGreaterThan(0);
  const annotationLayer = annotationLayers.nth(0);
  await expect(annotationLayer).toHaveAttribute("data-active-tool", "pen");
  await expect.poll(async () =>
    annotationLayer.evaluate((element) => getComputedStyle(element).cursor)
  ).toContain("data:image/svg+xml");
});

test("handles completed, canceled, styled, and page-edge text placement", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "text-placement.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });
  const pageOne = page.locator('[aria-label="Page 1"]');
  const annotationLayer = pageOne.getByLabel("Annotation layer");
  await expect(annotationLayer).toBeVisible();

  const textTool = page.locator(
    'button[data-tooltip="Click a page to place and edit a text box"]'
  );
  await textTool.click();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Italic" }).click();
  const pageBounds = await pageOne.boundingBox();
  expect(pageBounds).not.toBeNull();
  await annotationLayer.click({
    position: {
      x: (pageBounds?.width ?? 500) - 8,
      y: (pageBounds?.height ?? 700) - 8
    }
  });
  const edgeInput = page.getByRole("textbox", { name: "Text annotation" });
  await edgeInput.fill("Wide styled edge text");
  await edgeInput.press("Enter");
  await expect(annotationLayer).toHaveAttribute("data-active-tool", "select");
  const styledText = page.locator('[data-annotation-text]').filter({
    hasText: "Wide styled edge text"
  });
  await expect(styledText).toHaveCSS("font-weight", "700");
  await expect(styledText).toHaveCSS("font-style", "italic");
  const containedAtEdge = await styledText.evaluate((element) => {
    const pageElement = element.closest('[aria-label^="Page "]');
    if (!pageElement) return false;
    const textBounds = element.getBoundingClientRect();
    const bounds = pageElement.getBoundingClientRect();
    return (
      textBounds.right <= bounds.right + 0.5 &&
      textBounds.bottom <= bounds.bottom + 0.5
    );
  });
  expect(containedAtEdge).toBe(true);

  await textTool.click();
  await annotationLayer.click({ position: { x: 140, y: 140 } });
  const blurInput = page.getByRole("textbox", { name: "Text annotation" });
  await blurInput.fill("Finish by clicking away");
  await page.getByRole("button", { name: "Preferences" }).click();
  await expect(
    page.getByText("Finish by clicking away", { exact: true })
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(annotationLayer).toHaveAttribute("data-active-tool", "select");

  await textTool.click();
  await annotationLayer.click({ position: { x: 180, y: 180 } });
  const canceledInput = page.getByRole("textbox", { name: "Text annotation" });
  await canceledInput.fill("Canceled text");
  await canceledInput.press("Escape");
  await expect(page.getByText("Canceled text", { exact: true })).toHaveCount(0);
  await expect(annotationLayer).toHaveAttribute("data-active-tool", "select");

  await textTool.click();
  await annotationLayer.click({ position: { x: 220, y: 220 } });
  const emptyInput = page.getByRole("textbox", { name: "Text annotation" });
  await emptyInput.press("Enter");
  await expect(annotationLayer).toHaveAttribute("data-active-tool", "select");
  await expect(page.getByRole("textbox", { name: "Text annotation" })).toHaveCount(0);
});

test("aligns text formatting controls beneath the Markup toolbar group", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "text-toolbar-alignment.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  await expect(page.locator('[aria-label="Page 1"]')).toBeVisible();
  await page.locator(
    'button[data-tooltip="Click a page to place and edit a text box"]'
  ).click();

  const markupGroup = page.getByTestId("markup-toolbar-group");
  const textControls = page.getByTestId("text-formatting-controls");
  await expect(textControls).toBeVisible();
  const expectMarkupAlignment = async () => {
    await expect.poll(async () => {
      const markupBox = await markupGroup.boundingBox();
      const controlsBox = await textControls.boundingBox();
      return Math.abs((markupBox?.x ?? 0) - (controlsBox?.x ?? 100));
    }).toBeLessThanOrEqual(2);
  };

  await expectMarkupAlignment();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expectMarkupAlignment();
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
  await expect(
    statusBar.getByLabel(/VerityPDF version \d+\.\d+\.\d+/)
  ).toBeVisible();
  await expect(
    statusBar.getByRole("button", { name: "Check for updates on GitHub" })
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Page 1 of 3", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(statusBar).toContainText("Page 2 of 3");

  await page.keyboard.press("Control+/");
  const shortcutDialog = page.getByRole("dialog", {
    name: "Keyboard shortcuts"
  });
  await expect(shortcutDialog).toBeVisible();
  await shortcutDialog
    .getByRole("textbox", { name: "Search keyboard shortcuts" })
    .fill("actual size");
  await expect(shortcutDialog).toContainText("Showing shortcuts for Windows and Linux");
  await expect(shortcutDialog).toContainText("Ctrl+1");
  await shortcutDialog.getByRole("button", { name: "Done" }).click();

  await page.keyboard.press("Control+1");
  await expect(page.getByLabel("Zoom percentage")).toHaveValue("100");
});

test("checks GitHub for updates only after the user requests it", async ({
  page
}) => {
  const updateApiUrl =
    "https://api.github.com/repos/JHoff1/VerityPDF/releases/latest";
  let latestTag = "v999.0.0";
  let failRequest = false;
  let requestCount = 0;

  await page.route(updateApiUrl, async (route) => {
    requestCount += 1;
    if (failRequest) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tag_name: latestTag })
    });
  });

  await page.goto("/");
  expect(requestCount).toBe(0);

  await page.getByRole("button", { name: "Check for updates on GitHub" }).click();
  await expect(
    page.getByRole("button", {
      name: /New version available: v999\.0\.0; open GitHub release/
    })
  ).toBeVisible();
  expect(requestCount).toBe(1);

  latestTag = "v0.0.0";
  await page.reload();
  await page.getByRole("button", { name: "Check for updates on GitHub" }).click();
  await expect(
    page.getByRole("button", { name: "VerityPDF is up to date; check again" })
  ).toBeVisible();

  failRequest = true;
  await page.reload();
  await page.getByRole("button", { name: "Check for updates on GitHub" }).click();
  await expect(
    page.getByRole("button", { name: "Unable to check for updates; try again" })
  ).toBeVisible();
  expect(requestCount).toBe(3);
});

test("navigates the viewer when a page thumbnail is clicked", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "thumbnail-navigation.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  const pageThree = page.locator('[aria-label="Page 3"]');
  await expect(page.locator('[aria-label="Page 1"]')).toBeVisible();
  await page.getByRole("button", { name: "3", exact: true }).click();

  await expect(pageThree).toBeInViewport();
  await expect(
    page.getByRole("contentinfo", { name: "Document status" })
  ).toContainText("Page 3 of 3");
});

test("toggles the navigation pane from Page Edit", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "navigation-pane.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide navigation pane" }).click();
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show navigation pane" }).click();
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeVisible();
});

test("selects and rotates multiple pages as one history action", async ({ page }) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "batch-pages.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  const firstThumbnail = page.getByRole("button", { name: "1", exact: true });
  const secondThumbnail = page.getByRole("button", { name: "2", exact: true });
  const thirdThumbnail = page.getByRole("button", { name: "3", exact: true });
  await firstThumbnail.click();
  await secondThumbnail.click({ modifiers: ["Control"] });
  await expect(
    page.getByRole("contentinfo", { name: "Document status" })
  ).toContainText("2 pages selected");

  await page.getByRole("button", { name: "Right" }).click();
  const pageOne = firstThumbnail.locator("canvas");
  const pageTwo = secondThumbnail.locator("canvas");
  const pageThree = thirdThumbnail.locator("canvas");
  await expect.poll(async () => {
    const [one, two, three] = await Promise.all([
      pageOne.boundingBox(),
      pageTwo.boundingBox(),
      pageThree.boundingBox()
    ]);
    return Boolean(
      one && two && three &&
      one.width > one.height &&
      two.width > two.height &&
      three.height > three.width
    );
  }).toBe(true);

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("contentinfo", { name: "Document status" })
  ).toContainText("Page 2 of 3");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => {
    const [one, two] = await Promise.all([
      pageOne.boundingBox(),
      pageTwo.boundingBox()
    ]);
    return Boolean(one && two && one.height > one.width && two.height > two.width);
  }).toBe(true);
});

test("stages merge files before combining them", async ({ page }) => {
  await page.goto("/");
  const pdfInputs = page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  );
  await pdfInputs.nth(0).setInputFiles({
    name: "merge-base.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });
  await pdfInputs.nth(1).setInputFiles({
    name: "merge-addition.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  const dialog = page.getByRole("dialog", { name: "Merge PDFs" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("merge-base.pdf");
  await expect(dialog).toContainText("merge-addition.pdf");
  await expect(dialog).toContainText("6 pages");
  await expect(dialog.getByAltText("merge-base.pdf, page 1")).toBeVisible();
  await dialog.getByRole("button", { name: "Move merge-base.pdf down" }).click();
  await dialog.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(page.getByText("6 pages", { exact: true })).toBeVisible();
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
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(dialog).toContainText(
    "where you can choose orientation and other printer settings"
  );
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

test("shows a clear empty annotation state in the export summary", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "no-annotations.pdf",
    mimeType: "application/pdf",
    buffer: await syntheticPdf()
  });

  await page.getByRole("button", { name: "Save PDF As" }).click();
  const summary = page.getByRole("dialog", { name: "Review export" });
  await expect(summary).toContainText("There are no annotations to flatten.");
  await expect(summary).not.toContainText("0 annotations will be flattened");
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
  const summary = page.getByRole("dialog", { name: "Review export" });
  await expect(summary).toContainText("1 affected page will be rasterized");
  await summary.getByRole("button", { name: "Continue to Save As" }).click();
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
  expect(pageOneText).not.toContain("VerityPDF Regression Test");
  expect(pageTwoText).toContain("VerityPDF Regression Test");
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
    const snapshot = await new Promise<{
      revisions?: Array<{ annotations?: unknown[] }>;
      annotations?: unknown[];
    } | undefined>(
      (resolve, reject) => {
        const request = db.transaction("snapshots").objectStore("snapshots").get("browser-main");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    db.close();
    return snapshot?.revisions?.[0]?.annotations?.length ??
      snapshot?.annotations?.length ??
      0;
  })).toBe(1);

  await page.getByRole("button", { name: "Preferences" }).click();
  const preferences = page.getByRole("dialog");
  await expect(
    preferences.getByRole("heading", { name: "Recovery snapshots" })
  ).toBeVisible();
  await expect(
    preferences.getByText("recovery.pdf", { exact: true })
  ).toBeVisible();
  await expect(
    preferences.getByRole("button", { name: "Restore" })
  ).toBeVisible();
  await expect(
    preferences.getByRole("button", { name: "Delete" })
  ).toBeVisible();
  await preferences.getByRole("button", { name: "Close" }).click();

  const closeWasPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(closeWasPrevented).toBe(true);
});

test("dismisses recovery while keeping it available in Preferences", async ({
  page
}) => {
  await page.goto("/");
  await seedRecoverySnapshot(page);
  await page.reload();
  const recovery = page.getByRole("dialog", {
    name: "Recover unsaved work?"
  });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Preferences" }).click();
  await expect(
    page.getByRole("dialog").getByText("recovered-choice.pdf", {
      exact: true
    })
  ).toBeVisible();
});

test("discards a recovery snapshot and does not offer it again", async ({
  page
}) => {
  await page.goto("/");
  await seedRecoverySnapshot(page);
  await page.reload();
  const recovery = page.getByRole("dialog", {
    name: "Recover unsaved work?"
  });
  await recovery.getByRole("button", { name: "Discard snapshot" }).click();
  await expect(recovery).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Recover unsaved work?" })
  ).toHaveCount(0);
});

test("recovers from local bytes when the original source file is unavailable", async ({
  page
}) => {
  await page.goto("/");
  await seedRecoverySnapshot(page, {
    sourcePath: "Z:\\Missing\\original.pdf"
  });
  await page.reload();
  await page.getByRole("dialog", {
    name: "Recover unsaved work?"
  }).getByRole("button", { name: "Recover" }).click();
  await expect(
    page.getByText("Recovered local note", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("contentinfo", { name: "Document status" })
  ).toContainText("Unsaved changes");
});

test("reports a corrupt recovery without deleting it", async ({ page }) => {
  await page.goto("/");
  await seedRecoverySnapshot(page, { corrupt: true });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "recovery snapshot was found but its document data is invalid"
  );
  await expect(
    page.getByRole("dialog", { name: "Recover unsaved work?" })
  ).toHaveCount(0);
  await page.getByRole("alert").getByRole("button", {
    name: "Dismiss error message"
  }).click();
  await page.getByRole("button", { name: "Preferences" }).click();
  await expect(
    page.getByRole("dialog").getByText("recovered-choice.pdf", {
      exact: true
    })
  ).toBeVisible();
});

test("does not show recovery UI when no snapshot exists", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "Recover unsaved work?" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Recovered work available" })
  ).toHaveCount(0);
});

test("finishes offline OCR in the background for an image-only PDF", async ({
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
    /Loading (accelerated )?offline OCR engine|Initializing offline OCR engine|Recognizing page|OCR complete/
  );
  await expect(status).toContainText(/OCR complete/, { timeout: 60_000 });
  await expect(status.locator("button")).toHaveAttribute(
    "data-tooltip",
    "Dismiss OCR status"
  );
});

test("falls back from SIMD OCR without making external network requests", async ({
  page
}) => {
  test.setTimeout(90_000);
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.route(
    "**/ocr/core/tesseract-core-simd-lstm.wasm.js",
    (route) => route.abort("failed")
  );
  await page.goto("/");
  await page.locator(
    'input[type="file"][accept="application/pdf,.pdf"]'
  ).nth(0).setInputFiles({
    name: "ocr-fallback.pdf",
    mimeType: "application/pdf",
    buffer: await imageOnlyPdf()
  });

  const status = page.getByRole("status", {
    name: "Background OCR status"
  });
  await expect(status).toContainText(/OCR complete/, { timeout: 60_000 });
  expect(
    requestedUrls.some((url) =>
      url.includes("tesseract-core-simd-lstm.wasm.js")
    )
  ).toBe(true);
  expect(
    requestedUrls.some((url) =>
      url.includes("tesseract-core-lstm.wasm.js")
    )
  ).toBe(true);
  const externalOcrRequests = requestedUrls.filter((url) => {
    if (!url.includes("ocr") && !url.includes("tesseract")) return false;
    const parsed = new URL(url);
    return !["127.0.0.1", "localhost"].includes(parsed.hostname);
  });
  expect(externalOcrRequests).toEqual([]);
});
