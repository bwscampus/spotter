import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { calls, usageAnswer } from "./fakeUsage";

// =============================================================================
// The Schedule import (Oct 28, docs/V3_DEFINITION.md 6.7): what the model's
// reply turns into, how a missing year is worked out from the season, what the
// review table sends, saved web pages, and the real route with a stand-in for
// OpenRouter. Every school here is made up.
// =============================================================================

const create = vi.fn();

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
const TEAM = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
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

import { POST } from "@/app/api/schedule/extract/route";
import { IMPORT_MODEL } from "@/lib/ai/openrouter";
import { isWebPage, webPageText } from "@/lib/rosters/webPage";
import {
  cleanOpponent,
  FUTURE_SCORE_NOTE,
  inferYears,
  normalizeSchedule,
  ONE_SCORE_NOTE,
  seasonYears,
  type ExtractedGame,
} from "@/lib/schedule/normalize";
import {
  draftOf,
  emptyDraft,
  isScheduleExtractResponse,
  rowProblem,
  scheduleImportProps,
  scheduleProblem,
  toScheduleSaveBody,
} from "@/lib/schedule/review";
import { SCHEDULE_SCHEMA, SCHEDULE_SYSTEM_PROMPT, scheduleUserPrompt } from "@/lib/schedule/schedulePrompt";
import { isCalendarDate, isScheduleGame, scheduleFor } from "@/lib/schedule/types";
import { isScheduleBody } from "@/lib/server/validate";
import { chatReply, userParts } from "./fakeOpenRouter";

function game(month: number, day: number, extra: Partial<ExtractedGame> = {}): ExtractedGame {
  return {
    month,
    day,
    year: null,
    opponent: "Harlow Ridge",
    site: "H",
    team_score: null,
    opponent_score: null,
    is_league: false,
    unsure: false,
    note: "",
    ...extra,
  };
}

const FALL = { season: "2026", today: "2026-10-28" };

describe("the year a schedule leaves off", () => {
  it("reads a season's years however it is written", () => {
    expect(seasonYears("26-27")).toEqual({ first: 2026, second: 2027 });
    expect(seasonYears("2026-27")).toEqual({ first: 2026, second: 2027 });
    expect(seasonYears("2026-2027")).toEqual({ first: 2026, second: 2027 });
    expect(seasonYears("2026")).toEqual({ first: 2026, second: null });
    expect(seasonYears("Fall 2026")).toEqual({ first: 2026, second: null });
    expect(seasonYears("26")).toEqual({ first: 2026, second: null });
    expect(seasonYears(null)).toBeNull();
    expect(seasonYears("Varsity")).toBeNull();
  });

  it("takes a fall season's year for a fall schedule", () => {
    expect(inferYears([game(8, 28), game(11, 6)], FALL)).toEqual([2026, 2026]);
  });

  it("splits a two-year season at July: autumn the first year, spring the second", () => {
    expect(inferYears([game(11, 20), game(1, 9), game(2, 14)], { season: "26-27", today: "2026-10-28" })).toEqual([2026, 2027, 2027]);
  });

  it("carries a one-year season over New Year when the schedule straddles it", () => {
    expect(inferYears([game(12, 5), game(1, 9)], FALL)).toEqual([2026, 2027]);
    // A spring schedule never straddles: all that year.
    expect(inferYears([game(2, 20), game(5, 1)], FALL)).toEqual([2026, 2026]);
  });

  it("keeps a year the source shows, and lets it anchor the rows that have none", () => {
    expect(inferYears([game(9, 4, { year: 2025 }), game(9, 11), game(1, 2)], FALL)).toEqual([2025, 2025, 2026]);
  });

  it("with no season, puts each game nearest today", () => {
    expect(inferYears([game(9, 4), game(3, 1)], { season: null, today: "2026-10-28" })).toEqual([2026, 2027]);
  });
});

