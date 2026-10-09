// Browser only: getting a dropped file ready for POST /api/rosters/extract.
import { MAX_IMAGE_BYTES, MAX_IMAGES, MAX_TEXT_CHARS, MAX_UPLOAD_BYTES } from "./extractErrors";
import { jerseyZerosNote, parseCsv, rowsToText, type Cell } from "./tableText";
import type { ImportFormat } from "./types";

// =============================================================================
// Four formats, one request shape (see lib/rosters/readUpload.ts):
//   PDF          sent as is
//   images       HEIC converted to JPEG, and anything too big shrunk, here
//   CSV / Excel  read here into plain text rows; the file itself never leaves
//   pasted text  sent as is
// Nothing is kept: the files are read into memory for this one request.
// =============================================================================

// =============================================================================
// TUNING: how images are shrunk to fit MAX_UPLOAD_BYTES between them.
// =============================================================================

/** Longest side of a re-encoded image. Roster text stays readable well below this. */
const MAX_IMAGE_EDGE = 2400;

/** JPEG quality steps tried in turn until an image fits its share of the upload. */
const JPEG_QUALITIES = [0.85, 0.7, 0.55];

/** Kept back from each image's share, so the form's boundaries and headers never tip it over. */
export const IMAGE_HEADROOM_BYTES = 16 * 1024;

// =============================================================================

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|heic|heif)$/i;
const SENDABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Thrown with a sentence the announcer can act on. */
export class ImportProblem extends Error {}

/** Which format a set of dropped files is, or a problem saying why they cannot go together. */
/** A plain text file (.txt, .md), read in the browser and sent as text, the way a paste is. */
export function isPlainText(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "text/plain" || file.type === "text/markdown" || name.endsWith(".txt") || name.endsWith(".md");
}

export function detectFormat(files: File[]): Exclude<ImportFormat, "text"> {
  if (files.length === 0) throw new ImportProblem("Choose a file to import.");
  const kinds = new Set(files.map(kindOf));
  if (kinds.has(null)) {
    throw new ImportProblem("StatCast reads PDF, PNG, JPG, WebP, iPhone photos (HEIC), CSV, Excel (.xlsx) and text (.txt) files. For a Word file, paste its text or save it as a PDF.");
  }
  if (kinds.size > 1) throw new ImportProblem("Import one kind of file at a time.");
  const [kind] = kinds as Set<Exclude<ImportFormat, "text">>;
  if (kind !== "image" && files.length > 1) throw new ImportProblem("Import one file at a time, or up to 5 images.");
  if (kind === "image" && files.length > MAX_IMAGES) throw new ImportProblem(`Import up to ${MAX_IMAGES} images at a time.`);
  return kind;
}

function kindOf(file: File): Exclude<ImportFormat, "text"> | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(name)) return "image";
  if (name.endsWith(".csv") || name.endsWith(".tsv") || file.type === "text/csv") return "csv";
  if (name.endsWith(".xlsx")) return "xlsx";
  return null;
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/**
 * The most one image may weigh when `count` go together: its part of
 * MAX_UPLOAD_BYTES, never more than the server takes for one image
 * (MAX_IMAGE_BYTES), less a little headroom. One 3.5 MB phone photo used to
 * get the whole 4 MB, pass here, and be refused by the server.
 */
export function imageShare(count: number): number {
  const each = Math.floor(MAX_UPLOAD_BYTES / Math.max(1, count));
  return Math.min(MAX_IMAGE_BYTES, each) - IMAGE_HEADROOM_BYTES;
}

/**
 * Images ready to send: HEIC turned into JPEG (Chrome cannot read it), and
 * anything bigger than its share (imageShare) shrunk and re-encoded.
 * A screenshot that already fits goes as it is, pixel for pixel.
 */
export async function prepareImages(files: File[]): Promise<Blob[]> {
  const share = imageShare(files.length);
  const prepared: Blob[] = [];
  for (const file of files) {
    let image: Blob = file;
    if (isHeic(file)) {
      // Loaded only when an iPhone photo is actually dropped: it is large.
      const { heicTo } = await import("heic-to/next");
      image = await heicTo({ blob: file, type: "image/jpeg", quality: JPEG_QUALITIES[0] });
    }
    if (image.size <= share && SENDABLE_IMAGE_TYPES.has(image.type)) {
      prepared.push(image);
      continue;
    }
    prepared.push(await shrink(image, share));
  }
  return prepared;
}

async function shrink(image: Blob, budget: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new ImportProblem("Could not open one of those images. Take a screenshot of the roster and import that.");
  }
  let edge = Math.min(MAX_IMAGE_EDGE, Math.max(bitmap.width, bitmap.height));
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      // White behind a transparent screenshot, or JPEG turns it black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of JPEG_QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= budget) return blob;
      }
      edge = Math.round(edge * 0.75);
    }
  } finally {
    bitmap.close();
  }
  throw new ImportProblem("One of those images is too large to send. Take a screenshot of just the roster.");
}

/** A spreadsheet as text, and anything reading it has to warn about. */
export interface TableRead {
  text: string;
  /** Plain sentences for the announcer, shown beside the import's warnings. Never sent anywhere. */
  notes: string[];
}

/**
 * A CSV or Excel roster as plain text rows. Every sheet with anything on it
 * is included, under its name, because a coach's workbook sometimes keeps
 * varsity and JV on separate tabs and Claude should see which is which.
 */
export async function readTable(file: File, format: "csv" | "xlsx"): Promise<TableRead> {
  let text: string;
  const notes: string[] = [];
  if (format === "csv") {
    text = rowsToText(parseCsv(await file.text()));
  } else {
    let sheets: Array<{ sheet: string; data: Cell[][] }>;
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      sheets = (await readXlsxFile(file)) as unknown as Array<{ sheet: string; data: Cell[][] }>;
    } catch {
      throw new ImportProblem("Could not open that Excel file. Save it as .xlsx or CSV and try again.");
    }
    // Excel keeps a jersey typed as 00 or 07 as the number 0 or 7, and
    // read-excel-file cannot see the "00" format that shows it, so say so.
    const zeros = sheets.map((sheet) => jerseyZerosNote(sheet.data)).find((note) => note !== null);
    if (zeros) notes.push(zeros);
    const parts = sheets
      .map((sheet) => ({ name: sheet.sheet, text: rowsToText(sheet.data) }))
      .filter((sheet) => sheet.text.length > 0);
    text = parts.length === 1 ? parts[0].text : parts.map((sheet) => `=== sheet: ${sheet.name} ===\n${sheet.text}`).join("\n\n");
  }
  if (text.trim().length === 0) throw new ImportProblem("That spreadsheet is empty.");
  if (text.length > MAX_TEXT_CHARS) {
    throw new ImportProblem(`That spreadsheet has more than ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters. Keep just the roster and try again.`);
  }
  return { text, notes };
}

/**
 * Why pasted text cannot be sent, or null when it can. The paste box used to
 * cut anything past MAX_TEXT_CHARS without a word, so the end of a long roster
 * went missing; now the whole paste stays in the box and this says what to do.
 */
export function pastedTextProblem(text: string, noun: string): string | null {
  if (text.trim().length === 0) return `Paste the ${noun} first.`;
  if (text.length > MAX_TEXT_CHARS) {
    const count = (n: number) => n.toLocaleString("en-US");
    return `That paste is ${count(text.length)} characters, and StatCast reads up to ${count(MAX_TEXT_CHARS)}. Paste just the ${noun} table.`;
  }
  return null;
}
