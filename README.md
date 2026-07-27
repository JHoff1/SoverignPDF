# SovereignPDF

> A lightweight, private, open-source desktop PDF editor with no subscriptions,
> cloud uploads, telemetry, or paywalls.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Build desktop release](https://github.com/JHoff1/SoverignPDF/actions/workflows/release.yml/badge.svg)](https://github.com/JHoff1/SoverignPDF/actions/workflows/release.yml)

SovereignPDF is a cross-platform PDF editor for Windows, macOS, and Linux.
Documents are opened, rendered, edited, and exported entirely on your device.
The application makes no external API calls and contains no analytics,
advertising, cloud processing, account system, or paid features.

## Highlights

- **Private by design:** documents never leave the local filesystem.
- **Small native application:** built with Tauri and the operating system's web
  renderer instead of bundling Chromium.
- **Free and open source:** licensed under the GNU AGPL version 3.
- **Cross-platform:** native installers for Windows, macOS, and Linux.
- **Offline-first:** editing and export do not require an internet connection.

## Features

### PDF viewing

- Continuous page scrolling
- High-DPI PDF.js rendering
- Page thumbnail navigation
- Nested PDF bookmark navigation with expandable outline sections
- Zoom slider and zoom controls
- Fit-to-width and fit-to-page modes
- Native and browser-preview file pickers
- Drag-and-drop document opening
- Password prompts with local retry support for encrypted PDFs; passwords stay
  in memory and encrypted files open in protected viewing mode
- Virtualized page mounting for large documents
- Skeleton placeholders and cached page imagery while sharper zoom levels render
- A persistent status bar for page number, dimensions, file size, zoom,
  background work, and saved state

### Page editing

- Drag-and-drop page reordering
- Ctrl/Command-click and Shift-click multi-page selection
- Group page reordering by dragging a selected thumbnail
- Rotate, delete, duplicate, or extract selected pages as one history action
- Staged multi-document merge with ordering, page previews, removal, page
  counts, and estimated output size
- Split or extract selected page ranges
- Undo and redo edit history

### Markup and privacy tools

- Selectable, movable, resizable, and editable text annotations
- Selectable freehand pen and highlighter strokes
- Image and signature overlays
- Selectable and resizable redaction regions
- Flattened annotations during export
- Secure redaction export through local page rasterization

### Document tools

- Save and Save As
- Native system printing with page ranges, portrait or landscape layout, and
  `Ctrl`/`Command`+`P`
- Crash-safe saving through same-folder temporary files and atomic replacement
- Pre-save export review covering annotations, secure redaction, forms,
  metadata, and estimated output size
- Save / Discard / Cancel protection when closing with unsaved changes
- Up to five local crash-recovery revisions per document window, with stale
  detection, restore, and deletion controls in Preferences
- Default-on local session restoration for the previous document, page,
  scroll position, zoom, sidebar, and selected tool
- Interactive form-field flattening
- Metadata sanitization
- PDF structure optimization

## Interface

The application uses a responsive desktop ribbon with separate Page Edit,
History, Rotate, Markup, Document, and View sections. Open a PDF to activate the
editing tools, then select pages from the resizable thumbnail sidebar.
Selecting an annotation opens a resizable properties panel. Dark, light, and
operating-system themes are supported, and workspace dimensions, zoom, and fit
mode are remembered locally. The empty workspace provides drag-and-drop,
Open, and recent-document entry points.

Session restoration is enabled by default because all remembered state remains
on the local computer. It can be disabled from Preferences, which immediately
forgets the stored session.

## Keyboard shortcuts

| Action | Windows and Linux | macOS |
| --- | --- | --- |
| Open | `Ctrl+O` | `Command+O` |
| Save | `Ctrl+S` | `Command+S` |
| Save As | `Ctrl+Shift+S` | `Command+Shift+S` |
| Print | `Ctrl+P` | `Command+P` |
| Find | `Ctrl+F` | `Command+F` |
| Undo | `Ctrl+Z` | `Command+Z` |
| Redo | `Ctrl+Shift+Z` | `Command+Shift+Z` |
| Delete selected annotation or page | `Delete` | `Delete` |
| Move selected annotation | Arrow keys | Arrow keys |
| Move selected annotation farther | `Shift` + arrow keys | `Shift` + arrow keys |
| Fit entire page | `Ctrl+0` | `Command+0` |
| Actual size | `Ctrl+1` | `Command+1` |
| Cancel or clear selection | `Escape` | `Escape` |
| Search shortcuts | `Ctrl+/` | `Command+/` |

The searchable shortcut reference is also available from the application
header.

## Install

Download the installer for your operating system from the
[latest GitHub release](https://github.com/JHoff1/SoverignPDF/releases/latest):

| Platform | Package |
| --- | --- |
| Windows | NSIS setup `.exe` or `.msi` |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

The project is still in early development. Unsigned preview builds may trigger
Windows SmartScreen or macOS Gatekeeper warnings.

## Development

### Prerequisites

- Node.js 20 or later
- Rust stable with the MSVC toolchain on Windows
- The platform prerequisites listed in the
  [Tauri documentation](https://v2.tauri.app/start/prerequisites/)

On Windows, Tauri also requires Microsoft C++ Build Tools with the
**Desktop development with C++** workload. WebView2 is included with current
versions of Windows.

### Run the browser preview

```sh
npm install
npm run dev
```

Open <http://localhost:1420>. Native filesystem dialogs are replaced by browser
file inputs in this preview.

### Run the native desktop application

```sh
npm install
npm run tauri dev
```

### Build native installers

```sh
npm run tauri build
```

Build output is written to:

```text
src-tauri/target/release/bundle/
```

## Release automation

The workflow in `.github/workflows/release.yml` builds native packages on
Windows, macOS, and Linux whenever a version tag is pushed:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The workflow creates a draft GitHub Release containing:

- Windows NSIS and MSI installers
- A macOS DMG
- Linux DEB and AppImage packages
- A `SHA256SUMS.txt` manifest covering every installer

The workflow verifies all expected assets and publishes the release only after
every platform build and checksum step succeeds. Verify a downloaded installer
with `sha256sum -c SHA256SUMS.txt` on Linux, `shasum -a 256` on macOS, or
`Get-FileHash -Algorithm SHA256` on Windows.

## Architecture

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 and Rust |
| Interface | React, TypeScript, Vite, Tailwind CSS |
| Icons | Lucide React |
| PDF rendering | PDF.js |
| PDF modification | pdf-lib |

Editor commands use immutable document snapshots so page operations and
annotations participate in the same undo/redo history. PDF.js renders local
bytes into the viewport, while pdf-lib performs structural changes and export.

## Privacy and security

SovereignPDF is designed to process documents without transmitting them:

- No HTTP client is used by the application.
- No telemetry or crash analytics are included.
- No advertising or user tracking is included.
- No account or cloud synchronization exists.
- The production content security policy restricts external connections.
- The Report Issue action opens the public GitHub issue form in the system
  browser only after an explicit click. It does not upload documents,
  diagnostics, file names, or paths.

Dependency installation and update checks performed by development tools are
separate from the installed application's document-processing behavior.

## OCR policy

OCR is bundled as a completely local component. After text extraction finishes,
pages without usable embedded text are recognized asynchronously in the
background. Search uses the recognized text as it becomes available. The OCR
engine, English language data, and SIMD-compatible WebAssembly assets ship with
the application and never fall back to a network download.

## Current limitations

- Annotations use a deliberately small initial toolset.
- Secure redaction rasterizes pages, which removes searchable text from the
  exported document.
- Interactive form creation and editing are not yet implemented.
- Bookmark creation, renaming, and deletion are not yet implemented; existing
  PDF outlines can be browsed and used for navigation.
- Bundled OCR currently recognizes English text; additional offline language
  packs are not yet included.
- Release builds are not currently code-signed or notarized.

## Contributing

Contributions are welcome. Please open an issue before beginning a large feature
or architectural change. All contributed functionality must preserve the
offline-first privacy model and use license-compatible dependencies.

Users can open the issue form from Preferences or from an application error.
Error details are copied to the clipboard only on request so they can be
reviewed before being included in a public report.

Participation in the project is governed by the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

SovereignPDF is licensed under the
[GNU Affero General Public License version 3](LICENSE). The GitHub repository
contains the full license text.
