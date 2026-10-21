import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// A volleyball roster import (Jed, Oct 21) through the real route, with a
// stand-in for OpenRouter that records what it was sent. The players and every
// stat column come back from one call; football's import is the call it always
// was. Made-up names only.
// =============================================================================

const create = vi.fn();
vi.mock("@/lib/rosters/logoColors", () => ({ readLogoColor: async () => null }));

let session: () => Promise<unknown> = async () => null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));
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
import { createOpenRouterClient } from "@/lib/ai/openrouter";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA, USER_PROMPTS } from "@/lib/rosters/extractionPrompt";
import { VOLLEYBALL_STATS_UNREAD } from "@/lib/rosters/readRoster";
import {
  VOLLEYBALL_ROSTER_SCHEMA,
  VOLLEYBALL_ROSTER_SYSTEM_PROMPT,
  VOLLEYBALL_STATS_SCHEMA,
  VOLLEYBALL_STATS_SYSTEM_PROMPT,
} from "@/lib/rosters/volleyballPrompt";
import { extractStats } from "@/lib/stats/extractStats";
import { chatReply, userParts } from "./fakeOpenRouter";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

/** What the model reads off a volleyball roster with stats: a hitter, a libero, and a setter with none. */
function volleyballRoster(sport: string | null = "volleyball", withStats = true) {
  const stats = (pairs: Array<[string, string]>) => (withStats ? pairs.map(([label, value]) => ({ label, value })) : undefined);
  const player = (jersey: string, first: string, last: string, position: string, pairs: Array<[string, string]>) => ({
    jersey,
    first_name: first,
    last_name: last,
    position,
    grade: "Jr.",
    height: null,
    weight: null,
    flags: [],
    ...(withStats ? { stats: stats(pairs) } : {}),
  });
  return {
    team: { school: "Lakeview", mascot: "Lions", sport, gender: "girls", level: "varsity", season: "26-27", color: "" },
    players: [
      player("4", "Tess", "Varga", "Outside Hitter", [["K", "245"], ["E", "66"], ["TA", "560"], ["Kill %", "43.8"]]),
      player("7", "Lena", "Brandt", "Libero/DS", [["DIG", "310"], ["R%", "93.5%"], ["K", "0"]]),
      player("2", "Maya", "Okafor", "S", []),
    ],
    warnings: [],
  };
}

function pdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
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

const ROSTER_TEXT = "Lakeview Girls Volleyball 4 Tess Varga OH 7 Lena Brandt L 2 Maya Okafor S Kills 245";

function upload(fields: Record<string, string>, file?: Uint8Array) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  if (file) form.append("file", new File([file as BlobPart], "roster.pdf", { type: "application/pdf" }));
  return POST(
    new Request("https://spotter.example/api/rosters/extract", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: form,
    }),
  );
}

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  resetRateLimits();
  session = async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() });
});
afterEach(() => vi.unstubAllEnvs());

describe("a volleyball team's import", () => {
  it("reads the players and their stats in one call, from the PDF itself", async () => {
    create.mockResolvedValue(chatReply(volleyballRoster()));
    const response = await upload({ format: "pdf", sport: "volleyball" }, pdf(ROSTER_TEXT));
    expect(response.status).toBe(200);

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.messages[0]).toEqual({ role: "system", content: VOLLEYBALL_ROSTER_SYSTEM_PROMPT });
    expect(params.response_format.json_schema.schema).toEqual(VOLLEYBALL_ROSTER_SCHEMA);
    expect(params.provider).toMatchObject({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(params).not.toHaveProperty("temperature");
    // The page, so the stats tables' columns line up, with its own instruction.
    const parts = userParts(params);
    expect(parts.map((part) => part.type)).toEqual(["file", "text"]);
    expect(parts[1].text).toBe(USER_PROMPTS.pdf_document);

    const body = await response.json();
    // Names were checked against the text layer, so this was not a photo.
    expect(body.route).toBe("text");
    expect(body.team.sport).toBe("volleyball");
    expect(body.players.map((p: { position: string }) => p.position)).toEqual(["OH", "L", "S"]);
    expect(body.players[0].season_values).toEqual([
      { label: "K", value: "245" },
      { label: "E", value: "66" },
      { label: "TA", value: "560" },
      { label: "Kill %", value: "43.8" },
    ]);
    // A name and a number with no stats is still a player.
    expect(body.players[2]).not.toHaveProperty("season_values");
    expect(body.players[2].last_name).toBe("Okafor");
  });

  it("reads a volleyball roster again for its stats when the browser did not know it was one", async () => {
    create.mockResolvedValueOnce(chatReply(volleyballRoster("volleyball", false))).mockResolvedValueOnce(chatReply(volleyballRoster()));
    const response = await upload({ format: "text", text: ROSTER_TEXT });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].messages[0].content).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(create.mock.calls[1][0].messages[0].content).toBe(VOLLEYBALL_ROSTER_SYSTEM_PROMPT);
    const body = await response.json();
    expect(body.players[0].season_values[0]).toEqual({ label: "K", value: "245" });
    expect(body.warnings).toEqual([]);
  });

  it("keeps the roster and says so when that second read fails", async () => {
    create.mockResolvedValueOnce(chatReply(volleyballRoster("volleyball", false))).mockResolvedValueOnce({ status: 500 });
    const response = await upload({ format: "text", text: ROSTER_TEXT });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.players).toHaveLength(3);
    expect(body.warnings).toEqual([VOLLEYBALL_STATS_UNREAD]);
  });
});

