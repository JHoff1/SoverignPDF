# Quality assurance

VerityPDF's pre-release workflow combines browser, native, packaging,
accessibility, performance, and supply-chain checks. These tests do not add
telemetry or network access to the desktop application.

## Platform coverage

- Windows x64: Rust checks plus clean MSI and NSIS install, PDF association,
  document launch, previous-release upgrade, and uninstall tests.
- Windows ARM64: build and install the Store MSIX on a native
  `windows-11-arm` runner, confirm the executable is ARM64, then open a test PDF.
- macOS Intel and Apple Silicon: verify and launch the universal DMG on native
  runners.
- Linux Ubuntu 22.04 and 24.04: install the DEB, validate desktop/MIME metadata
  and linked libraries, and launch both DEB and AppImage builds under Xvfb.

Failed native smoke tests retain local logs or screenshots as short-lived CI
artifacts.

## Accessibility checks

Run `npm run test:accessibility`. The suite checks accessible names for visible
controls, keyboard focus and Escape behavior, focus order, reduced-motion
styles, a 200% interface layout, and WCAG AA contrast for primary controls in
light mode. The regular editor regression suite also covers application
shortcuts and selection behavior.

## Performance budgets

Run `npm run test:performance`. The test records its measurements as Playwright
attachments and fails only when a broad regression budget is exceeded:

| Measurement | Default budget | Override |
| --- | ---: | --- |
| App shell startup | 8 seconds | `PERF_STARTUP_MS` |
| Initial page render | 8 seconds | `PERF_INITIAL_RENDER_MS` |
| Zoom rerender | 5 seconds | `PERF_ZOOM_RENDER_MS` |
| Load and scroll to page 120 | 15 seconds | `PERF_LARGE_SCROLL_MS` |
| Simultaneously mounted pages | 20 | `PERF_MAX_MOUNTED_PAGES` |
| Browser JavaScript heap | 350 MB | `PERF_MAX_HEAP_MB` |
| One-page offline OCR | 60 seconds | `PERF_OCR_MS` |

The generous limits are deliberate: normal runner variation should not block a
release, while material regressions in startup, rendering, virtualization,
memory use, or OCR should.

## Dependency and release integrity

- `npm audit --audit-level=high` blocks high and critical npm vulnerabilities.
- `cargo audit --file src-tauri/Cargo.lock` blocks Rust security
  vulnerabilities. It may report upstream unmaintained-library warnings from
  Tauri's Linux GTK/WebKit stack separately.
- `cargo deny --manifest-path src-tauri/Cargo.toml check licenses bans sources`
  enforces allowed licenses, rejects wildcard dependencies, and restricts crate
  registries.
- Each release includes SHA-256 checksums and an SPDX JSON SBOM.
- GitHub generates provenance and SBOM attestations for each stable installer.

The browser suite also reopens exported PDFs to verify form flattening,
metadata cleanup, searchable text annotations, secure redaction, page geometry,
mixed page rotations, malformed-file recovery, and 500-page virtualization.

## Local regression commands

Run the complete local gate with:

```powershell
npm run release:verify
```

This requires `cargo-audit` and `cargo-deny` to be installed. Dependabot checks
npm, Cargo, and GitHub Actions monthly and groups compatible minor/patch updates
to limit PR and notification noise.

The equivalent individual commands are:

```powershell
npm run build
npm run test:unit
npm run test:e2e
npm audit --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
cargo deny --manifest-path src-tauri/Cargo.toml check licenses bans sources
```

Installer installation and removal should normally run only on disposable CI
runners because those checks intentionally modify Windows application and file
association state.
