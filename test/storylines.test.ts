import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { calls, usageAnswer } from "./fakeUsage";

// =============================================================================
// "Other info" (Jed, Oct 8): any file or text, read by the model for one
// storyline per player it mentions; recent-game stats count. The pure rules,
// the prompt, and the real route with a stand-in for OpenRouter. Made-up names only.
// Ported from V3: the route's session is stubbed and its spend guard talks to
// the fake database from test/fakeServer.ts instead of a Supabase rpc.
// =============================================================================

const create = vi.fn();

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
// A plain function, not a spy, so a test can sign out.
let session: () => Promise<unknown> = async () => null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));
let db = fakeDatabase(usageAnswer());
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));
vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/openrouter")>();
  const { fakeFetch } = await import("./fakeOpenRouter");
  return { ...original, createOpenRouterClient: (apiKey: string) => original.createOpenRouterClient(apiKey, fakeFetch(create)) };
});

import { POST } from "@/app/api/storylines/extract/route";
import { MAX_STORYLINE_CHARS } from "@/lib/cards/cardFace";
import { savedRow, type EditorRow } from "@/lib/rosters/editor";
import { OPENROUTER_MODEL } from "@/lib/ai/openrouter";
import { chatReply, userParts } from "./fakeOpenRouter";
import { isPlainText } from "@/lib/rosters/importFiles";
import { STORYLINES_SCHEMA, STORYLINES_SYSTEM_PROMPT, storylineRoster } from "@/lib/rosters/storylinePrompt";
import {
  applyStorylines,
  fitStoryline,
  isStorylinesResponse,
  MAX_STORYLINE_PLAYERS,
  normalizeStorylines,
  readStorylinePlayers,
  storylinePlayers,
  type StorylinePlayer,
} from "@/lib/rosters/storylines";
import type { RosterPlayer } from "@/lib/rosters/types";

function player(jersey: string, first: string, last: string, extra: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    jersey,
    first_name: first,
    last_name: last,
    position: "RB",
    grade: null,
    height: null,
    weight: null,
    pronunciations: [],
    spot_mode: "normal",
    flags: [],
    ...extra,
  } as RosterPlayer;
}

function rows(): EditorRow[] {
  return [
    savedRow(player("22", "Reed", "Fennimore"), null),
    savedRow(player("7", "Tobin", "Castellane", { position: "QB", storyline: "Committed to Pell State" }), null),
    savedRow(player("", "", "  "), null),
  ];
}

const PLAYERS: StorylinePlayer[] = [
  { id: "row-a", jersey: "22", first_name: "Reed", last_name: "Fennimore", position: "RB", storyline: "" },
  { id: "row-b", jersey: "7", first_name: "Tobin", last_name: "Castellane", position: "QB", storyline: "Committed to Pell State" },
];

describe("what the page sends", () => {
  it("is every row with a surname, by row key, with the current storyline", () => {
    const sent = storylinePlayers(rows());
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ jersey: "7", first_name: "Tobin", last_name: "Castellane", position: "QB", storyline: "Committed to Pell State" });
    expect(sent[0].id).toMatch(/^row-\d+$/);
  });

  it("is checked on the server, and anything off is refused", () => {
    expect(readStorylinePlayers(JSON.stringify(PLAYERS))).toEqual(PLAYERS);
    expect(readStorylinePlayers(null)).toBeNull();
    expect(readStorylinePlayers("not json")).toBeNull();
    expect(readStorylinePlayers("[]")).toBeNull();
    expect(readStorylinePlayers(JSON.stringify([PLAYERS[0], PLAYERS[0]]))).toBeNull();
    expect(readStorylinePlayers(JSON.stringify([{ ...PLAYERS[0], id: "row a; drop" }]))).toBeNull();
    expect(readStorylinePlayers(JSON.stringify([{ ...PLAYERS[0], last_name: "" }]))).toBeNull();
    const many = Array.from({ length: MAX_STORYLINE_PLAYERS + 1 }, (_, i) => ({ ...PLAYERS[0], id: `row-${i}` }));
    expect(readStorylinePlayers(JSON.stringify(many))).toBeNull();
  });
});

