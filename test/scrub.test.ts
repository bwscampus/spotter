import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";

// POST /api/game-logs is called below with a stubbed session and the fake
// database from test/fakeServer.ts; nothing else here touches either.
const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({
  readSession: async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() }),
}));
const db = fakeDatabase();
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));
import { Summary } from "@/components/game/GameSetup";
import { assembleGame } from "@/lib/game/buildGame";
import type { StoredRecord } from "@/lib/log/records";
import { SHARED_GAME_ID, SCRUB_VERSION, scrubLog, toSharedLog, withoutInterims } from "@/lib/log/scrub";
import {
  clearShareChoice,
  MAX_SHARE_CHARS,
  prepareShare,
  setShareChoice,
  shareChoice,
  SHARE_NOTE,
  type Compress,
} from "@/lib/log/shareLog";

// A game's log, scrubbed so a copy can be shared (Jed, Oct 5). Last names are
// kept, because a pronunciation failure is read from them; first names and
// schools are replaced by tags. The point of every test here: no first name and
// no school is left in what would leave the browser. Made-up names only.

const T0 = 1_791_300_000_000;

const WATCHLIST = [
  {
    name: "Quellenbach",
    aliases: ["kwell en back", "quillen bach"],
    keyterm: "Quellenbach",
    label: "Quellenbach",
    players: [
      { jersey: "24", first_name: "Dario", last_name: "Quellenbach", side: "H", pronunciation: "kwell-en-BAHK", stat_lines: [] },
    ],
  },
  {
    name: "Pellworth",
    aliases: [],
    keyterm: "Pellworth",
    label: "Pellworth #4 H · #18 A",
    players: [
      { jersey: "4", first_name: "Jonah", last_name: "Pellworth", side: "H", stat_lines: [] },
      { jersey: "18", first_name: "Elias", last_name: "Pellworth", side: "A", stat_lines: [] },
    ],
  },
  {
    name: "Marchetto",
    aliases: ["marchetto"],
    keyterm: "Marchetto",
    players: [{ jersey: "7", first_name: "Will", last_name: "Marchetto", side: "A", stat_lines: [] }],
  },
];

const STATS_ROSTER = [
  { playerId: "H24-QUELLENBACH", side: "home", jersey: "24", first: "Dario", last: "Quellenbach", position: "RB", season: { rush_att: 5 } },
  { playerId: "H4-PELLWORTH", side: "home", jersey: "4", first: "Jonah", last: "Pellworth", position: "QB", season: null },
  { playerId: "A18-PELLWORTH", side: "away", jersey: "18", first: "Elias", last: "Pellworth", position: "LB", season: null },
  { playerId: "A7-MARCHETTO", side: "away", jersey: "7", first: "Will", last: "Marchetto", position: "WR", season: null },
  { playerId: "H55-WU", side: "home", jersey: "55", first: "Tao", last: "Wu", position: "OL", season: null },
];

