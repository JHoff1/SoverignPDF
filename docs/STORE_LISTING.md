# Microsoft Store listing

This file contains ready-to-paste English (United States) listing content and
maps each repository asset to its Partner Center field.

## Identity and classification

- **Product name:** VerityPDF
- **Category:** Productivity
- **Publisher display name:** Jacob Hoffman
- **Developed by:** Jacob Hoffman
- **Age rating:** Suitable for all ages
- **Pricing:** Free
- **Support URL:** https://github.com/JHoff1/VerityPDF/issues
- **Privacy policy URL:**
  https://github.com/JHoff1/VerityPDF/blob/main/PRIVACY.md

The application accesses documents selected by the user, which may contain
personal information, but processes them locally. Select the Partner Center
personal-information answer that indicates the app accesses personal
information, then provide the privacy-policy URL above. VerityPDF does not
collect or transmit that information.

## Short description

A private, offline PDF editor for viewing, organizing, annotating, OCR, and
secure redaction.

## Description

VerityPDF is a free, open-source PDF editor designed for private,
subscription-free document work.

Open, read, organize, annotate, search, print, and export PDFs without uploading
your files. Documents are processed entirely on your device. VerityPDF has
no accounts, cloud synchronization, advertising, analytics, telemetry, or
payment paywalls.

Use the thumbnail sidebar to navigate and organize pages. Reorder, rotate,
duplicate, extract, split, delete, or merge pages and documents. Add editable
text, pen, highlighter, image, and redaction annotations. Search embedded text
or allow the bundled offline OCR engine to recognize scanned pages in the
background.

Before export, VerityPDF clearly summarizes annotation flattening, secure
redaction, forms, and metadata choices. Crash-recovery snapshots and optional
session restoration remain on your computer and can be reviewed or deleted in
Preferences.

VerityPDF is licensed under AGPL-3.0. Its source code and issue tracker are
publicly available on GitHub.

## Product features

- View PDFs with smooth zoom, fit-to-page, fit-to-width, thumbnails, and
  bookmarks.
- Reorder, rotate, duplicate, extract, split, delete, and merge pages.
- Add and edit text, pen, highlighter, image, and redaction annotations.
- Search embedded text and scanned pages with completely offline OCR.
- Apply secure rasterized redaction to remove underlying page content.
- Flatten annotations and forms, optimize files, and clear basic metadata.
- Print selected pages using the native Windows print dialog.
- Recover interrupted work from local snapshots.
- Work without accounts, subscriptions, telemetry, or cloud uploads.

## Search terms

PDF editor, PDF reader, annotate PDF, merge PDF, split PDF, offline OCR,
redact PDF

## What's new in version 0.1.11

- Added local crash recovery and safer document-session handling.
- Improved large-document rendering, page caching, and loading feedback.
- Added native printing, page ranges, and release checksums.
- Expanded annotation editing, page selection, bookmarks, and merge workflows.
- Added Microsoft Store packaging and privacy documentation.

## Store logo mapping

| Partner Center field | Repository file |
| --- | --- |
| 9:16 poster art, 720 x 1080 | `VerityPDF-Poster-720x1080.png` |
| 9:16 poster art, 1440 x 2160 | `VerityPDF-Poster-1440x2160.png` |
| 1:1 box art, 1080 x 1080 | `VerityPDF-BoxArt-1080x1080.png` |
| 1:1 box art, 2160 x 2160 | `VerityPDF-BoxArt-2160x2160.png` |
| 1:1 app tile icon, 300 x 300 | `VerityPDF-AppTile-300x300.png` |
| 1:1 Store logo, 150 x 150 | `VerityPDF-StoreLogo-150x150.png` |
| 1:1 Store logo, 71 x 71 | `VerityPDF-StoreLogo-71x71.png` |

All files are under `src-tauri/store/listing-assets/`. Partner Center labels
the poster slots as 9:16 even though the displayed accepted dimensions are 2:3;
the supplied files follow the exact pixel dimensions.

## Screenshot plan

Microsoft requires at least one screenshot and recommends at least four for
each supported device type. Upload the desktop screenshots from
`src-tauri/store/listing-assets/screenshots/` in this order:

1. Document workspace and page navigation
2. Annotation and editing tools
3. Search with local OCR
4. About, privacy, and local-data controls

| Order | Screenshot file |
| --- | --- |
| 1 | `01-document-workspace.png` |
| 2 | `02-annotation-tools.png` |
| 3 | `03-search-and-offline-ocr.png` |
| 4 | `04-about-and-privacy.png` |

Use screenshots that contain only demonstration content. Do not upload real
documents, names, addresses, account details, or other personal information.

## Submission notes

- Upload the x64 and ARM64 MSIX files to the same submission.
- The `runFullTrust` capability is required because VerityPDF is a Tauri
  desktop application. Explain that it performs user-initiated local file
  access and document processing.
- Microsoft signs the certified Store package. The locally generated Store
  MSIX intentionally has no public distribution signature.
- Increment the four-part package version for every subsequent submission.
