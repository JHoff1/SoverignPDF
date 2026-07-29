import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

const outputPath = resolve(
  process.argv[2] ?? "src-tauri/target/store/VerityPDF-Store-Demo.pdf"
);
const pdf = await PDFDocument.create();
const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

const colors = {
  navy: rgb(0.055, 0.09, 0.18),
  blue: rgb(0.12, 0.31, 0.7),
  coral: rgb(0.91, 0.32, 0.23),
  ink: rgb(0.12, 0.15, 0.2),
  muted: rgb(0.42, 0.46, 0.53),
  line: rgb(0.86, 0.88, 0.91),
  pale: rgb(0.95, 0.97, 1)
};

function addHeader(page, section) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: height - 72,
    width,
    height: 72,
    color: colors.navy
  });
  page.drawText("VERITYPDF", {
    x: 42,
    y: height - 43,
    size: 17,
    font: bold,
    color: rgb(0.86, 0.91, 1)
  });
  page.drawText(section.toUpperCase(), {
    x: width - 170,
    y: height - 40,
    size: 9,
    font: bold,
    color: rgb(0.52, 0.67, 1)
  });
}

function addFooter(page, pageNumber) {
  const { width } = page.getSize();
  page.drawLine({
    start: { x: 42, y: 36 },
    end: { x: width - 42, y: 36 },
    thickness: 1,
    color: colors.line
  });
  page.drawText("Demonstration document · processed locally", {
    x: 42,
    y: 20,
    size: 8,
    font: regular,
    color: colors.muted
  });
  page.drawText(String(pageNumber), {
    x: width - 48,
    y: 20,
    size: 8,
    font: bold,
    color: colors.muted
  });
}

function addWrappedText(page, text, x, y, maxWidth, size, lineHeight) {
  const words = text.split(/\s+/);
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (regular.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      page.drawText(line, {
        x,
        y: cursorY,
        size,
        font: regular,
        color: colors.ink
      });
      line = word;
      cursorY -= lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) {
    page.drawText(line, {
      x,
      y: cursorY,
      size,
      font: regular,
      color: colors.ink
    });
  }
  return cursorY;
}

{
  const page = pdf.addPage([612, 792]);
  addHeader(page, "Project brief");
  page.drawText("Private document workflows,", {
    x: 42,
    y: 666,
    size: 29,
    font: bold,
    color: colors.ink
  });
  page.drawText("without the subscription.", {
    x: 42,
    y: 630,
    size: 29,
    font: bold,
    color: colors.blue
  });
  addWrappedText(
    page,
    "VerityPDF keeps viewing, editing, search, OCR, annotations, and export on your computer. Your documents remain private and under your control.",
    42,
    584,
    520,
    12,
    18
  );

  const cards = [
    ["100%", "Local processing"],
    ["0", "Cloud uploads"],
    ["5", "Recovery revisions"]
  ];
  cards.forEach(([value, label], index) => {
    const x = 42 + index * 176;
    page.drawRectangle({
      x,
      y: 456,
      width: 160,
      height: 88,
      color: colors.pale,
      borderColor: colors.line,
      borderWidth: 1
    });
    page.drawText(value, {
      x: x + 16,
      y: 500,
      size: 24,
      font: bold,
      color: index === 1 ? colors.coral : colors.blue
    });
    page.drawText(label, {
      x: x + 16,
      y: 476,
      size: 10,
      font: regular,
      color: colors.muted
    });
  });

  page.drawText("Workflow overview", {
    x: 42,
    y: 408,
    size: 16,
    font: bold,
    color: colors.ink
  });
  const rows = [
    ["Open", "Choose a local PDF or drag it into the workspace"],
    ["Edit", "Organize pages and add selectable annotations"],
    ["Review", "Search embedded text or use bundled offline OCR"],
    ["Export", "Review privacy choices before saving"]
  ];
  rows.forEach(([step, detail], index) => {
    const y = 362 - index * 56;
    page.drawCircle({
      x: 55,
      y: y + 5,
      size: 13,
      color: index === 3 ? colors.coral : colors.blue
    });
    page.drawText(String(index + 1), {
      x: 51.5,
      y: y + 1,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1)
    });
    page.drawText(step, {
      x: 82,
      y,
      size: 12,
      font: bold,
      color: colors.ink
    });
    page.drawText(detail, {
      x: 160,
      y,
      size: 10,
      font: regular,
      color: colors.muted
    });
  });
  addFooter(page, 1);
}

