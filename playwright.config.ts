import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // PDF generation, rendering, and OCR are intentionally resource intensive.
  // Keeping two browser workers avoids false timeouts on hosted and modest
  // developer machines while still exercising independent specs concurrently.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 }
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
