import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Every roster format goes through POST /api/rosters/extract and ends in the
// same extractRoster call: one system prompt, one schema, one model. These run
// the real route with a stand-in for Anthropic that records what it was sent,
// and a stand-in for the session that says who is signed in.
// =============================================================================

const create = vi.fn();

// A plain function, not a spy, so the session can be swapped per test.
let session: () => Promise<unknown> = async () => null;
// Outside a request there is no cookie store; the session itself is stubbed below.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));
vi.mock("@/lib/rosters/extractWithClaude", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rosters/extractWithClaude")>();
  return { ...original, createAnthropicClient: () => ({ messages: { create } }) };
});

import { resetRateLimits } from "@/lib/server/rateLimit";
import { POST } from "@/app/api/rosters/extract/route";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA, USER_PROMPTS } from "@/lib/rosters/extractionPrompt";
import { EXTRACTION_MODEL } from "@/lib/rosters/extractWithClaude";
import { MAX_TEXT_CHARS } from "@/lib/rosters/extractErrors";
import { rowsToText, parseCsv } from "@/lib/rosters/tableText";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function signIn(approved: boolean) {
  resetRateLimits();
  session = async () => ({ id: USER, email: "a@example.com", name: null, approved, isAdmin: false, signedInAt: new Date() });
}

/** What Claude sends back: one Estancia running back. */
function reply(lastName = "Langan") {
  return {
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          team: { school: "Estancia", mascot: "Eagles", sport: "football", gender: null, level: "varsity", season: null },
          players: [
            { jersey: "22", first_name: "Sam", last_name: lastName, position: "RB", grade: "11", height: null, weight: null, flags: [] },
          ],
          warnings: [],
        }),
      },
    ],
  };
}

/** A one-page PDF. With text, it has a real text layer; without, it reads like a scan. */
function pdf(text: string | null): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 10 100 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function upload(format: string, parts: { files?: Array<{ bytes: Uint8Array; name: string; type: string }>; text?: string }) {
  const form = new FormData();
  form.set("format", format);
  for (const file of parts.files ?? []) form.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  if (parts.text !== undefined) form.set("text", parts.text);
  return POST(
    new Request("https://spotter.example/api/rosters/extract", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: form,
    }),
  );
}

/** The content blocks of the one Claude call, by type. */
function sentBlocks() {
  expect(create).toHaveBeenCalledTimes(1);
  const [params] = create.mock.calls[0];
  expect(params.model).toBe(EXTRACTION_MODEL);
  expect(params.system).toBe(EXTRACTION_SYSTEM_PROMPT);
  expect(params.output_config.format.schema).toBe(ROSTER_SCHEMA);
  return params.messages[0].content as Array<{ type: string; text?: string; source?: { media_type: string } }>;
}