const RECORDS = [
  {
    kind: "game",
    gameId: "game-secret-id",
    at: T0,
    snapshot: {
      home: { id: "roster-1", name: "Harborview", wearing: null, color: "#0b2545" },
      away: { id: "roster-2", name: "Castellan Prep", wearing: "white", color: "#ffb612" },
      sport: "football",
      statsEnabled: true,
      keyterms: ["Quellenbach", "Pellworth"],
      watchlist: WATCHLIST,
      statsRoster: STATS_ROSTER,
      teamCues: [
        { words: ["harborview", "gulls"], side: "H" },
        { words: ["castellan", "foxes", "white"], side: "A" },
      ],
    },
  },
  { kind: "result", gameId: "game-secret-id", at: T0 + 1000, connectionId: 1, is_final: false, speech_final: false, start: 1, duration: 1, transcript: "kwell en back up the middle", confidence: 0.9, words: [{ word: "kwell", start: 1, end: 1.2, confidence: 0.9 }, { word: "quellenbach", start: 1.2, end: 1.5, confidence: 0.8 }] },
  { kind: "result", gameId: "game-secret-id", at: T0 + 2000, connectionId: 1, is_final: true, speech_final: true, start: 1, duration: 2, transcript: "Dario Quellenbach carries and will marchetto makes the tackle for castellan prep", confidence: 0.9, words: [] },
  { kind: "utterance", gameId: "game-secret-id", at: T0 + 2100, connectionId: 1, text: "pellworth hands off to coach tolliver's son while harborview watches", offsetMs: 2100 },
  { kind: "utterance", gameId: "game-secret-id", at: T0 + 3000, connectionId: 1, text: "wu is in at left guard and number 55 is flagged", offsetMs: 3000 },
  { kind: "row", gameId: "game-secret-id", at: T0 + 3100, row: { at: new Date(T0 + 3100).toISOString(), type: "match", name: "Quellenbach", word: "quellenbach", score: 1, threshold: 0.8, confidence: 0.9, source: "final", latencyMs: 900, domMs: 10, slots: ["Quellenbach#0"] } },
  { kind: "stats_play", gameId: "game-secret-id", at: T0 + 4000, playId: "0-1", readAt: T0 + 4000, play: { summary: "QUELLENBACH 4 yd run, tackle by MARCHETTO", evidence: "quellenbach up the middle", events: [{ playerId: "H24-QUELLENBACH", action: "rush" }, { playerId: "A7-MARCHETTO", action: "tackle" }] } },
  { kind: "audio", gameId: "game-secret-id", at: T0 + 5000, speechDb: -30, gainDb: 12, source: "room" },
] as unknown as StoredRecord[];

// What must not survive: first names, schools and mascots, and the real game id.
const GONE = ["dario", "jonah", "elias", "castellan", "harborview", "gulls", "foxes", "game-secret-id", "tao "];

