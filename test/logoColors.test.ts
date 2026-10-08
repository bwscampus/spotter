import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { COLOR_TIMEOUT_MS, MAX_LOGO_PIXELS, pickLogoColor, readLogoColor } from "@/lib/rosters/logoColors";
import type { Rgb } from "@/lib/game/colors";

// A crest is mostly the paper it is printed on: the real Brentwood one is 82%
// white with its navy at a few percent. These build the same shape.

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NAVY: Rgb = { r: 5, g: 43, b: 120 };
const NAVY_SHADE: Rgb = { r: 26, g: 55, b: 87 };
const CRIMSON: Rgb = { r: 152, g: 6, b: 51 };

function crest(parts: Array<[Rgb, number]>): Rgb[] {
  return parts.flatMap(([color, count]) => Array.from({ length: count }, () => color));
}

describe("pickLogoColor", () => {
  it("finds nothing in a blank crest", () => {
    expect(pickLogoColor(crest([[WHITE, 500]]))).toBeNull();
    expect(pickLogoColor([])).toBeNull();
  });

  it("ignores the paper and returns the ink", () => {
    expect(pickLogoColor(crest([[WHITE, 820], [NAVY, 180]]))).toBe("#052b78");
  });

  it("takes the colour the crest is mostly made of", () => {
    expect(pickLogoColor(crest([[WHITE, 600], [NAVY, 300], [CRIMSON, 100]]))).toBe("#052b78");
    expect(pickLogoColor(crest([[WHITE, 600], [CRIMSON, 300], [NAVY, 100]]))).toBe("#980633");
  });

  it("is not thrown off by shading of its own colour", () => {
    expect(pickLogoColor(crest([[WHITE, 600], [NAVY, 300], [NAVY_SHADE, 100]]))).toBe("#052b78");
  });

  it("ignores a colour too rare to be one of the crest's", () => {
    // Anti-aliasing leaves a trace of everything along every edge.
    expect(pickLogoColor(crest([[WHITE, 600], [NAVY, 400], [CRIMSON, 3]]))).toBe("#052b78");
  });

  it("averages a bucket rather than reporting the corner it rounded to", () => {
    expect(
      pickLogoColor(crest([[WHITE, 600], [{ r: 4, g: 42, b: 118 }, 200], [{ r: 6, g: 44, b: 122 }, 200]])),
    ).toBe("#052b78");
  });
});

// The crest read on a whole PDF (H3): images over MAX_LOGO_PIXELS are never
// decoded, and the read gives up after COLOR_TIMEOUT_MS with no colour.
describe("readLogoColor", () => {
  /** A one-page PDF whose page paints one RGB image of `width` x `height`, every pixel `rgb`, Flate-compressed. */
  function pdfWithImage(width: number, height: number, rgb: [number, number, number]): Uint8Array {
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i += 3) raw.set(rgb, i);
    const data = deflateSync(raw);
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
    const parts: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (part: string | Buffer) => {
      const buffer = typeof part === "string" ? Buffer.from(part, "latin1") : part;
      parts.push(buffer);
      length += buffer.length;
    };
    push("%PDF-1.4\n");
    const objects: Array<Array<string | Buffer>> = [
      ["<< /Type /Catalog /Pages 2 0 R >>"],
      ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
      [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
      ],
      [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
      [
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
        data,
        "\nendstream",
      ],
    ];
    objects.forEach((object, index) => {
      offsets.push(length);
      push(`${index + 1} 0 obj\n`);
      object.forEach(push);
      push("\nendobj\n");
    });
    const startxref = length;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
    return new Uint8Array(Buffer.concat(parts));
  }

  it("reads the colour of a crest-sized image", async () => {
    expect(await readLogoColor(pdfWithImage(40, 40, [5, 43, 120]))).toBe("#052b78");
  });

  it("leaves the caller's bytes whole", async () => {
    const bytes = pdfWithImage(10, 10, [5, 43, 120]);
    const length = bytes.length;
    await readLogoColor(bytes);
    expect(bytes.length).toBe(length);
  });

  it("never decodes an image over the pixel limit", async () => {
    // 2,100 x 2,000 is 4.2 megapixels: a photo or a scan, never a crest.
    const width = 2100;
    const height = 2000;
    expect(width * height).toBeGreaterThan(MAX_LOGO_PIXELS);
    expect(await readLogoColor(pdfWithImage(width, height, [5, 43, 120]))).toBeNull();
    // The same image just under the limit is read, so the null above is the limit at work.
    expect(await readLogoColor(pdfWithImage(2000, 1999, [5, 43, 120]))).toBe("#052b78");
  });

  it("gives up with no colour when the read takes too long", async () => {
    expect(COLOR_TIMEOUT_MS).toBe(3_000);
    expect(await readLogoColor(pdfWithImage(40, 40, [5, 43, 120]), 0)).toBeNull();
  });

  it("returns no colour, rather than throwing, for bytes that are not a PDF", async () => {
    expect(await readLogoColor(new TextEncoder().encode("not a pdf"))).toBeNull();
  });
});
