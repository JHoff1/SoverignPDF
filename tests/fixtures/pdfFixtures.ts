import { degrees, PDFDocument, StandardFonts } from "pdf-lib";

export async function createFormIntegrityPdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Private title");
  pdf.setAuthor("Private author");
  pdf.setSubject("Private subject");
  pdf.setKeywords(["private", "metadata"]);
  pdf.setProducer("Private producer");
  pdf.setCreator("Private creator");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText("ORIGINAL_PAGE_ONE", { x: 72, y: 700, size: 18, font });
  const field = pdf.getForm().createTextField("local.name");
  field.setText("Visible local value");
  field.addToPage(first, { x: 72, y: 620, width: 220, height: 32, font });
  const second = pdf.addPage([792, 612]);
  second.setRotation(degrees(90));
  second.drawText("ORIGINAL_PAGE_TWO", { x: 72, y: 520, size: 18, font });
  return Buffer.from(await pdf.save());
}

export async function createUnusualPagePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([72, 72]).drawText("TINY_PAGE", { x: 4, y: 36, size: 5 });
  const wide = pdf.addPage([2_000, 200]);
  wide.setRotation(degrees(180));
  wide.drawText("WIDE_PAGE", { x: 72, y: 100, size: 24 });
  pdf.addPage([200, 2_000]).drawText("TALL_PAGE", {
    x: 20,
    y: 1_900,
    size: 18
  });
  return Buffer.from(await pdf.save());
}

export async function createLargeStructuralPdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.addPage([612, 792]).drawText(`Page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 14
    });
  }
  return Buffer.from(await pdf.save());
}

export const malformedPdfFixtures = [
  ["invalid-header.pdf", Buffer.from("not a PDF")],
  ["truncated.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>")]
] as const;
