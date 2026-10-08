import { getDocumentProxy } from "unpdf";
import type { PDFDocumentProxy } from "unpdf/pdfjs";
import { contrastOnWhite, type Rgb } from "@/lib/game/colors";

// =============================================================================
// Reading a team's colours off the logo printed on its roster.
//
// A MaxPreps roster puts the school crest in the header, which is a better
// source than anything a model can recall: it is the colours the school
// actually publishes, on the page in front of us.
//
// A crest is mostly background. Brentwood's is 82% white with the navy at a few
// percent, so the counting below throws away what the page is printed on and
// takes the most of what is left, merging shades of the same colour as it goes.
// =============================================================================

// -----------------------------------------------------------------------------
// TUNING
// -----------------------------------------------------------------------------

/** Above this contrast against white, a pixel is the paper rather than the crest. */
const MIN_PIXEL_CONTRAST = 1.6;

/** A colour under this share of the crest is an edge artefact, not one of its colours. */
const MIN_SHARE = 0.02;

/** Every Nth pixel. A crest is small and flat, so sampling misses nothing that matters. */
const SAMPLE_STRIDE = 3;

/** Shades are merged into buckets this wide per channel before being counted. */
const BUCKET_BITS = 4;

/**
 * Images bigger than this many pixels are skipped, and PDF.js is told not to
 * decode them at all. A crest is a few hundred pixels across; a 4 megapixel
 * image is a photo or a page scan, and decoding a huge one is how a hostile
 * PDF holds the route for its whole time budget (docs/PRE_LAUNCH_AUDIT.md H3).
 */
export const MAX_LOGO_PIXELS = 4_000_000;

/** The whole colour read gives up after this long and the roster goes on with no colour. */
export const COLOR_TIMEOUT_MS = 3_000;

// -----------------------------------------------------------------------------

/** pdf.js image kinds. Greyscale has no colour to read. */
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * The colour a crest is mostly made of, background excluded.
 *
 * Exported for its own sake: this is the part worth testing, and it needs no
 * PDF to run.
 */
export function pickLogoColor(pixels: Rgb[]): string | null {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  let kept = 0;

  for (const pixel of pixels) {
    if (contrastOnWhite(toHex(pixel)) < MIN_PIXEL_CONTRAST) continue;
    kept++;
    const key = `${pixel.r >> BUCKET_BITS},${pixel.g >> BUCKET_BITS},${pixel.b >> BUCKET_BITS}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += pixel.r;
      bucket.g += pixel.g;
      bucket.b += pixel.b;
    } else {
      buckets.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b });
    }
  }

  if (kept === 0) return null;

  // The bucket's average rather than its corner, so the colour is the one that
  // was actually there rather than the one quantizing rounded it to.
  const ranked = [...buckets.values()]
    .filter((bucket) => bucket.count / kept >= MIN_SHARE)
    .sort((a, b) => b.count - a.count)
    .map((bucket) => toHex({ r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count }));

  return ranked[0] ?? null;
}

/** Every pixel of one pdf.js image object, as colours. */
function toPixels(image: { width: number; height: number; kind: number; data: Uint8ClampedArray }): Rgb[] {
  const { kind, data } = image;
  const step = kind === RGBA_32BPP ? 4 : kind === RGB_24BPP ? 3 : 0;
  if (step === 0) return [];

  const pixels: Rgb[] = [];
  for (let i = 0; i + step - 1 < data.length; i += step * SAMPLE_STRIDE) {
    if (step === 4 && data[i + 3] < 128) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

/**
 * The colours of the crest on a roster's first page, or nulls when the page has
 * no usable image.
 *
 * Never throws: a roster with no logo, an unusual colour space or a PDF that
 * will not give up its images is a missing suggestion, not a failed import.
 */
export async function logoColor(pdf: PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await pdf.getPage(1);
    const ops = await page.getOperatorList();

    const names: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const args = ops.argsArray[i];
      const arg = args?.[0];
      if (typeof arg !== "string" || !arg.startsWith("img_")) continue;
      // paintImageXObject carries [name, width, height]: skip a big one before asking for its pixels.
      const [, width, height] = args;
      if (typeof width === "number" && typeof height === "number" && width * height > MAX_LOGO_PIXELS) continue;
      names.push(arg);
    }

    let best: string | null = null;
    let bestPixels = 0;

    for (const name of names) {
      const image = await new Promise<{ width: number; height: number; kind: number; data: Uint8ClampedArray } | null>(
        (resolve) => {
          try {
            if (page.objs.has(name)) return resolve(page.objs.get(name));
            page.objs.get(name, resolve);
          } catch {
            resolve(null);
          }
        },
      );
      if (!image?.data || !image.width) continue;
      if (image.width * image.height > MAX_LOGO_PIXELS) continue;

      const pixels = toPixels(image);
      // The largest image on the page is the crest; anything else is a rule or an icon.
      if (pixels.length <= bestPixels) continue;
      const color = pickLogoColor(pixels);
      if (color) {
        best = color;
        bestPixels = pixels.length;
      }
    }

    return best;
  } catch {
    return null;
  }
}

/**
 * The crest colour of a roster PDF, from its bytes, within COLOR_TIMEOUT_MS.
 *
 * Opens its own copy of the document with PDF.js's maxImageSize set, so an
 * oversized image is never decoded, and races the whole read against the
 * timeout: a slow or hostile file costs at most a few seconds and no colour.
 * Copies the bytes first, as openPdf in lib/pdf.ts does, because PDF.js
 * detaches the array it is given and the caller still needs it. Never throws.
 */
export async function readLogoColor(bytes: Uint8Array, timeoutMs: number = COLOR_TIMEOUT_MS): Promise<string | null> {
  const doc: { pdf?: PDFDocumentProxy; done?: boolean } = {};
  const close = () => {
    if (doc.done) return;
    doc.done = true;
    void doc.pdf?.loadingTask.destroy().catch(() => undefined);
  };

  const work = (async () => {
    doc.pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: MAX_LOGO_PIXELS });
    if (doc.done) return null;
    return logoColor(doc.pdf);
  })()
    .catch(() => null)
    .finally(close);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    close();
  }
}
