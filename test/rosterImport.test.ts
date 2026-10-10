import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Every roster format goes through POST /api/rosters/extract and ends in the
// same extractRoster call: one system prompt, one schema, one model. These run
// the real route with a stand-in for OpenRouter that records what it was sent,
// and a stand-in for the session that says who is signed in.
// =============================================================================

const create = vi.fn();
// The crest read on a PDF, stood in for so a test can say what the crest was.
const crest = vi.fn(async (): Promise<string | null> => null);
vi.mock("@/lib/rosters/logoColors", () => ({ readLogoColor: () => crest() }));

// A plain function, not a spy, so the session can be swapped per test.
let session: () => Promise<unknown> = async () => null;
// Outside a request there is no cookie store; the session itself is stubbed below.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));
// The spend guard always says yes here; test/usageLimits.test.ts covers it.
vi.mock("@/lib/server/usage", () => ({
  beginUsage: async () => ({ ok: true, ticket: null }),
  finishUsage: async () => undefined,
}));
vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/openrouter")>();
  const { fakeFetch } = await import("./fakeOpenRouter");
  return { ...original, createOpenRouterClient: (apiKey: string) => original.createOpenRouterClient(apiKey, fakeFetch(create)) };
});

import { resetRateLimits } from "@/lib/server/rateLimit";
import { POST } from "@/app/api/rosters/extract/route";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA, USER_PROMPTS } from "@/lib/rosters/extractionPrompt";
import { IMPORT_MODEL } from "@/lib/ai/openrouter";
import { chatReply, userParts } from "./fakeOpenRouter";
import { MAX_TEXT_CHARS } from "@/lib/rosters/extractErrors";
import { rowsToText, parseCsv } from "@/lib/rosters/tableText";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function signIn(signedIn = true) {
  resetRateLimits();
  session = signedIn
    ? async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() })
    : async () => null;
}

/** What the model reads off the page: one Estancia running back. */
function roster(lastName = "Langan"): { team: Record<string, unknown>; players: unknown[]; warnings: string[] } {
  return {
    team: { school: "Estancia", mascot: "Eagles", sport: "football", gender: null, level: "varsity", season: null },
    players: [
      { jersey: "22", first_name: "Sam", last_name: lastName, position: "RB", grade: "11", height: null, weight: null, flags: [] },
    ],
    warnings: [],
  };
}