{
  const page = pdf.addPage([612, 792]);
  addHeader(page, "Editing toolkit");
  page.drawText("Everything needed for everyday PDF work", {
    x: 42,
    y: 666,
    size: 24,
    font: bold,
    color: colors.ink
  });
  addWrappedText(
    page,
    "Move quickly from page organization to markup while keeping a clear undo history and an export summary before anything is written.",
    42,
    628,
    520,
    11,
    17
  );

  const features = [
    ["PAGE EDIT", "Merge, split, rotate, duplicate, extract, and reorder pages."],
    ["MARKUP", "Add text, pen, highlighter, images, and secure redactions."],
    ["DOCUMENT", "Flatten forms, optimize output, and clear basic metadata."],
    ["VIEW", "Search, zoom, fit pages, and navigate with thumbnails or bookmarks."]
  ];
  features.forEach(([title, body], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 42 + column * 264;
    const y = 474 - row * 174;
    page.drawRectangle({
      x,
      y,
      width: 244,
      height: 142,
      color: index === 1 ? rgb(1, 0.965, 0.94) : colors.pale,
      borderColor: index === 1 ? rgb(0.96, 0.7, 0.61) : colors.line,
      borderWidth: 1
    });
    page.drawText(title, {
      x: x + 18,
      y: y + 104,
      size: 10,
      font: bold,
      color: index === 1 ? colors.coral : colors.blue
    });
    addWrappedText(page, body, x + 18, y + 76, 208, 11, 17);
  });

  page.drawRectangle({
    x: 42,
    y: 142,
    width: 508,
    height: 74,
    color: colors.navy
  });
  page.drawText("Search and OCR stay on this device", {
    x: 62,
    y: 184,
    size: 15,
    font: bold,
    color: rgb(0.9, 0.94, 1)
  });
  page.drawText("No CDN fallback · No document upload · No telemetry", {
    x: 62,
    y: 160,
    size: 10,
    font: regular,
    color: rgb(0.58, 0.7, 0.93)
  });
  addFooter(page, 2);
}

{
  const page = pdf.addPage([612, 792]);
  addHeader(page, "Privacy review");
  page.drawText("Export with confidence", {
    x: 42,
    y: 666,
    size: 28,
    font: bold,
    color: colors.ink
  });
  addWrappedText(
    page,
    "Before saving, VerityPDF summarizes what will happen to annotations, redactions, forms, metadata, and the estimated output size.",
    42,
    622,
    520,
    12,
    18
  );

  const checks = [
    "Annotations can be flattened into permanent page content.",
    "Secure redactions rasterize affected pages and remove searchable text.",
    "Interactive forms can remain editable or be flattened.",
    "Basic metadata fields can be cleared before export.",
    "Crash recovery and recent file paths remain local and controllable."
  ];
  checks.forEach((text, index) => {
    const y = 530 - index * 68;
    page.drawCircle({
      x: 57,
      y: y + 4,
      size: 10,
      color: colors.blue
    });
    page.drawText("OK", {
      x: 51,
      y: y + 1,
      size: 6,
      font: bold,
      color: rgb(1, 1, 1)
    });
    addWrappedText(page, text, 82, y, 450, 11, 17);
  });

  page.drawRectangle({
    x: 42,
    y: 118,
    width: 508,
    height: 80,
    color: rgb(0.94, 0.99, 0.97),
    borderColor: rgb(0.58, 0.83, 0.72),
    borderWidth: 1
  });
  page.drawText("Privacy first", {
    x: 62,
    y: 166,
    size: 14,
    font: bold,
    color: rgb(0.08, 0.42, 0.28)
  });
  page.drawText("Your PDF remains on your computer unless you choose to save or share it.", {
    x: 62,
    y: 140,
    size: 10,
    font: regular,
    color: colors.ink
  });
  addFooter(page, 3);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, await pdf.save());
console.log(outputPath);