describe("a football import is the call it always was", () => {
  it("one call, the roster prompt and schema, whatever sport the form names", async () => {
    create.mockResolvedValue(chatReply({ ...volleyballRoster("football", false) }));
    const forms: Array<Record<string, string>> = [{ format: "text", text: ROSTER_TEXT }, { format: "text", text: ROSTER_TEXT, sport: "football" }];
    for (const fields of forms) {
      create.mockClear();
      resetRateLimits();
      const response = await upload(fields);
      expect(response.status).toBe(200);
      expect(create).toHaveBeenCalledTimes(1);
      const [params] = create.mock.calls[0];
      expect(params.messages[0]).toEqual({ role: "system", content: EXTRACTION_SYSTEM_PROMPT });
      expect(params.response_format.json_schema.schema).toEqual(ROSTER_SCHEMA);
      const body = await response.json();
      // Positions as printed, and no stats on anyone.
      expect(body.players[0].position).toBe("Outside Hitter");
      for (const player of body.players) expect(player).not.toHaveProperty("season_values");
    }
  });

  it("asks for no stats in the roster prompt every other sport uses", () => {
    expect(VOLLEYBALL_ROSTER_SYSTEM_PROMPT.startsWith(EXTRACTION_SYSTEM_PROMPT)).toBe(true);
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/season stat/i);
    expect(ROSTER_SCHEMA.properties.players.items.required).not.toContain("stats");
  });
});

describe("the volleyball schemas", () => {
  type Node = Record<string, unknown>;
  const walk = (node: unknown): Node[] =>
    typeof node !== "object" || node === null
      ? []
      : Array.isArray(node)
        ? node.flatMap(walk)
        : [node as Node, ...Object.values(node).flatMap(walk)];

  it.each([
    ["roster", VOLLEYBALL_ROSTER_SCHEMA],
    ["stats", VOLLEYBALL_STATS_SCHEMA],
  ])("the %s schema closes every object, requires every property, and stays under 16 nullable fields", (_, schema) => {
    const nodes = walk(schema);
    for (const node of nodes) {
      if (node.type !== "object") continue;
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as Node).sort());
    }
    const nullable = nodes.filter(
      (node) => (Array.isArray(node.type) && node.type.includes("null")) || (Array.isArray(node.anyOf) && (node.anyOf as Node[]).some((b) => b.type === "null")),
    );
    expect(nullable.length).toBeLessThanOrEqual(16);
    expect(nodes.filter((node) => node.enum !== undefined && Array.isArray(node.type))).toEqual([]);
  });
});

describe("a volleyball stats sheet on the Season stats page", () => {
  it("is one call with the volleyball prompt, cleaned into labelled values", async () => {
    create.mockResolvedValue(
      chatReply({
        players: [{ jersey: "4", last_name: "Varga", stats: [{ label: "Kills", value: "245" }, { label: "Hit %", value: ".301" }] }],
        warnings: [],
      }),
    );
    const read = await extractStats(
      createOpenRouterClient("test-key"),
      { kind: "text", text: "Attacking # Name Kills Hit % 4 T. Varga 245 .301" },
      [{ jersey: "4", first_name: "Tess", last_name: "Varga" }],
      "values",
      AbortSignal.timeout(5_000),
    );
    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.messages[0].content).toBe(VOLLEYBALL_STATS_SYSTEM_PROMPT);
    expect(params.response_format.json_schema.schema).toEqual(VOLLEYBALL_STATS_SCHEMA);
    expect(read).toMatchObject({
      kind: "values",
      blocks: [{ jersey: "4", last_name: "Varga", values: [{ label: "K", value: "245" }, { label: "PCT", value: ".301" }] }],
      usage: { calls: 1 },
    });
  });
});
