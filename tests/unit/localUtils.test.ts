import { describe, expect, it } from "vitest";
import {
  backupPath,
  clonePlain,
  createLocalId,
  fileUrlToPath,
  joinLocalPath,
  localPathKey,
  normalizeLocalPath,
  parsePageRanges
} from "../../src/localUtils";

describe("parsePageRanges", () => {
  it("expands, sorts, and de-duplicates page selections", () => {
    expect(parsePageRanges("5, 1-3, 2", 8)).toEqual({
      pages: [1, 2, 3, 5],
      error: ""
    });
  });

  it.each([
    ["", "Enter a page or range"],
    ["2-", "is not a valid page or range"],
    ["4-2", "must start with the lower page number"],
    ["0", "Pages must be between 1 and 5"],
    ["6", "Pages must be between 1 and 5"]
  ])("rejects invalid selection %j", (value, message) => {
    const result = parsePageRanges(value, 5);
    expect(result.pages).toEqual([]);
    expect(result.error).toContain(message);
  });
});

describe("cross-platform local paths", () => {
  it("joins Windows and Unix folders with their native separator", () => {
    expect(joinLocalPath("C:\\Documents\\PDFs", "edited.pdf")).toBe(
      "C:\\Documents\\PDFs\\edited.pdf"
    );
    expect(joinLocalPath("/home/user/PDFs/", "edited.pdf")).toBe(
      "/home/user/PDFs/edited.pdf"
    );
  });

  it("converts Windows, Unix, and network file URLs", () => {
    expect(fileUrlToPath("file:///C:/Users/Test/My%20File.pdf")).toBe(
      "C:/Users/Test/My File.pdf"
    );
    expect(fileUrlToPath("file:///Users/test/My%20File.pdf")).toBe(
      "/Users/test/My File.pdf"
    );
    expect(fileUrlToPath("file://server/share/My%20File.pdf")).toBe(
      "//server/share/My File.pdf"
    );
  });

  it("leaves non-file values unchanged", () => {
    expect(fileUrlToPath("https://example.test/document.pdf")).toBe(
      "https://example.test/document.pdf"
    );
    expect(fileUrlToPath("C:\\Documents\\file.pdf")).toBe(
      "C:\\Documents\\file.pdf"
    );
  });

  it("normalizes extended Windows paths and compares them case-insensitively", () => {
    expect(
      normalizeLocalPath("\\\\?\\C:\\Users\\Jacob\\Desktop\\Document.pdf")
    ).toBe("C:\\Users\\Jacob\\Desktop\\Document.pdf");
    expect(localPathKey("C:/Users/Jacob/Desktop/Document.pdf")).toBe(
      localPathKey("\\\\?\\c:\\users\\jacob\\desktop\\document.pdf")
    );
  });
});

describe("local document helpers", () => {
  it("creates a deterministic timestamped backup name", () => {
    expect(
      backupPath(
        "C:\\Documents\\report.pdf",
        new Date("2026-07-26T14:35:22.000Z")
      )
    ).toBe("C:\\Documents\\report.backup-20260726-143522.pdf");
  });

  it("deep-clones JSON-safe editor state", () => {
    const source = { annotations: [{ page: 1, text: "Original" }] };
    const copy = clonePlain(source);
    copy.annotations[0].text = "Changed";
    expect(source.annotations[0].text).toBe("Original");
  });

  it("creates UUID-shaped local identifiers", () => {
    expect(createLocalId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
