import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
import { createFormIntegrityPdf } from "../fixtures/pdfFixtures";

async function loadPdf(page: Page, bytes: Buffer) {
  await page.goto("/");
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: "export-integrity.pdf",
      mimeType: "application/pdf",
      buffer: bytes
    });
  await expect(page.getByText("2 pages", { exact: true })).toBeVisible({
    timeout: 20_000
  });
}

async function downloadExport(page: Page) {
  await page.getByRole("button", { name: "Save PDF As" }).click();
  await page.getByRole("dialog", { name: "Review export" })
    .getByRole("button", { name: "Continue to Save As" })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "Save PDF As" })
    .getByRole("button", { name: "Continue" })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("The exported PDF did not produce a download.");
  return new Uint8Array(await readFile(path));
}

test("preserves document structure while flattening forms and clearing metadata", async ({
  page
}) => {
  test.setTimeout(120_000);
  await loadPdf(page, await createFormIntegrityPdf());

  const documentMenu = page.locator("summary").filter({ hasText: "Document" });
  await documentMenu.click();
  await page.getByRole("button", { name: "Flatten forms" }).click();
  await page.getByRole("button", { name: "Sanitize metadata" }).click();

  const bytes = await downloadExport(page);
  const exported = await PDFDocument.load(bytes);
  expect(exported.getPageCount()).toBe(2);
  expect(exported.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(exported.getPage(1).getSize()).toEqual({ width: 792, height: 612 });
  expect(exported.getPage(1).getRotation().angle).toBe(90);
  expect(exported.getForm().getFields()).toHaveLength(0);
  expect(exported.getTitle() || "").not.toContain("Private");
  expect(exported.getAuthor() || "").not.toContain("Private");
  expect(exported.getSubject() || "").not.toContain("Private");
  expect(exported.getKeywords() || "").not.toContain("private");
  expect(exported.getProducer() || "").not.toContain("Private");
  expect(exported.getCreator() || "").not.toContain("Private");

  const rendered = await getDocument({ data: bytes.slice() }).promise;
  const firstPageText = (await (await rendered.getPage(1)).getTextContent()).items
    .map((item) => "str" in item ? item.str : "")
    .join(" ");
  const secondPageText = (await (await rendered.getPage(2)).getTextContent()).items
    .map((item) => "str" in item ? item.str : "")
    .join(" ");
  expect(firstPageText).toContain("ORIGINAL_PAGE_ONE");
  expect(firstPageText).toContain("Visible local value");
  expect(secondPageText).toContain("ORIGINAL_PAGE_TWO");
  await rendered.destroy();
});

test("embeds text annotations as searchable page content", async ({ page }) => {
  await loadPdf(page, await createFormIntegrityPdf());
  await page.locator(
    'button[data-tooltip="Click a page to place and edit a text box"]'
  ).click();
  await page.locator('[aria-label="Page 1"] [aria-label="Annotation layer"]')
    .click({ position: { x: 180, y: 160 } });
  const annotation = page.getByRole("textbox", { name: "Text annotation" });
  await annotation.fill("SEARCHABLE_EXPORT_NOTE");
  await annotation.press("Enter");

  const bytes = await downloadExport(page);
  const rendered = await getDocument({ data: bytes.slice() }).promise;
  const text = (await (await rendered.getPage(1)).getTextContent()).items
    .map((item) => "str" in item ? item.str : "")
    .join(" ");
  expect(text).toContain("SEARCHABLE_EXPORT_NOTE");
  await rendered.destroy();
});

test("exports a local privacy-scrubbed diagnostic report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export diagnostic report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("VerityPDF-diagnostics.txt");
  const path = await download.path();
  if (!path) throw new Error("The diagnostic report did not download.");
  const report = await readFile(path, "utf8");
  expect(report).toContain("VerityPDF local diagnostic report");
  expect(report).toContain("Document loaded: no");
  expect(report).toContain("document contents, file names, recent-file paths");
  expect(report).not.toMatch(/[A-Z]:\\Users\\/i);
});
