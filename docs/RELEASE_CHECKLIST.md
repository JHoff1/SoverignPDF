# SovereignPDF release checklist

Complete this checklist on at least one native desktop build before tagging a
release. Browser preview testing does not exercise the operating system's native
window-close event.

## Automated gates

- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
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

## Save and print

- [ ] Overwriting an existing PDF leaves no `.tmp` file after success.
- [ ] Interrupting a test save before replacement leaves the original readable.
- [ ] Automatic backup mode preserves the previous file contents.
- [ ] `Ctrl`/`Command`+`P` opens the in-app print options.
- [ ] Custom page ranges and portrait/landscape reach the system print dialog.

## Published release

- [ ] Windows `.exe` and `.msi` are attached.
- [ ] macOS `.dmg` is attached.
- [ ] Linux `.deb` and `.AppImage` are attached.
- [ ] `SHA256SUMS.txt` is attached and matches all five installers.
- [ ] The release is public, not a draft, and marked latest.