describe("scrubLog", () => {
  const { records, masked } = scrubLog(RECORDS);
  const text = JSON.stringify(records).toLowerCase();

  it("leaves no first name, no school and no game id in what would be shared", () => {
    for (const name of GONE) expect(text, name).not.toContain(name);
    // A first name that is an everyday word is masked beside its surname.
    expect(text).not.toContain("will marchetto");
    expect(masked).toBeGreaterThanOrEqual(2);
  });

  it("keeps last names exactly as said, and every way they were heard", () => {
    const interim = records[1] as { transcript: string; words: Array<{ word: string }> };
    expect(interim.transcript).toBe("kwell en back up the middle");
    expect(interim.words.map((w) => w.word)).toEqual(["kwell", "quellenbach"]);
    expect(text).toContain("pellworth");
    expect(text).toContain("marchetto");
  });

  it("turns a first name into the player's side and number, and keeps the surname after it", () => {
    const final = records.find((r) => (r as { is_final?: boolean }).is_final === true) as { transcript: string };
    expect(final.transcript).toBe("[H24] Quellenbach carries and [A7] marchetto makes the tackle for [AWAY1] prep");
  });

  it("keeps a surname two players share, as said", () => {
    const said = records.find((r) => (r as { text?: string }).text?.startsWith("pellworth")) as { text: string };
    expect(said.text).toContain("pellworth hands off");
  });

  it("keeps a short surname, and the word it sits in is left alone", () => {
    const said = records.find((r) => (r as { text?: string }).text?.includes("left guard")) as { text: string };
    expect(said.text).toBe("wu is in at left guard and number 55 is flagged");
  });

  it("masks the school and the name after a role like coach, but leaves colours and numbers", () => {
    const said = records.find((r) => (r as { text?: string }).text?.includes("hands off")) as { text: string };
    expect(said.text).toContain("coach [name]");
    expect(said.text).toContain("while [HOME1] watches");
    expect(scrubLog([...RECORDS, { ...RECORDS[3], text: "white 5 and the coach said hello" } as unknown as StoredRecord]).records.at(-1)).toMatchObject({ text: "white 5 and the coach said hello" });
  });

  it("keeps a playerId whole, since its surname is shared, and the plays that name players", () => {
    const play = records.find((r) => (r as { kind: string }).kind === "stats_play") as { play: { summary: string; evidence: string; events: Array<{ playerId: string }> } };
    expect(play.play.events.map((e) => e.playerId)).toEqual(["H24-QUELLENBACH", "A7-MARCHETTO"]);
    expect(play.play.summary).toBe("QUELLENBACH 4 yd run, tackle by MARCHETTO");
  });

  it("keeps a match row's surname, word and slots, and makes its time relative", () => {
    const row = (records.find((r) => (r as { kind: string }).kind === "row") as { row: Record<string, unknown> }).row;
    expect(row).toMatchObject({ name: "Quellenbach", word: "quellenbach", slots: ["Quellenbach#0"], type: "match", score: 1 });
    expect(row.at).toBe("+3100");
  });

  it("makes every time an offset from the start, and drops the game id", () => {
    expect(records.map((r) => (r as { at: number }).at)).toEqual([0, 1000, 2000, 2100, 3000, 3100, 4000, 5000]);
    for (const record of records) expect((record as { gameId: string }).gameId).toBe(SHARED_GAME_ID);
    expect((records[6] as { readAt: number }).readAt).toBe(4000);
  });

  it("keeps the kind of every record, and the numbers that say how it went", () => {
    expect(records.map((r) => (r as { kind: string }).kind)).toEqual(["game", "result", "result", "utterance", "utterance", "row", "stats_play", "audio"]);
    expect(records[7]).toMatchObject({ speechDb: -30, gainDb: 12, source: "room" });
    expect(records[1]).toMatchObject({ confidence: 0.9, is_final: false });
  });

  it("shares the game a replay needs, every first name and school as its tag, and no team name, colour or id", () => {
    const game = records[0] as { kind: string; gameId: string; at: number; snapshot: Record<string, unknown> };
    expect(game).toMatchObject({ kind: "game", gameId: SHARED_GAME_ID, at: 0 });
    // Each school word its own numbered tag, the same in the transcript, the cues and the names.
    expect(game.snapshot).toMatchObject({ sport: "football", statsEnabled: true, home: { name: "[HOME1]" }, away: { name: "[AWAY1] Prep" } });
    // The keyterms and the team cues, word by word, as the transcript has them.
    expect(game.snapshot.keyterms).toEqual(["Quellenbach", "Pellworth"]);
    expect(game.snapshot.teamCues).toEqual([
      { side: "H", words: ["[HOME1]", "[HOME2]"] },
      { side: "A", words: ["[AWAY1]", "[AWAY2]", "white"] },
    ]);
    // Both full rosters: playerIds and season numbers kept, first names as tags.
    expect(game.snapshot.statsRoster).toEqual([
      { playerId: "H24-QUELLENBACH", side: "home", jersey: "24", first: "[H24]", last: "Quellenbach", position: "RB", season: { rush_att: 5 } },
      { playerId: "H4-PELLWORTH", side: "home", jersey: "4", first: "[H4]", last: "Pellworth", position: "QB", season: null },
      { playerId: "A18-PELLWORTH", side: "away", jersey: "18", first: "[A18]", last: "Pellworth", position: "LB", season: null },
      // Will is an everyday word the transcript keeps; the roster still never does.
      { playerId: "A7-MARCHETTO", side: "away", jersey: "7", first: "[A7]", last: "Marchetto", position: "WR", season: null },
      { playerId: "H55-WU", side: "home", jersey: "55", first: "[H55]", last: "Wu", position: "OL", season: null },
    ]);
    // The watchlist: surnames, the ways they are heard, how they are said; nothing else about the player.
    const watchlist = game.snapshot.watchlist as Array<{ name: string; aliases: string[]; players: Array<Record<string, unknown>> }>;
    expect(watchlist.map((entry) => entry.name)).toEqual(["Quellenbach", "Pellworth", "Marchetto"]);
    expect(watchlist[0].aliases).toEqual(["kwell en back", "quillen bach"]);
    expect(watchlist[0].players[0]).toMatchObject({ jersey: "24", first_name: "[H24]", last_name: "Quellenbach", side: "H", pronunciation: "kwell-en-BAHK" });
    expect(watchlist[1].players.map((player) => player.first_name)).toEqual(["[H4]", "[A18]"]);
    for (const player of watchlist.flatMap((entry) => entry.players)) {
      expect(player).toMatchObject({ grade: null, height: null, weight: null });
      expect(player).not.toHaveProperty("face");
    }
    // The short list a person reads, as scrub 2 had it.
    expect(game.snapshot.roster).toEqual([
      { id: "H24", last: "Quellenbach", said: "kwell-en-BAHK", heardAs: ["kwell en back", "quillen bach"], position: "RB", hasSeason: true },
      { id: "H4", last: "Pellworth", said: null, heardAs: [], position: "QB", hasSeason: false },
      { id: "A18", last: "Pellworth", said: null, heardAs: [], position: "LB", hasSeason: false },
      { id: "A7", last: "Marchetto", said: null, heardAs: ["marchetto"], position: "WR", hasSeason: false },
      { id: "H55", last: "Wu", said: null, heardAs: [], position: "OL", hasSeason: false },
    ]);
    const snapshotText = JSON.stringify(game.snapshot);
    for (const gone of ["#0b2545", "#ffb612", "roster-1", "roster-2", "Will", "Tao"]) expect(snapshotText, gone).not.toContain(gone);
  });

  it("masks a player's first name beside its own surname only, when it is also somebody's surname", () => {
    const withJordan = structuredClone(RECORDS) as unknown as Array<{ snapshot?: { statsRoster: unknown[] } }>;
    withJordan[0].snapshot!.statsRoster.push(
      { playerId: "H9-JORDAN", side: "home", jersey: "9", first: "Mika", last: "Jordan", position: "WR", season: null },
      { playerId: "A3-SOLVIK", side: "away", jersey: "3", first: "Jordan", last: "Solvik", position: "DB", season: null },
    );
    const said = { kind: "utterance", gameId: "g", at: T0 + 6000, connectionId: 1, text: "jordan solvik picks it off and jordan is down", offsetMs: 6000 };
    const out = scrubLog([...(withJordan as unknown as StoredRecord[]), said as unknown as StoredRecord]);
    expect((out.records.at(-1) as { text: string }).text).toBe("[A3] solvik picks it off and jordan is down");
    const roster = (out.records[0] as { snapshot: { statsRoster: Array<{ playerId: string; first: string }> } }).snapshot.statsRoster;
    expect(roster.find((player) => player.playerId === "A3-SOLVIK")!.first).toBe("[A3]");
  });

  it("masks a first name Deepgram spelled its own way, right before the surname", () => {
    // Bartholomew Kessling is on the roster; "bartholemew kessling" is how it was heard.
    const withBart = structuredClone(RECORDS) as unknown as Array<{ snapshot?: { statsRoster: unknown[] } }>;
    withBart[0].snapshot!.statsRoster.push({ playerId: "H31-KESSLING", side: "home", jersey: "31", first: "Bartholomew", last: "Kessling", position: "LB", season: null });
    const said = { kind: "utterance", gameId: "g", at: T0 + 6000, connectionId: 1, text: "bartholemew kessling breaks free", offsetMs: 6000 };
    const words = { kind: "result", gameId: "g", at: T0 + 6000, connectionId: 1, is_final: true, transcript: "bartholemew kessling", words: [{ word: "bartholemew", start: 1, end: 1.2, confidence: 0.9 }, { word: "kessling", start: 1.2, end: 1.6, confidence: 0.9 }] };
    const out = scrubLog([...(withBart as unknown as StoredRecord[]), said, words] as unknown as StoredRecord[]);
    expect((out.records.at(-2) as { text: string }).text).toBe("[H31] kessling breaks free");
    expect((out.records.at(-1) as { words: Array<{ word: string }> }).words.map((word) => word.word)).toEqual(["[H31]", "kessling"]);
    expect(JSON.stringify(out.records)).not.toMatch(/barthol/i);
  });

  it("does not take a first name out of the middle of a surname at an apostrophe, but does before a possessive", () => {
    const withEli = structuredClone(RECORDS) as unknown as Array<{ snapshot?: { statsRoster: unknown[] } }>;
    withEli[0].snapshot!.statsRoster.push({ playerId: "A44-ZAMORA", side: "away", jersey: "44", first: "Eli", last: "Zamora", position: "DB", season: null });
    const said = { kind: "utterance", gameId: "g", at: T0 + 6000, connectionId: 1, text: "eli'ipule on the stop and eli's hit", offsetMs: 6000 };
    const out = scrubLog([...(withEli as unknown as StoredRecord[]), said as unknown as StoredRecord]);
    expect((out.records.at(-1) as { text: string }).text).toBe("eli'ipule on the stop and [A44]'s hit");
  });

  it("leaves a first name the matcher hears as somebody's surname, as the game heard it", () => {
    // "tyler" fires Taylor on the live screen, so it stays; beside its own surname it is still masked.
    const withTyler = structuredClone(RECORDS) as unknown as Array<{ snapshot?: { statsRoster: unknown[]; watchlist: unknown[] } }>;
    withTyler[0].snapshot!.watchlist.push({ name: "Taylor", aliases: [], players: [{ jersey: "13", first_name: "Owen", last_name: "Taylor", side: "H", stat_lines: [] }] });
    withTyler[0].snapshot!.statsRoster.push({ playerId: "A2-VOSS", side: "away", jersey: "2", first: "Tyler", last: "Voss", position: "QB", season: null });
    const said = { kind: "utterance", gameId: "g", at: T0 + 6000, connectionId: 1, text: "and they love tyler while tyler voss throws", offsetMs: 6000 };
    const out = scrubLog([...(withTyler as unknown as StoredRecord[]), said as unknown as StoredRecord]);
    expect((out.records.at(-1) as { text: string }).text).toBe("and they love tyler while [A2] voss throws");
  });

  it("does not change the log it was given", () => {
    expect(JSON.stringify(RECORDS)).toContain("Dario");
    expect((RECORDS[0] as unknown as { gameId: string }).gameId).toBe("game-secret-id");
  });

  // What the scrub cannot do, said as a test so nobody mistakes it for a promise.
  it("cannot find a first name that is on neither roster, which is why the note says so", () => {
    const out = scrubLog([...RECORDS, { ...RECORDS[4], text: "and the new kid fennimore takes the handoff" } as unknown as StoredRecord]);
    expect((out.records.at(-1) as { text: string }).text).toContain("fennimore");
    expect(SHARE_NOTE).toContain("on neither roster can slip through");
    expect(SHARE_NOTE).toContain("last names");
  });

  it("works on a log with no game record and no names", () => {
    const bare = scrubLog([{ kind: "utterance", gameId: "g", at: T0, connectionId: 1, text: "third and four", offsetMs: 0 }] as unknown as StoredRecord[]);
    expect(bare.records).toEqual([{ kind: "utterance", gameId: SHARED_GAME_ID, at: 0, connectionId: 1, text: "third and four", offsetMs: 0 }]);
    expect(bare.masked).toBe(0);
  });
});

