import { expect, test } from "@playwright/test";
import {
  createLargeStructuralPdf,
  createUnusualPagePdf,
  malformedPdfFixtures
} from "../fixtures/pdfFixtures";

test("recovers after malformed and truncated PDFs without replacing the workspace", async ({
  page
}) => {
  await page.goto("/");
  const input = page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first();
  for (const [name, bytes] of malformedPdfFixtures) {
    await input.setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
    await expect(page.getByRole("alert")).toContainText(
      "Unable to complete that action",
      { timeout: 20_000 }
    );
    await page.getByRole("button", { name: "Dismiss error message" }).click();
    await expect(
      page.getByRole("contentinfo", { name: "Document status" })
    ).toContainText("No document");
  }

  await input.setInputFiles({
    name: "unusual-pages.pdf",
    mimeType: "application/pdf",
    buffer: await createUnusualPagePdf()
  });
  await expect(page.getByText("3 pages", { exact: true })).toBeVisible({
    timeout: 20_000
  });
  await expect(page.locator('[aria-label="Page 1"] canvas')).toBeVisible({
    timeout: 20_000
  });
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.locator('[aria-label="Page 2"]')).toBeInViewport();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await expect(page.locator('[aria-label="Page 3"]')).toBeInViewport();
});

test("keeps memory bounded when opening a 500-page structural document", async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: "five-hundred-pages.pdf",
      mimeType: "application/pdf",
      buffer: await createLargeStructuralPdf(500)
    });
  await expect(page.getByText("500 pages", { exact: true })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.locator("[data-virtual-page]")).toHaveCount(500, {
    timeout: 30_000
  });
  await expect.poll(() => page.locator("[data-page-mounted]").count())
    .toBeLessThanOrEqual(20);
});
