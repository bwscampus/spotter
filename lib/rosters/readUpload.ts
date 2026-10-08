// Server only: parses the body of POST /api/rosters/extract.
import { ExtractionError, type ImageMediaType } from "./extractRoster";
import { MAX_IMAGE_BYTES, MAX_IMAGES, MAX_PDF_BYTES, MAX_TEXT_CHARS } from "./extractErrors";
import { isImportFormat, type ImportFormat } from "./types";

// =============================================================================
// Turning a multipart request into one checked roster upload, or the code of
// the guard that refused it. The browser sends:
//   format   pdf | image | text | csv | xlsx
//   file     the PDF (pdf), or one to MAX_IMAGES images (image)
//   text     pasted text, or spreadsheet rows already turned into text (text, csv, xlsx)
//
// Types are checked by the bytes, not by what the browser claims, so a file
// renamed to .pdf is still caught. Nothing here is logged or kept.
// =============================================================================

export type RosterUpload =
  | { format: "pdf"; bytes: Uint8Array }
  | { format: "image"; images: Array<{ mediaType: ImageMediaType; bytes: Uint8Array }> }
  | { format: "text" | "csv" | "xlsx"; text: string };

export async function readUpload(form: FormData): Promise<RosterUpload> {
  const format = form.get("format");
  if (!isImportFormat(format)) throw new ExtractionError("bad_format");

  if (format === "pdf") {
    const files = fileEntries(form);
    if (files.length !== 1) throw new ExtractionError("no_file");
    const [file] = files;
    if (file.size > MAX_PDF_BYTES) throw new ExtractionError("too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!startsWith(bytes, "%PDF")) throw new ExtractionError("not_pdf");
    return { format, bytes };
  }

  if (format === "image") {
    const files = fileEntries(form);
    if (files.length === 0) throw new ExtractionError("no_file");
    if (files.length > MAX_IMAGES) throw new ExtractionError("too_many_images");
    const images = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) throw new ExtractionError("image_too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mediaType = imageType(bytes);
      if (!mediaType) throw new ExtractionError("not_image");
      images.push({ mediaType, bytes });
    }
    return { format, images };
  }

  const text = form.get("text");
  if (typeof text !== "string" || text.trim().length === 0) throw new ExtractionError("no_text");
  if (text.length > MAX_TEXT_CHARS) throw new ExtractionError("too_much_text");
  return { format: format as Exclude<ImportFormat, "pdf" | "image">, text };
}

function fileEntries(form: FormData): File[] {
  return form.getAll("file").filter((entry): entry is File => typeof entry !== "string");
}

/** JPEG, PNG and WebP by their first bytes. HEIC never gets here: the browser converts it. */
export function imageType(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && startsWith(bytes.subarray(1), "PNG")) return "image/png";
  if (startsWith(bytes, "RIFF") && startsWith(bytes.subarray(8), "WEBP")) return "image/webp";
  return null;
}

function startsWith(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}