describe("a shared log", () => {
  it("is the scrubbed records with the scrub's version, and can drop its interim results", () => {
    const { log } = toSharedLog(RECORDS);
    expect(log).toMatchObject({ format: "spotter-v3-shared-log", scrubVersion: SCRUB_VERSION });
    const final = withoutInterims(log);
    expect(final.records.filter((r) => (r as { kind: string }).kind === "result")).toHaveLength(1);
    expect(final.records).toHaveLength(log.records.length - 1);
  });
});

describe("preparing a share", () => {
  const plain: Compress = async (text) => `x${text.length}`;
  const many = [...RECORDS, ...RECORDS.slice(1)];

  it("makes the row the table takes, from the scrubbed log only", async () => {
    let seen = "";
    const row = await prepareShare(many, { sport: "football", statsEnabled: true }, async (text) => {
      seen = text;
      return "gz";
    });
    expect(row).toMatchObject({ sport: "football", stats_enabled: true, scrub_version: SCRUB_VERSION, interims_dropped: false, log_gz_b64: "gz" });
    expect(row!.masked).toBeGreaterThan(0);
    for (const name of GONE) expect(seen.toLowerCase(), name).not.toContain(name);
  });

  // V3 held the row equal to the columns its migration granted the browser to
  // insert, with row level security on. Here the browser posts the row to
  // /api/game-logs and the database takes it only through share_game_log(p_owner, ...),
  // so the row is held equal to that function's arguments instead.
  it("sends exactly share_game_log's arguments, with no owner, game or school in them", async () => {
    const row = (await prepareShare(many, { sport: "football", statsEnabled: true }, plain))!;
    const sql = readFileSync(new URL("../db/migrations/0008_shared_game_logs.sql", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const args = /create function public\.share_game_log\(([^)]+)\)/.exec(sql)![1]
      .split(",")
      .map((arg) => arg.trim().split(/\s+/)[0]);
    expect(args[0]).toBe("p_owner");
    expect(Object.keys(row).sort()).toEqual(args.slice(1).map((arg) => arg.replace(/^p_/, "")).sort());
    // The table itself: no owner id, no game id, no school, gone after 90 days.
    const table = /create table shared_game_logs \(([\s\S]*?)\n\);/.exec(sql)![1];
    expect(table).not.toMatch(/owner_id|game_id|school/);
    expect(table).toMatch(/interval '90 days'/);
  });

  it("is stored by POST /api/game-logs under the session's account, argument for argument", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    try {
      const row = (await prepareShare(many, { sport: "football", statsEnabled: true }, plain))!;
      const { POST } = await import("@/app/api/game-logs/route");
      const response = await POST(
        new Request("https://spotter.example/api/game-logs", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
          body: JSON.stringify({ ...row, owner_hash: "f".repeat(64), owner: "someone-else" }),
        }),
      );
      expect(response.status).toBe(201);
      const [statement] = db.statements;
      expect(statement.text).toContain("public.share_game_log($1, $2, $3, $4, $5, $6, $7, $8)");
      expect(statement.params).toEqual([
        USER,
        row.sport,
        row.stats_enabled,
        row.scrub_version,
        row.records,
        row.masked,
        row.interims_dropped,
        row.log_gz_b64,
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops the interim results when the log is too big, and sends nothing when it is still too big", async () => {
    const sizes: number[] = [];
    const big: Compress = async (text) => {
      sizes.push(text.length);
      return "z".repeat(sizes.length === 1 ? MAX_SHARE_CHARS + 1 : 10);
    };
    expect(await prepareShare(many, { sport: null, statsEnabled: false }, big)).toMatchObject({ interims_dropped: true, log_gz_b64: "zzzzzzzzzz" });
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(await prepareShare(many, { sport: null, statsEnabled: false }, async () => "z".repeat(MAX_SHARE_CHARS + 1))).toBeNull();
  });

  it("has nothing to share from a log where the mic never ran, and a sport the table does not know is none", async () => {
    expect(await prepareShare(RECORDS.slice(0, 2), { sport: "football", statsEnabled: false }, plain)).toBeNull();
    expect((await prepareShare(many, { sport: "curling", statsEnabled: false }, plain))!.sport).toBeNull();
  });
});

describe("the choice to share", () => {
  const store = new Map<string, string>();
  const original = globalThis.localStorage;
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

  it("is not made for a game that never had one, is kept per game, and is forgotten when the game ends", () => {
    Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
    try {
      expect(shareChoice("g1")).toBe(false);
      setShareChoice("g1", true);
      setShareChoice("g2", false);
      expect([shareChoice("g1"), shareChoice("g2")]).toEqual([true, false]);
      clearShareChoice("g1");
      expect(shareChoice("g1")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });
});

describe("game setup", () => {
  const home = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
  const away = { id: "away", school: "Castellan Prep", mascot: "Foxes", sport: "football" };
  const loaded = { ...assembleGame(home, away, []), keyterm: { kind: "ok" as const } };
  const props = { loaded, wearing: { home: null, away: null }, onWearing: () => undefined, starting: false, approved: true, onStart: () => undefined, today: "2026-10-05" };

  it("has the share switch on by default, with what it sends said beside it", () => {
    const html = renderToStaticMarkup(createElement(Summary, props));
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Share a copy of this game&#x27;s log, last names kept"|aria-label="Share a copy of this game&#x27;s log, last names kept"[^>]*aria-checked="true"/);
    expect(html).toContain("Share game log");
    expect(html.replace(/&#x27;/g, "'")).toContain(SHARE_NOTE);
  });

  it("shows it off when it is passed off", () => {
    const html = renderToStaticMarkup(createElement(Summary, { ...props, share: false }));
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Share a copy|aria-label="Share a copy[^>]*aria-checked="false"/);
  });
});