describe("fitting a storyline to the card", () => {
  it("keeps one that fits, and cuts a long one at a whole word with no dangling separator", () => {
    expect(fitStoryline("  3 TD,  188 rush yds vs Westlake ")).toBe("3 TD, 188 rush yds vs Westlake");
    const long = "212 pass yds, 3 TD vs Westlake last Friday; also ran for a score and caught a two point try late";
    const fitted = fitStoryline(long);
    expect([...fitted].length).toBeLessThanOrEqual(MAX_STORYLINE_CHARS);
    expect(long.startsWith(fitted)).toBe(true);
    expect(fitted).not.toMatch(/[;, ]$/);
  });
});

describe("cleaning the model's answer", () => {
  it("keeps one storyline per known player and drops the rest", () => {
    const { suggestions, notes } = normalizeStorylines(
      {
        players: [
          { id: "row-a", storyline: "3 TD, 188 rush yds vs Westlake" },
          { id: "row-a", storyline: "A second one for the same player" },
          { id: "row-zz", storyline: "Nobody on this roster" },
          { id: "row-b", storyline: "Committed to Pell State" },
          { id: "row-b", storyline: "   " },
        ],
        notes: ["  A Marsh with no number: not on the roster.  ", 4, ""],
      },
      PLAYERS,
    );
    expect(suggestions).toEqual([{ id: "row-a", storyline: "3 TD, 188 rush yds vs Westlake" }]);
    expect(notes).toEqual(["A Marsh with no number: not on the roster."]);
  });

  it("treats a reply that is not the shape as no suggestions", () => {
    expect(normalizeStorylines("nope", PLAYERS)).toEqual({ suggestions: [], notes: [] });
    expect(isStorylinesResponse({ suggestions: [{ id: "row-a", storyline: "x" }], notes: [] })).toBe(true);
    expect(isStorylinesResponse({ suggestions: [{ id: 4 }], notes: [] })).toBe(false);
  });
});

describe("the picks in the table", () => {
  it("replace only the picked rows' storylines and mark them edited", () => {
    const before = rows();
    const after = applyStorylines(before, new Map([[before[0].key, "3 TD vs Westlake"], ["row-gone", "nobody"]]));
    expect(after[0].player.storyline).toBe("3 TD vs Westlake");
    expect(after[0].edited).toBe(true);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });
});

describe("the prompt", () => {
  it("counts recent-game stats, caps the length, and keeps private things about minors out", () => {
    expect(STORYLINES_SYSTEM_PROMPT).toContain("Stats from recent games always count");
    expect(STORYLINES_SYSTEM_PROMPT).toContain(`At most ${MAX_STORYLINE_CHARS} characters`);
    expect(STORYLINES_SYSTEM_PROMPT).toContain("These are minors");
    expect(STORYLINES_SYSTEM_PROMPT).toContain("Never invent");
  });

  it("has nothing nullable in its schema", () => {
    expect(JSON.stringify(STORYLINES_SCHEMA)).not.toContain("null");
  });

  it("lists each player with its id and current storyline", () => {
    expect(storylineRoster(PLAYERS)).toBe(
      "row-a  #22  Reed Fennimore  RB\nrow-b  #7  Tobin Castellane  QB  (current storyline: Committed to Pell State)",
    );
  });
});

