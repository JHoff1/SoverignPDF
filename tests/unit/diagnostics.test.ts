import { describe, expect, it } from "vitest";
import { createDiagnosticReport, scrubDiagnosticText } from "../../src/diagnostics";

describe("privacy-scrubbed diagnostics", () => {
  it("removes local paths, PDF names, email addresses, and network paths", () => {
    const source =
      'Could not open “Tax Return 2025.pdf” or bare-name.pdf at C:\\Users\\Person\\Documents\\Tax Return 2025.pdf for person@example.com from \\\\server\\private\\file.pdf';
    const scrubbed = scrubDiagnosticText(source);
    expect(scrubbed).not.toContain("Tax Return");
    expect(scrubbed).not.toContain("Person");
    expect(scrubbed).not.toContain("person@example.com");
    expect(scrubbed).not.toContain("server");
    expect(scrubbed).not.toContain("bare-name.pdf");
    expect(scrubbed).toContain("[REDACTED_FILE]");
  });

  it("includes useful state without document or annotation contents", () => {
    const report = createDiagnosticReport({
      version: "1.2.3",
      platform: "Win32",
      desktop: true,
      pageCount: 12,
      annotationCount: 3,
      dirty: true,
      theme: "system",
      viewMode: "fit-page",
      flattenAnnotations: true,
      automaticBackups: false,
      restoreSession: true,
      lastError: 'Could not open “private.pdf”.'
    });
    expect(report).toContain("Version: 1.2.3");
    expect(report).toContain("Page count: 12");
    expect(report).toContain("Unsaved changes: yes");
    expect(report).not.toContain("private.pdf");
  });
});
