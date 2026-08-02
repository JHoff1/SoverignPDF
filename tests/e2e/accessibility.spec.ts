import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function onePagePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText("Accessible local PDF", {
    x: 72,
    y: 700,
    size: 20
  });
  return Buffer.from(await pdf.save());
}

async function loadDocument(page: import("@playwright/test").Page) {
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]')
    .first()
    .setInputFiles({
      name: "accessibility.pdf",
      mimeType: "application/pdf",
      buffer: await onePagePdf()
    });
  await expect(page.locator('[data-page-mounted="1"] canvas')).toBeVisible();
}

test("supports keyboard navigation, named controls, and Escape", async ({ page }) => {
  await page.goto("/");
  await loadDocument(page);

  const unnamedControls = await page.locator(
    "button:visible, input:visible, select:visible, textarea:visible, [role=button]:visible"
  ).evaluateAll((elements) => elements.filter((element) => {
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    const labelledBy = element.getAttribute("aria-labelledby");
    const label = element.getAttribute("aria-label") ||
      (labelledBy ? document.getElementById(labelledBy)?.textContent : "") ||
      element.textContent ||
      (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "");
    return !label?.trim();
  }).map((element) => element.outerHTML.slice(0, 180)));
  expect(unnamedControls, `Unnamed interactive controls: ${unnamedControls.join("\n")}`)
    .toEqual([]);

  await page.getByRole("button", { name: "Preferences" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Preferences" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preferences" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preferences" })).toBeFocused();

  const focusSequence: string[] = [];
  await page.locator("body").focus();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    focusSequence.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element?.getAttribute("aria-label") || element?.textContent?.trim() || "";
    }));
  }
  expect(focusSequence.filter(Boolean).length).toBeGreaterThanOrEqual(6);
});

test("honors reduced motion and remains usable at a zoomed layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await loadDocument(page);

  const motion = await page.evaluate(() => {
    const sample = Array.from(document.querySelectorAll<HTMLElement>("button, [role=dialog]"))
      .filter((element) => element.offsetParent !== null)
      .slice(0, 25);
    return sample.map((element) => {
      const style = getComputedStyle(element);
      return {
        animation: style.animationDuration,
        transition: style.transitionDuration
      };
    });
  });
  for (const item of motion) {
    expect(parseFloat(item.animation) || 0).toBeLessThanOrEqual(0.001);
    expect(parseFloat(item.transition) || 0).toBeLessThanOrEqual(0.001);
  }

  await page.setViewportSize({ width: 900, height: 700 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByRole("button", { name: "Open PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preferences" })).toBeVisible();
  await expect(page.getByLabel("Document status")).toBeVisible();
});

test("keeps primary text and controls at WCAG AA contrast", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "light");
  const failures = await page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return [match[0], match[1], match[2], match[3] ?? 1];
    };
    const luminance = (rgb: number[]) => {
      const values = rgb.slice(0, 3).map((value) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const ratio = (one: number[], two: number[]) => {
      const [lighter, darker] = [luminance(one), luminance(two)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      "header button:not(:disabled), header [class*='font-semibold'], main button:not(:disabled)"
    )).filter((element) => element.offsetParent !== null && element.textContent?.trim());
    return candidates.flatMap((element) => {
      const foreground = parse(getComputedStyle(element).color);
      let backgroundElement: HTMLElement | null = element.closest(
        "header, aside, footer, main, .app-shell"
      );
      let background = [0, 0, 0, 0];
      // Use the nearest opaque surface. Semi-transparent hover/active layers
      // are composited over this surface by the browser and must not be
      // mistaken for an opaque white background.
      while (backgroundElement && background[3] < 0.99) {
        background = parse(getComputedStyle(backgroundElement).backgroundColor);
        backgroundElement = backgroundElement.parentElement?.closest(
          "header, aside, footer, main, .app-shell"
        ) ?? null;
      }
      if (background[3] < 0.99) background = [32, 35, 41, 1];
      const measured = ratio(foreground, background);
      return measured < 4.5
        ? [`${element.textContent?.trim()}: ${measured.toFixed(2)}:1 (${getComputedStyle(element).color} on ${getComputedStyle(element).backgroundColor}; surface ${background.join("/")})`]
        : [];
    });
  });
  expect(failures, `Contrast failures: ${failures.join(", ")}`).toEqual([]);
});
