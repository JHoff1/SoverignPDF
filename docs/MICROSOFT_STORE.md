# Microsoft Store release

SovereignPDF uses a separate MSIX package for Microsoft Store distribution.
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

## Build the MSIX

Requirements:

- Windows 10 or 11
- Rust and the normal Tauri build prerequisites
- Windows 10 or 11 SDK, including `MakeAppx.exe`

From the repository root:

```powershell
npm run store:msix
```

The command performs a release build without creating the regular installers,
generates the Store assets, packages the executable and PDF file association,
verifies that the resulting package can be unpacked, and writes a SHA-256
checksum.

Output is written under:

```text
src-tauri/target/store/
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