describe("what the model read, as rows", () => {
  it("turns each game into a review row, oldest first, with the year worked out", () => {
    const { games, warnings } = normalizeSchedule(
      {
        games: [
          game(9, 5, { opponent: "@ Kettle Creek (4-2)", site: "A", team_score: 17, opponent_score: 20, is_league: true }),
          game(8, 29, { opponent: "vs. Harlow Ridge", team_score: 28, opponent_score: 14 }),
          game(11, 6, { opponent: "Coastline", site: "N" }),
        ],
        warnings: [" Two rows were faint. "],
      },
      FALL,
    );
    expect(games.map((row) => ({ date: row.date, opponent: row.opponent, site: row.site, teamScore: row.teamScore, opponentScore: row.opponentScore, league: row.league, flags: row.flags }))).toEqual([
      { date: "2026-08-29", opponent: "Harlow Ridge", site: "H", teamScore: "28", opponentScore: "14", league: false, flags: [] },
      { date: "2026-09-05", opponent: "Kettle Creek", site: "A", teamScore: "17", opponentScore: "20", league: true, flags: [] },
      { date: "2026-11-06", opponent: "Coastline", site: "N", teamScore: "", opponentScore: "", league: false, flags: [] },
    ]);
    expect(warnings).toEqual(["Two rows were faint."]);
  });

  it("flags what the model was unsure of, a lone score, and a score on a game not played yet", () => {
    const { games } = normalizeSchedule(
      {
        games: [
          game(9, 12, { unsure: true, note: "Site not shown" }),
          game(9, 19, { team_score: 21, opponent_score: null }),
          game(11, 13, { team_score: 7, opponent_score: 3 }),
        ],
        warnings: [],
      },
      FALL,
    );
    expect(games.map((row) => row.flags)).toEqual([["Site not shown"], [ONE_SCORE_NOTE], [FUTURE_SCORE_NOTE]]);
  });

  it("counts a game listed twice once, and leaves out a row with no date it can read", () => {
    const { games, warnings } = normalizeSchedule(
      { games: [game(8, 29, { team_score: 28, opponent_score: 14 }), game(8, 29, { team_score: 28, opponent_score: 14 }), game(13, 2)], warnings: [] },
      FALL,
    );
    expect(games).toHaveLength(1);
    expect(warnings).toEqual(["1 row had no readable date and was left out."]);
  });

  it("cleans the opponent the way the table keeps it", () => {
    expect(cleanOpponent("  vs   Harlow  Ridge * ")).toBe("Harlow Ridge");
    expect(cleanOpponent("at Kettle Creek (3-1-1)")).toBe("Kettle Creek");
    expect(cleanOpponent("Pinewood")).toBe("Pinewood");
  });
});

describe("the review table", () => {
  it("says what a row needs before it can be saved", () => {
    const row = { ...emptyDraft(), date: "2026-09-05", opponent: "Kettle Creek" };
    expect(rowProblem(row)).toBeNull();
    expect(rowProblem({ ...row, date: "" })).toBe("Needs a date.");
    expect(rowProblem({ ...row, date: "2026-02-30" })).toBe("Needs a date.");
    expect(rowProblem({ ...row, opponent: "  " })).toBe("Needs an opponent.");
    expect(rowProblem({ ...row, teamScore: "21" })).toMatch(/both scores/);
    expect(rowProblem({ ...row, teamScore: "21", opponentScore: "1000" })).toMatch(/0 to 999/);
    expect(rowProblem({ ...row, teamScore: "21", opponentScore: "x" })).toMatch(/0 to 999/);
    expect(scheduleProblem([row, { ...row, opponent: "" }])).toBe("Game 2: Needs an opponent.");
  });

  it("sends every game, oldest first, scores as numbers or null", () => {
    const later = { ...emptyDraft(), date: "2026-11-06", opponent: " Coastline ", site: "N" as const };
    const earlier = { ...emptyDraft(), date: "2026-08-29", opponent: "Harlow Ridge", teamScore: "28", opponentScore: "14", league: true };
    expect(toScheduleSaveBody([later, earlier])).toEqual({
      games: [
        { game_date: "2026-08-29", opponent: "Harlow Ridge", site: "H", team_score: 28, opponent_score: 14, is_league: true },
        { game_date: "2026-11-06", opponent: "Coastline", site: "N", team_score: null, opponent_score: null, is_league: false },
      ],
    });
  });

  it("opens a saved game as a row, and turns it back into the same game", () => {
    const saved = { date: "2026-09-05", opponent: "Kettle Creek", site: "A" as const, teamScore: 17, opponentScore: 20, league: true };
    const row = draftOf(saved);
    expect(toScheduleSaveBody([row]).games[0]).toEqual({
      game_date: "2026-09-05",
      opponent: "Kettle Creek",
      site: "A",
      team_score: 17,
      opponent_score: 20,
      is_league: true,
    });
  });

  it("sends counts only to analytics", () => {
    const rows = normalizeSchedule({ games: [game(9, 12, { unsure: true }), game(9, 19)], warnings: [] }, FALL).games;
    expect(scheduleImportProps(rows)).toEqual({ games: 2, unsure: 1 });
  });
});

