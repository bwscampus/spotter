import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { openPdf } from "@/lib/pdf";

// =============================================================================
// PDF.js detaches whatever array it is opened with. Both upload routes need the
// file again afterwards to send to Claude, and a detached buffer is silent: it
// reports length 0 and encodes to an empty string, so the failure surfaces from
// Anthropic as "PDF cannot be empty" rather than from the line that caused it.
// =============================================================================

/** The smallest genuinely valid PDF: catalog, pages, one page, and an xref. */
function minimalPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("openPdf", () => {
  it("opens the document", async () => {
    const pdf = await openPdf(minimalPdf());
    expect(pdf.numPages).toBe(1);
  });

  it("leaves the caller's bytes intact, so the file can still be sent to Claude", async () => {
    const bytes = minimalPdf();
    const before = bytes.length;

    await openPdf(bytes);

    expect(bytes.length).toBe(before);
    // ArrayBuffer.detached is newer than the TypeScript lib this project targets.
    expect((bytes.buffer as ArrayBuffer & { detached?: boolean }).detached ?? false).toBe(false);
    expect(Buffer.from(bytes).toString("base64").length).toBeGreaterThan(0);
  });

  it("still works when the same bytes are opened twice", async () => {
    // The roster route opens a PDF and may then fall back to sending it whole.
    const bytes = minimalPdf();
    await openPdf(bytes);
    const again = await openPdf(bytes);
    expect(again.numPages).toBe(1);
  });

  it("does not hand the caller's own array to the parser", async () => {
    // The guard this module exists for: unpdf's own entry point detaches, and
    // if it ever stops doing so this test is the thing that says the copy is
    // no longer needed.
    const { getDocumentProxy } = await import("unpdf");
    const bytes = minimalPdf();
    await getDocumentProxy(bytes);
    expect(bytes.length).toBe(0);
  });

  it("keeps the text layer readable after opening", async () => {
    const bytes = minimalPdf();
    const pdf = await openPdf(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    expect(Array.isArray(text)).toBe(true);
  });
});
