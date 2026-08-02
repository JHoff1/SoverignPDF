import { expect, test } from "@playwright/test";
import { degrees, PDFDocument } from "pdf-lib";

async function unusualPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([72, 72]).drawText("TINY_PAGE", { x: 4, y: 36, size: 5 });
  const wide = pdf.addPage([2_000, 200]);
  wide.setRotation(degrees(180));
  wide.drawText("WIDE_PAGE", { x: 72, y: 100, size: 24 });
  pdf.addPage([200, 2_000]).drawText("TALL_PAGE", { x: 20, y: 1_900, size: 18 });
  return Buffer.from(await pdf.save());
}

test("recovers after malformed and truncated PDFs without replacing the workspace", async ({
  page
}) => {
  await page.goto("/");
  const input = page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first();
  for (const [name, bytes] of [
    ["invalid-header.pdf", Buffer.from("not a PDF")],
    ["truncated.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>")]
  ] as const) {
    await input.setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
    await expect(page.getByRole("alert")).toContainText(
      "Unable to complete that action"
    );
    await page.getByRole("button", { name: "Dismiss error message" }).click();
    await expect(
      page.getByRole("contentinfo", { name: "Document status" })
    ).toContainText("No document");
  }

  await input.setInputFiles({
    name: "unusual-pages.pdf",
    mimeType: "application/pdf",
    buffer: await unusualPdf()
  });
  await expect(page.getByText("3 pages", { exact: true })).toBeVisible({
    timeout: 20_000
  });
  await expect(page.locator('[aria-label="Page 1"] canvas')).toBeVisible();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.locator('[aria-label="Page 2"]')).toBeInViewport();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await expect(page.locator('[aria-label="Page 3"]')).toBeInViewport();
});

test("keeps memory bounded when opening a 500-page structural document", async ({
  page
}) => {
  test.setTimeout(90_000);
  const pdf = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= 500; pageNumber += 1) {
    pdf.addPage([612, 792]).drawText(`Page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 14
    });
  }
  await page.goto("/");
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: "five-hundred-pages.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save())
    });
  await expect(page.getByText("500 pages", { exact: true })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.locator("[data-virtual-page]")).toHaveCount(500);
  await expect.poll(() => page.locator("[data-page-mounted]").count())
    .toBeLessThanOrEqual(20);
});