const ROSTER_TEXT = "Estancia Eagles Varsity Football Roster 22 Sam Langan RB 11 8 Diego Bargas WR 12";

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue(reply());
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  signIn(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("every format reaches the same extraction path", () => {
  it("pdf with a text layer: the text", async () => {
    const response = await upload("pdf", { files: [{ bytes: pdf(ROSTER_TEXT), name: "roster.pdf", type: "application/pdf" }] });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["text"]);
    expect(blocks[0].text).toContain(USER_PROMPTS.pdf_text);
    expect(blocks[0].text).toContain("Langan");
    const body = await response.json();
    expect(body).toMatchObject({ format: "pdf", route: "text", pages: 1 });
    expect(body.players[0]).toMatchObject({ last_name: "Langan", spot_mode: "normal" });
  });

  it("pdf that is a scan: the pages, as images", async () => {
    const response = await upload("pdf", { files: [{ bytes: pdf(null), name: "scan.pdf", type: "application/pdf" }] });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["document", "text"]);
    expect(blocks[0].source?.media_type).toBe("application/pdf");
    expect((await response.json()).route).toBe("vision");
  });

  it("images: every image, then the instruction", async () => {
    const response = await upload("image", {
      files: [
        { bytes: PNG, name: "a.png", type: "image/png" },
        { bytes: JPEG, name: "b.jpg", type: "image/jpeg" },
      ],
    });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["image", "image", "text"]);
    expect(blocks.map((b) => b.source?.media_type)).toEqual(["image/png", "image/jpeg", undefined]);
    expect(await response.json()).toMatchObject({ format: "image", route: "vision", pages: 2 });
  });

  it("pasted text: the text", async () => {
    const response = await upload("text", { text: ROSTER_TEXT });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks[0].text).toContain(USER_PROMPTS.text);
    expect(await response.json()).toMatchObject({ format: "text", route: "text" });
  });

  it("csv: the rows, as text", async () => {
    const text = rowsToText(parseCsv('#,Name,Pos\n22,"Langan, Sam",RB\n8,Diego Bargas,WR\n'));
    const response = await upload("csv", { text });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks[0].text).toContain(USER_PROMPTS.table);
    expect(blocks[0].text).toContain("22 | Langan, Sam | RB");
    expect((await response.json()).format).toBe("csv");
  });

  it("xlsx: the rows, as text", async () => {
    const text = rowsToText([["#", "First", "Last"], [22, "Sam", "Langan"]]);
    const response = await upload("xlsx", { text });
    expect(response.status).toBe(200);
    expect(sentBlocks()[0].text).toContain("22 | Sam | Langan");
    expect((await response.json()).format).toBe("xlsx");
  });
});

describe("grounding runs wherever there was text", () => {
  it("flags a surname that is not in what was pasted", async () => {
    create.mockResolvedValue(reply("Invented"));
    const body = await (await upload("text", { text: ROSTER_TEXT })).json();
    expect(body.players[0].flags).toContain("not_in_source");
  });

  it("does not flag an image import, which has no text to check against", async () => {
    create.mockResolvedValue(reply("Invented"));
    const body = await (await upload("image", { files: [{ bytes: PNG, name: "a.png", type: "image/png" }] })).json();
    expect(body.players[0].flags).not.toContain("not_in_source");
  });
});

describe("the guards", () => {
  it("refuses an unapproved account before calling Anthropic", async () => {
    signIn(false);
    const response = await upload("text", { text: ROSTER_TEXT });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("not_approved");
    expect(create).not.toHaveBeenCalled();
  });

  const cases: Array<[string, () => Promise<Response>, string, number]> = [
    ["an unknown format", () => upload("docx", { text: "x" }), "bad_format", 400],
    ["a PDF that is not one", () => upload("pdf", { files: [{ bytes: PNG, name: "x.pdf", type: "application/pdf" }] }), "not_pdf", 400],
    ["a file that is not an image", () => upload("image", { files: [{ bytes: pdf(null), name: "x.png", type: "image/png" }] }), "not_image", 400],
    [
      "six images",
      () => upload("image", { files: Array.from({ length: 6 }, (_, i) => ({ bytes: PNG, name: `${i}.png`, type: "image/png" })) }),
      "too_many_images",
      400,
    ],
    ["no file", () => upload("image", {}), "no_file", 400],
    ["empty text", () => upload("text", { text: "   " }), "no_text", 400],
    ["too much text", () => upload("text", { text: "a".repeat(MAX_TEXT_CHARS + 1) }), "too_much_text", 413],
  ];

  for (const [name, send, code, status] of cases) {
    it(`names ${name}`, async () => {
      const response = await send();
      expect(response.status).toBe(status);
      expect((await response.json()).code).toBe(code);
      expect(create).not.toHaveBeenCalled();
    });
  }

  it("names an import where Claude found nobody", async () => {
    create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ team: {}, players: [], warnings: [] }) }] });
    const response = await upload("text", { text: ROSTER_TEXT });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_players");
  });
});