describe("a plain text file", () => {
  it("is read as text", () => {
    expect(isPlainText(new File(["x"], "notes.txt", { type: "text/plain" }))).toBe(true);
    expect(isPlainText(new File(["x"], "Notes.MD"))).toBe(true);
    expect(isPlainText(new File(["x"], "box.pdf", { type: "application/pdf" }))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The route.
// -----------------------------------------------------------------------------

const ARTICLE = "Fennimore ran for 188 yards and 3 touchdowns as the Eagles beat Westlake 35-14 on Friday.";

function reply(body: unknown) {
  return chatReply(body, { prompt_tokens: 10, completion_tokens: 5, cost: 0.00002 });
}

function post(form: FormData) {
  return POST(
    new Request("https://spotter.example/api/storylines/extract", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: form,
    }),
  );
}

function textForm(players: unknown = PLAYERS) {
  const form = new FormData();
  form.set("format", "text");
  form.set("text", ARTICLE);
  form.set("players", typeof players === "string" ? players : JSON.stringify(players));
  form.set("team", "Estancia Eagles");
  return form;
}

describe("POST /api/storylines/extract", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    db = fakeDatabase(usageAnswer());
    session = async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the material against the roster and answers storylines by row key", async () => {
    create.mockResolvedValue(reply({ players: [{ id: "row-a", storyline: "188 rush yds, 3 TD vs Westlake" }, { id: "row-x", storyline: "?" }], notes: [] }));
    const response = await post(textForm());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      suggestions: [{ id: "row-a", storyline: "188 rush yds, 3 TD vs Westlake" }],
      notes: [],
      format: "text",
      route: "text",
      pages: 0,
    });

    const [params] = create.mock.calls[0];
    expect(params.model).toBe(OPENROUTER_MODEL);
    expect(params.messages[0].content).toBe(STORYLINES_SYSTEM_PROMPT);
    expect(params.response_format.json_schema.schema).toEqual(STORYLINES_SCHEMA);
    expect(params.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    const sent = userParts(params)[0].text as string;
    expect(sent).toContain(ARTICLE);
    expect(sent).toContain("The team: Estancia Eagles.");
    expect(sent).toContain("row-b  #7  Tobin Castellane  QB");
    // Counted by the spend guard as a stats import.
    expect(calls(db.statements, "usage_begin").map((s) => s.params)).toEqual([[USER, "stats_import"]]);
    // And the call's tokens are recorded on its reservation.
    expect(calls(db.statements, "usage_finish")[0].params.slice(3, 8)).toEqual([true, "openrouter", 10, 5, 0]);
  });

  it("says so when the model found nothing new for anyone", async () => {
    create.mockResolvedValue(reply({ players: [], notes: [] }));
    const response = await post(textForm());
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_storylines");
  });

  it("refuses an upload without a usable player list before calling the model", async () => {
    const response = await post(textForm("[]"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("bad_players");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller and an unconfirmed email before calling the model or the spend guard", async () => {
    session = async () => null;
    expect((await post(textForm())).status).toBe(401);
    session = async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: false, isAdmin: false, signedInAt: new Date() });
    const response = await post(textForm());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("email_not_verified");
    expect(create).not.toHaveBeenCalled();
    expect(db.statements).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The team page's panel and review, rendered.
// -----------------------------------------------------------------------------

describe("the Other info panel", () => {
  it("is a bar that says what it does, and is shut until there are players", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { StorylineImport } = await import("@/components/rosters/StorylineImport");
    const html = renderToStaticMarkup(createElement(StorylineImport, { rows: rows(), teamName: "Estancia Eagles", onApply: () => undefined }));
    expect(html).toContain("Spotter writes storylines for the players it mentions");
    const empty = renderToStaticMarkup(createElement(StorylineImport, { rows: [], teamName: "", onApply: () => undefined }));
    expect(empty).toContain("Add the roster first.");
  });

  it("shows each suggestion beside the current storyline, ticked, with the notes", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { StorylineReview } = await import("@/components/rosters/StorylineImport");
    const table = rows();
    const html = renderToStaticMarkup(
      createElement(StorylineReview, {
        source: "game-story.txt",
        picks: [
          { id: table[0].key, storyline: "188 rush yds, 3 TD vs Westlake", keep: true },
          { id: table[1].key, storyline: "Threw for 240 vs Westlake", keep: false },
          { id: "row-gone", storyline: "Nobody", keep: true },
        ],
        notes: ["A Marsh with no number: not on the roster."],
        rows: table,
        onChange: () => undefined,
        onApply: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    expect(html).toContain("Storylines from game-story.txt");
    expect(html).toContain("#22 Reed Fennimore");
    expect(html).toContain('value="188 rush yds, 3 TD vs Westlake"');
    expect(html).toContain("Now: Committed to Pell State");
    expect(html).toContain("A Marsh with no number: not on the roster.");
    expect(html).not.toContain("Nobody");
    // One of the two still in the table is ticked.
    expect(html).toContain("Add 1 storyline to the table");
    expect(html).toContain("2 players");
  });
});
