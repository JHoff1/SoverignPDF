# Microsoft Store release

VerityPDF uses a separate MSIX package for Microsoft Store distribution.
The existing NSIS and MSI installers remain available through GitHub Releases.

## Partner Center identity

The values below are assigned by Partner Center and must be reproduced exactly
in the package manifest:

- Package identity name: `jhoff1.SovereignPDF`
- Package identity publisher:
  `CN=1561B86F-CE73-4D7B-8F44-C60003C93D75`
- Package publisher display name: `Jacob Hoffman`
- Store ID: `9NXLS9RZV06S`

Partner Center validates `PublisherDisplayName` against the verified publisher
name associated with the developer account, even if the Product identity page
still displays an older friendly name. The technical package name and
certificate publisher must continue to match the Product identity page exactly.

The package identity and Store application ID intentionally retain their
original SovereignPDF values after the VerityPDF rebrand. They are immutable
compatibility identifiers for the existing Partner Center product; customers
see **VerityPDF** through the package display-name fields.

## Build the MSIX

Requirements:

- Windows 10 or 11
- Rust and the normal Tauri build prerequisites
- Windows 10 or 11 SDK, including `MakeAppx.exe`

From the repository root:

```powershell
npm run store:msix
```

To create the native Windows-on-ARM package:

```powershell
rustup target add aarch64-pc-windows-msvc
npm run store:msix:arm64
```

The ARM64 build also requires the Visual Studio C++ ARM64 build tools. GitHub
Actions installs the Rust target and builds both architectures automatically.

To build both packages on GitHub without creating a release, open **Actions →
Validate Microsoft Store packages → Run workflow**. The workflow retains the
x64 and ARM64 packages and their checksums as downloadable artifacts for 30
days.

The command performs a release build without creating the regular installers,
generates the Store assets, packages the executable and PDF file association,
verifies that the resulting package can be unpacked, and writes a SHA-256
checksum.

Output is written under:

```text
src-tauri/target/store/x64/
src-tauri/target/store/arm64/
```

The `.msix` file is the package to upload to Partner Center. It is intentionally
not signed with a local certificate; Microsoft signs the certified Store
package. Direct distribution outside the Store requires a separate trusted
code-signing certificate.

## Versioning

Partner Center requires each uploaded package to have a higher four-part
version than every package previously submitted for the same identity. The
script converts the Tauri version automatically:

```text
0.1.11 -> 0.1.11.0
```

Increment the project version before every Store update.

## Store listing assets

Customer-facing artwork is stored in `src-tauri/store/listing-assets/`.
Validate its dimensions, transparency, and file size before uploading:

```powershell
npm run store:assets:validate
```

The Store screenshots use a generated demonstration document containing no
real customer or developer information. Regenerate it with:

```powershell
npm run store:demo-pdf
```

The exact Partner Center field mapping and ready-to-paste listing copy are in
[`STORE_LISTING.md`](STORE_LISTING.md).

## Certification checks

The Windows App Certification Kit must run as administrator within an active
Windows user session. After building the x64 package, open PowerShell with
**Run as administrator**, change to the repository directory, and run:

```powershell
npm run store:wack
```

The certification report is written under
`src-tauri/target/store/certification/`.

Before submission:

1. Install the package on a clean Windows user profile.
2. Run the Windows App Certification Kit against the installed package.
3. Open a PDF through its file association.
4. Verify Open, Save, Save As, Print, OCR, and offline operation.
5. Confirm that uninstalling removes the app while leaving user-created PDFs
   and backups untouched.
6. Upload both architecture packages to the same Partner Center submission so
   the Store can select the correct package for each device.