describe("what is saved", () => {
  it("accepts a whole schedule and refuses anything the table would", () => {
    const ok = { game_date: "2026-08-29", opponent: "Harlow Ridge", site: "H", team_score: 28, opponent_score: 14, is_league: false };
    expect(isScheduleBody({ games: [ok] })).toBe(true);
    expect(isScheduleBody({ games: [] })).toBe(true);
    expect(isScheduleBody({ games: [{ ...ok, team_score: null }] })).toBe(false);
    expect(isScheduleBody({ games: [{ ...ok, site: "X" }] })).toBe(false);
    expect(isScheduleBody({ games: [{ ...ok, game_date: "2026-02-30" }] })).toBe(false);
    expect(isScheduleBody({ games: [{ ...ok, opponent: " " }] })).toBe(false);
    expect(isScheduleBody({ games: [ok], owner_id: USER })).toBe(false);
    expect(isScheduleBody({ games: Array.from({ length: 81 }, () => ok) })).toBe(false);
  });

  it("reads saved rows back as one team's games, oldest first, and drops a row that is not a game", () => {
    const rows = [
      { team_id: TEAM, game_date: "2026-09-05", opponent: "Kettle Creek", site: "A", team_score: 17, opponent_score: 20, is_league: true },
      { team_id: TEAM, game_date: "2026-08-29", opponent: "Harlow Ridge", site: "H", team_score: null, opponent_score: null, is_league: false },
      { team_id: "other", game_date: "2026-08-29", opponent: "Pinewood", site: "H", team_score: null, opponent_score: null, is_league: false },
      { team_id: TEAM, game_date: "2026-08-30", opponent: "Bad", site: "Q", team_score: null, opponent_score: null, is_league: false },
    ];
    const games = scheduleFor(rows, TEAM);
    expect(games.map((one) => one.opponent)).toEqual(["Harlow Ridge", "Kettle Creek"]);
    expect(games.every(isScheduleGame)).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
  });
});

describe("a saved web page", () => {
  it("is any .html, .htm, .mhtml or .mht file", () => {
    expect(isWebPage({ name: "Schedule.HTML", type: "" })).toBe(true);
    expect(isWebPage({ name: "page.mhtml", type: "" })).toBe(true);
    expect(isWebPage({ name: "x", type: "text/html" })).toBe(true);
    expect(isWebPage({ name: "roster.pdf", type: "application/pdf" })).toBe(false);
  });

  it("becomes its words, a table row a line, with no script or style", () => {
    const html = `<html><head><title>x</title><style>td{color:red}</style></head><body>
      <script>var tracking = "nope";</script><h1>Delmar Falcons Schedule</h1>
      <table><tr><th>Date</th><th>Opponent</th><th>Result</th></tr>
      <tr><td>8/29</td><td>vs Harlow&nbsp;Ridge</td><td>W 28-14</td></tr>
      <tr><td>9/5</td><td>@ Kettle Creek &amp; Co</td><td>L 17-20</td></tr></table><!-- ad --></body></html>`;
    expect(webPageText(html)).toBe(
      ["Delmar Falcons Schedule", "Date | Opponent | Result", "8/29 | vs Harlow Ridge | W 28-14", "9/5 | @ Kettle Creek & Co | L 17-20"].join("\n"),
    );
  });

  it("opens an MHTML archive and decodes its quoted-printable page", () => {
    const mhtml = [
      "From: <Saved by Blink>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary--abc"',
      "",
      "------MultipartBoundary--abc",
      "Content-Type: text/html",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<table><tr><td class=3D"d">8/29</td><td>vs Harlow Ridge =E2=80=93 Home</td></tr></ta=',
      "ble>",
      "------MultipartBoundary--abc--",
    ].join("\r\n");
    expect(webPageText(mhtml)).toBe("8/29 | vs Harlow Ridge – Home");
  });
});

