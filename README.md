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
- Zoom slider and zoom controls
- Fit-to-width and fit-to-page modes
- Native and browser-preview file pickers
- Drag-and-drop document opening

### Page editing

- Drag-and-drop page reordering
- Rotate individual pages left or right
- Delete and duplicate pages
- Merge multiple PDF documents
- Split or extract selected page ranges
- Undo and redo edit history

### Markup and privacy tools

- Text annotations
- Freehand pen
- Highlighter
- Image and signature overlays
- Redaction regions
- Flattened annotations during export
- Secure redaction export through local page rasterization

### Document tools

- Save and Save As
- Interactive form-field flattening
- Metadata sanitization
- PDF structure optimization

## Interface

The application uses a compact desktop ribbon with separate Edit, History,
Rotate, Markup, Document, and View sections. Open a PDF to activate the editing
tools, then select pages from the thumbnail sidebar.

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

Review and publish the draft release from the repository's **Releases** page.

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

Dependency installation and update checks performed by development tools are
separate from the installed application's document-processing behavior.

## OCR policy

OCR is planned as an optional local component. It is not currently bundled
because language models would substantially increase the base installer size,
while downloading models at runtime would conflict with the strict offline
guarantee. A future OCR module will use explicitly installed local language
packs with no network fallback.

## Current limitations

- Annotations use a deliberately small initial toolset.
- Secure redaction rasterizes pages, which removes searchable text from the
  exported document.
- Interactive form creation and editing are not yet implemented.
- OCR is not yet available.
- Release builds are not currently code-signed or notarized.

## Contributing

Contributions are welcome. Please open an issue before beginning a large feature
or architectural change. All contributed functionality must preserve the
offline-first privacy model and use license-compatible dependencies.

## License

SovereignPDF is licensed under the
[GNU Affero General Public License version 3](LICENSE). The GitHub repository
contains the full license text.