/** What OpenRouter sends back, carrying that roster. */
function reply(lastName = "Langan") {
  return chatReply(roster(lastName));
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

/** The content parts of the one model call, by type. */
function sentBlocks() {
  expect(create).toHaveBeenCalledTimes(1);
  const [params] = create.mock.calls[0];
  expect(params.model).toBe(IMPORT_MODEL);
  expect(params.messages[0]).toEqual({ role: "system", content: EXTRACTION_SYSTEM_PROMPT });
  expect(params.response_format.json_schema.schema).toEqual(ROSTER_SCHEMA);
  expect(params.provider).toMatchObject({ zdr: true, data_collection: "deny" });
  return userParts(params);
}

const ROSTER_TEXT = "Estancia Eagles Varsity Football Roster 22 Sam Langan RB 11 8 Diego Bargas WR 12";

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue(reply());
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  signIn();
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

  it("pdf with a huge text layer: cut to MAX_TEXT_CHARS before it goes to the model", async () => {
    // A real roster is a few thousand characters (H3).
    const text = `22 Sam Langan RB ${"word ".repeat(MAX_TEXT_CHARS / 4)}`;
    const response = await upload("pdf", { files: [{ bytes: pdf(text), name: "huge.pdf", type: "application/pdf" }] });
    expect(response.status).toBe(200);
    const sent = sentBlocks()[0].text ?? "";
    expect(sent).toContain("Langan");
    expect(sent.length).toBeLessThanOrEqual(USER_PROMPTS.pdf_text.length + 2 + MAX_TEXT_CHARS);
  });

  it("pdf that is a scan: the pages, as images", async () => {
    const response = await upload("pdf", { files: [{ bytes: pdf(null), name: "scan.pdf", type: "application/pdf" }] });
    expect(response.status).toBe(200);
    const blocks = sentBlocks();
    expect(blocks.map((b) => b.type)).toEqual(["file", "text"]);
    expect(blocks[0].file?.file_data).toMatch(/^data:application\/pdf;base64,/);
    // Read by the model itself, never OpenRouter's text or OCR parser.
    expect(create.mock.calls[0][0].plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
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
    expect(blocks.map((b) => b.type)).toEqual(["image_url", "image_url", "text"]);
    expect(blocks.map((b) => b.image_url?.url.split(";")[0])).toEqual(["data:image/png", "data:image/jpeg", undefined]);
    expect(create.mock.calls[0][0].plugins).toBeUndefined();
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

describe("a suffix is not part of the surname (Jed, Oct 9)", () => {
  it("saves \"Langan III\" as Langan", async () => {
    create.mockResolvedValue(reply("Langan III"));
    const body = await (await upload("text", { text: ROSTER_TEXT })).json();
    expect(body.players[0]).toMatchObject({ first_name: "Sam", last_name: "Langan" });
    expect(body.players[0].flags).not.toContain("not_in_source");
  });

  it("tells the model to leave it out", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/suffix \(Jr\., Sr\., II, III, IV, V\) is not part of either name/);
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
  it("refuses a signed-out visitor before calling the model", async () => {
    signIn(false);
    const response = await upload("text", { text: ROSTER_TEXT });
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("signed_out");
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

  it("names an import where the model found nobody", async () => {
    create.mockResolvedValue(chatReply({ team: {}, players: [], warnings: [] }));
    const response = await upload("text", { text: ROSTER_TEXT });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_players");
  });
});

// Jed, Oct 8: "just have AI infer the color. Get rid of that giant picker."
describe("the team colour", () => {
  function withColor(color: string) {
    const read = roster();
    read.team.color = color;
    return chatReply(read);
  }

  it("is the model's read, as lowercase #rrggbb", async () => {
    create.mockResolvedValue(withColor("#0B3D91"));
    const body = await (await upload("text", { text: ROSTER_TEXT })).json();
    expect(body.team.color).toBe("#0b3d91");
    const [params] = create.mock.calls[0];
    expect(params.response_format.json_schema.schema.properties.team.required).toContain("color");
    expect(params.messages[0].content).toContain("color is the team's main colour");
  });

  it("on a PDF is the crest's own colour when it has one, and the model's read when it does not", async () => {
    const file = { files: [{ bytes: pdf(ROSTER_TEXT), name: "roster.pdf", type: "application/pdf" }] };
    create.mockResolvedValue(withColor("#0b3d91"));
    crest.mockResolvedValueOnce("#aa0011");
    expect((await (await upload("pdf", file)).json()).team.color).toBe("#aa0011");
    create.mockResolvedValue(withColor("#0b3d91"));
    crest.mockResolvedValueOnce(null);
    expect((await (await upload("pdf", file)).json()).team.color).toBe("#0b3d91");
  });

  it("is nothing when the model could not tell, or wrote something that is not a colour", async () => {
    for (const color of ["", "navy blue", "#12345"]) {
      create.mockResolvedValue(withColor(color));
      const body = await (await upload("text", { text: ROSTER_TEXT })).json();
      expect(body.team.color ?? null, color).toBeNull();
    }
  });
});

describe("the colour on the team page", () => {
  it("is the number block in the colour, its hex, and Clear; or a line saying the next import reads it", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { TeamColor } = await import("@/components/rosters/TeamColor");
    const set = renderToStaticMarkup(createElement(TeamColor, { value: "#0B3D91", onClear: () => undefined }));
    expect(set).toContain("background:#0b3d91");
    expect(set).toContain("#0b3d91");
    expect(set).toContain(">Clear<");
    const none = renderToStaticMarkup(createElement(TeamColor, { value: null, onClear: () => undefined }));
    expect(none).toContain("The next roster import reads it");
  });
});