describe("the prompt", () => {
  it("asks for this team's games, its score first, and no guessed year", () => {
    expect(SCHEDULE_SYSTEM_PROMPT).toMatch(/this team's score first/);
    expect(SCHEDULE_SYSTEM_PROMPT).toMatch(/Never guess a year/);
    expect(scheduleUserPrompt({ school: "Delmar", mascot: "Falcons", sport: "football", season: "2026" })).toBe(
      "The team: Delmar Falcons (football, season 2026).\n\nRead this team's schedule from the material above.",
    );
  });

  it("has a closed schema with no nullable enum", () => {
    const item = SCHEDULE_SCHEMA.properties.games.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    for (const property of Object.values(item.properties) as Array<{ type: unknown; enum?: unknown }>) {
      if (property.enum) expect(Array.isArray(property.type)).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// The route, with a stand-in for OpenRouter and the database.
// -----------------------------------------------------------------------------

const TEAM_ROW = { school: "Delmar", mascot: "Falcons", sport: "football", season: "2026" };

function reply(body: unknown) {
  return chatReply(body, { prompt_tokens: 10, completion_tokens: 5, cost: 0.00002 });
}

function onePagePdf(): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] >>"];
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

function post(form: FormData) {
  return POST(new Request("https://spotter.example/api/schedule/extract", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form }));
}

function textForm(team = TEAM) {
  const form = new FormData();
  form.set("format", "text");
  form.set("text", "Aug 29 vs Harlow Ridge W 28-14\nSep 5 @ Kettle Creek L 17-20\nNov 6 vs Coastline");
  form.set("roster_id", team);
  form.set("today", "2026-10-28");
  return form;
}

const READ = {
  games: [
    game(8, 29, { team_score: 28, opponent_score: 14 }),
    game(9, 5, { opponent: "Kettle Creek", site: "A", team_score: 17, opponent_score: 20, is_league: true }),
    game(11, 6, { opponent: "Coastline" }),
  ],
  warnings: [],
};

describe("POST /api/schedule/extract", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    db = fakeDatabase(usageAnswer(undefined, (text) => (text.includes("from rosters") ? [TEAM_ROW] : [])));
    session = async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads pasted text through the import model and answers review rows with the year worked out", async () => {
    create.mockResolvedValue(reply(READ));
    const response = await post(textForm());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(isScheduleExtractResponse(body)).toBe(true);
    expect(body.games.map((row: { date: string; opponent: string }) => `${row.date} ${row.opponent}`)).toEqual([
      "2026-08-29 Harlow Ridge",
      "2026-09-05 Kettle Creek",
      "2026-11-06 Coastline",
    ]);
    expect(body).toMatchObject({ format: "text", route: "text", pages: 0 });

    const [params] = create.mock.calls[0];
    expect(params.model).toBe(IMPORT_MODEL);
    expect(params.messages[0].content).toBe(SCHEDULE_SYSTEM_PROMPT);
    expect(params.response_format.json_schema.schema).toEqual(SCHEDULE_SCHEMA);
    expect(params.provider).toMatchObject({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(params.temperature).toBeUndefined();
    const sent = userParts(params)[0].text as string;
    expect(sent).toContain("Sep 5 @ Kettle Creek L 17-20");
    expect(sent).toContain("The team: Delmar Falcons (football, season 2026).");
    // The team is read for this account only.
    const teamRead = db.statements.find((statement) => statement.text.includes("from rosters"))!;
    expect(teamRead.params).toEqual([TEAM, USER]);
    // Counted by the spend guard as a stats import, with its tokens recorded.
    expect(calls(db.statements, "usage_begin").map((s) => s.params)).toEqual([[USER, "stats_import"]]);
    expect(calls(db.statements, "usage_finish")[0].params.slice(3, 8)).toEqual([true, "openrouter", 10, 5, 0]);
  });

  it("sends a PDF as the document itself, so the columns survive", async () => {
    create.mockResolvedValue(reply(READ));
    const form = new FormData();
    form.set("format", "pdf");
    form.append("file", new File([onePagePdf() as BlobPart], "schedule.pdf", { type: "application/pdf" }));
    form.set("roster_id", TEAM);
    const response = await post(form);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ format: "pdf", route: "vision", pages: 1 });
    const parts = userParts(create.mock.calls[0][0]);
    expect(parts[0]).toMatchObject({ type: "file" });
  });

  it("says so when the model found no games", async () => {
    create.mockResolvedValue(reply({ games: [], warnings: [] }));
    const response = await post(textForm());
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_games");
  });

  it("answers 404 for a team that is not this account's, before calling the model", async () => {
    db = fakeDatabase(usageAnswer());
    const response = await post(textForm());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("team_missing");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a form with no team, and a signed-out caller, before the model", async () => {
    const form = textForm();
    form.set("roster_id", "nope");
    expect((await (await post(form)).json()).code).toBe("no_team");
    session = async () => null;
    expect((await post(textForm())).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
