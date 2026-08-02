export type DiagnosticSnapshot = {
  version: string;
  platform: string;
  desktop: boolean;
  pageCount: number;
  annotationCount: number;
  dirty: boolean;
  theme: string;
  viewMode: string;
  flattenAnnotations: boolean;
  automaticBackups: boolean;
  restoreSession: boolean;
  lastError?: string | null;
};

export function scrubDiagnosticText(value: string) {
  return value
    .replace(/[“"][^”"\r\n]*\.pdf[”"]/gi, '“[REDACTED_FILE]”')
    .replace(/[A-Z]:\\[^\r\n]+/gi, "[REDACTED_WINDOWS_PATH]")
    .replace(/\\\\[^\r\n]+/g, "[REDACTED_NETWORK_PATH]")
    .replace(/\/(?:Users|home|tmp)\/[^\r\n]+/gi, "[REDACTED_LOCAL_PATH]")
    .replace(/(?:^|\s)[^\\/:*?"<>|\r\n]*\.pdf\b/gi, " [REDACTED_FILE]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
}

export function createDiagnosticReport(snapshot: DiagnosticSnapshot) {
  const lines = [
    "VerityPDF local diagnostic report",
    `Generated: ${new Date().toISOString()}`,
    `Version: ${snapshot.version}`,
    `Platform: ${snapshot.platform || "unknown"}`,
    `Desktop runtime: ${snapshot.desktop ? "yes" : "no"}`,
    `Document loaded: ${snapshot.pageCount > 0 ? "yes" : "no"}`,
    `Page count: ${snapshot.pageCount}`,
    `Annotation count: ${snapshot.annotationCount}`,
    `Unsaved changes: ${snapshot.dirty ? "yes" : "no"}`,
    `Theme: ${snapshot.theme}`,
    `View mode: ${snapshot.viewMode}`,
    `Flatten annotations: ${snapshot.flattenAnnotations ? "yes" : "no"}`,
    `Automatic backups: ${snapshot.automaticBackups ? "yes" : "no"}`,
    `Restore interrupted sessions: ${snapshot.restoreSession ? "yes" : "no"}`,
    `Last error: ${snapshot.lastError ? scrubDiagnosticText(snapshot.lastError) : "none"}`,
    "",
    "Privacy note: document contents, file names, recent-file paths, save folders,",
    "recovery contents, and annotation contents are intentionally excluded."
  ];
  return `${lines.join("\n")}\n`;
}
