# VerityPDF release checklist

Complete this checklist on at least one native desktop build before tagging a
release. Browser preview testing does not exercise the operating system's native
window-close event.

## Automated gates

- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `npm run test:accessibility`
- [ ] `npm run test:performance`
- [ ] `npm audit --audit-level=high`
- [ ] `cargo audit --file src-tauri/Cargo.lock`
- [ ] `cargo deny --manifest-path src-tauri/Cargo.toml check licenses bans sources`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked`

## Native window-close regression

Use a disposable PDF and repeat the dirty-document cases for page edits and
annotations.

- [ ] A clean document closes immediately from the native window X.
- [ ] A modified document shows Save, Discard, and Cancel from the native X.
- [ ] Cancel leaves the window open with all unsaved work intact.
- [ ] Discard removes the recovery snapshot and closes the window.
- [ ] Save writes the PDF successfully and then closes the window.
- [ ] Canceling a Save As picker leaves the window open and still marked dirty.
- [ ] A failed save leaves the window open and displays an actionable error.
- [ ] Closing one PDF window does not close a second open PDF window.

## Recovery and file-open handoff

- [ ] Launching VerityPDF by opening a PDF keeps that requested PDF in the original window.
- [ ] An available crash snapshot appears as a non-blocking recovered-work notice.
- [ ] Open in new window restores the snapshot without replacing the requested PDF.
- [ ] A failed recovery-window creation leaves the notice and snapshot available.
- [ ] Dismiss keeps the snapshot available under Preferences.
- [ ] Discard removes the selected local recovery snapshot.
- [ ] A missing or corrupt snapshot produces an actionable local error without affecting the requested PDF.
- [ ] A recovered snapshot remains usable when its original source path no longer exists.

## Offline OCR

- [ ] Image-only PDFs finish background OCR and become searchable.
- [ ] A failed SIMD core falls back to the compatibility core.
- [ ] Runtime inspection shows no OCR requests to a CDN or non-local host.

## Save and print

- [ ] Overwriting an existing PDF leaves no `.tmp` file after success.
- [ ] Interrupting a test save before replacement leaves the original readable.
- [ ] Automatic backup mode preserves the previous file contents.
- [ ] `Ctrl`/`Command`+`P` opens the in-app print options.
- [ ] Custom page ranges reach the system print dialog.

## Native package smoke tests

- [ ] The ARM64 MSIX validates and its unpacked payload launches on a native
  Windows ARM64 runner; Partner Center accepts the package installation.
- [ ] The ARM64 executable reports PE machine type `AA64` and opens a PDF.
- [ ] Clean MSI and NSIS installs register VerityPDF as a PDF handler.
- [ ] MSI and NSIS upgrades from the previous release retain a working app.
- [ ] MSI and NSIS uninstall without leaving the application executable behind.

## Native accessibility review

Complete this review whenever navigation, dialogs, colors, or toolbar structure
changes. Browser automation cannot fully reproduce native webview and operating
system assistive-technology behavior.

- [ ] Windows: navigate the complete shell and native file dialogs with the
  keyboard and NVDA; confirm names, roles, state changes, and errors are spoken.
- [ ] macOS: repeat the primary open, edit, save, print, Preferences, and error
  flows with VoiceOver and Full Keyboard Access.
- [ ] Linux: repeat the primary flows with Orca under a supported desktop.
- [ ] At 200% interface scaling, no primary control is clipped or unreachable.
- [ ] Windows High Contrast and macOS Increase Contrast preserve visible focus,
  selected, disabled, and destructive states.
- [ ] Reduced-motion mode removes nonessential animation without hiding state.
- [ ] Focus returns to the invoking control after every in-app dialog closes.

## Published release

- [ ] Windows `.exe` and `.msi` are attached.
- [ ] macOS `.dmg` is attached.
- [ ] Linux `.deb` and `.AppImage` are attached.
- [ ] `SHA256SUMS.txt` is attached and matches all five installers.
- [ ] `VerityPDF-sbom.spdx.json` is attached.
- [ ] GitHub provenance and SBOM attestations verify for the stable installers.
- [ ] The release is public, not a draft, and marked latest.
