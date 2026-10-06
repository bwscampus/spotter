import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { GameItem, PastGames } from "@/components/games/PastGames";
import {
  logsInBrowser,
  matchupOf,
  minutesListened,
  PAST_GAMES_LIMIT,
  toPastGame,
  type PastGame,
  type PastGameRow,
} from "@/lib/game/pastGames";
import { listPastGames } from "@/lib/server/repo/games";

let db = fakeDatabase();
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])) }));

// docs/V3_DEFINITION.md 9.1: a called_games row is a matchup, two times and
// counts. Made-up schools throughout.

const row = (over: Partial<PastGameRow> = {}): PastGameRow => ({
  id: "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11",
  home_school: "Brentwood",
  away_school: "Estancia",
  sport: "football",
  stats_enabled: false,
  started_at: "2026-09-25T19:03:00.000Z",
  ended_at: "2026-09-25T21:05:00.000Z",
  mic_seconds: 6300,
  reconnects: 2,
  cards_shown: 234,
  cards_removed: 24,
  stat_plays_added: 0,
  stat_plays_undone: 0,
  game_feedback: null,
  ...over,
});

const OWNER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

/** The row as Postgres hands it back: timestamps as Dates. */
const dbRow = (over: Partial<PastGameRow> = {}) => {
  const r = row(over);
  return { ...r, started_at: new Date(r.started_at), ended_at: r.ended_at ? new Date(r.ended_at) : null };
};

describe("the list query (lib/server/repo/games.ts)", () => {
  it("reads only this account's games, newest first, with a limit, and joins the rating", async () => {
    db = fakeDatabase(() => [dbRow()]);
    await listPastGames(OWNER);
    const [{ text, params }] = db.statements;
    expect(text).toMatch(/from called_games g/);
    expect(text).toMatch(/where g\.owner_id = \$1/);
    expect(text).toMatch(/order by g\.started_at desc/);
    expect(text).toMatch(/left join game_feedback f/);
    expect(params).toEqual([OWNER, PAST_GAMES_LIMIT]);
  });

  it("asks for every count the page shows, and nothing that names a player", async () => {
    db = fakeDatabase(() => []);
    await listPastGames(OWNER);
    const [{ text }] = db.statements;
    for (const column of ["cards_shown", "cards_removed", "stat_plays_added", "stat_plays_undone", "stats_enabled", "mic_seconds"]) {
      expect(text).toContain(column);
    }
    expect(text).not.toMatch(/player|transcript|note/i);
  });

  it("keeps the order the database gave, which is newest first", async () => {
    db = fakeDatabase(() => [
      dbRow({ id: "b", started_at: "2026-09-26T19:00:00.000Z" }),
      dbRow({ id: "a", started_at: "2026-09-25T19:00:00.000Z" }),
    ]);
    const result = await listPastGames(OWNER);
    expect(result.ok && result.games.map((game) => game.id)).toEqual(["b", "a"]);
  });

  it("says the read failed, which is not the same as having no games", async () => {
    db = fakeDatabase(() => {
      throw new Error("connection refused");
    });
    expect(await listPastGames(OWNER)).toEqual({ ok: false });
    db = fakeDatabase(() => []);
    expect(await listPastGames(OWNER)).toEqual({ ok: true, games: [] });
  });
});

describe("toPastGame", () => {
  it("maps the row onto what the page shows", () => {
    expect(toPastGame(row())).toEqual({
      id: "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11",
      homeSchool: "Brentwood",
      awaySchool: "Estancia",
      sport: "football",
      statsEnabled: false,
      startedAt: "2026-09-25T19:03:00.000Z",
      endedAt: "2026-09-25T21:05:00.000Z",
      micSeconds: 6300,
      cardsShown: 234,
      cardsRemoved: 24,
      statPlaysAdded: 0,
      statPlaysUndone: 0,
      rating: null,
    });
  });

  it("carries the rating whether game_feedback comes back as one row or a list", () => {
    expect(toPastGame(row({ game_feedback: { rating: 4 } })).rating).toBe(4);
    expect(toPastGame(row({ game_feedback: [{ rating: 5 }] })).rating).toBe(5);
    expect(toPastGame(row({ game_feedback: [] })).rating).toBeNull();
  });

  it("shows no rating rather than a wrong one", () => {
    expect(toPastGame(row({ game_feedback: { rating: 9 } })).rating).toBeNull();
    expect(toPastGame(row({ game_feedback: { rating: 0 } })).rating).toBeNull();
  });

  it("leaves an unended game's end empty", () => {
    expect(toPastGame(row({ ended_at: null })).endedAt).toBeNull();
  });
});

describe("what the list says", () => {
  it("names the matchup away first, like the live screen", () => {
    expect(matchupOf(toPastGame(row()))).toBe("Estancia at Brentwood");
  });

  it("rounds listening to minutes, and does not call a short test 0", () => {
    expect([0, 10, 29, 30, 90, 6300].map(minutesListened)).toEqual([
      "0 min",
      "under 1 min",
      "under 1 min",
      "1 min",
      "2 min",
      "105 min",
    ]);
  });
});

describe("the log still in this browser", () => {
  const counts: Record<string, number> = { a: 120, b: 0, c: 3 };

  it("finds the games with records, and only those", async () => {
    const found = await logsInBrowser(["a", "b", "c", "d"], async (id) => counts[id] ?? 0);
    expect([...found].sort()).toEqual(["a", "c"]);
  });

  it("asks about each game once", async () => {
    const asked: string[] = [];
    await logsInBrowser(["a", "b"], async (id) => (asked.push(id), 1));
    expect(asked.sort()).toEqual(["a", "b"]);
  });

  it("treats a game it cannot read as having no log, without losing the rest", async () => {
    const found = await logsInBrowser(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("InvalidStateError");
      return counts[id];
    });
    expect([...found].sort()).toEqual(["a", "c"]);
  });

  it("finds nothing with no games, and nothing when storage is unavailable", async () => {
    expect((await logsInBrowser([], async () => 5)).size).toBe(0);
    const failing = await logsInBrowser(["a"], async () => {
      throw new Error("SecurityError");
    });
    expect(failing.size).toBe(0);
  });
});

describe("the page", () => {
  const game = (over: Partial<PastGame> = {}): PastGame => ({ ...toPastGame(row()), ...over });
  const item = (over: Partial<PastGame>, hasLog: boolean) =>
    renderToStaticMarkup(createElement("ul", null, createElement(GameItem, { game: game(over), hasLog })));

  it("shows the matchup and every count", () => {
    const html = item({ statPlaysAdded: 7, statPlaysUndone: 1, statsEnabled: true, rating: 4 }, false);
    expect(html).toContain("Estancia at Brentwood");
    expect(html).toContain("105 min");
    for (const label of ["Cards shown", "Cards removed", "Stat plays added", "Stat plays undone", "Stats", "Your rating"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/Cards shown<\/span><span[^>]*>234</);
    expect(html).toMatch(/Cards removed<\/span><span[^>]*>24</);
    expect(html).toMatch(/Stat plays added<\/span><span[^>]*>7</);
    expect(html).toMatch(/Stat plays undone<\/span><span[^>]*>1</);
    expect(html).toMatch(/>Stats<\/span><span[^>]*>On</);
    expect(html).toContain("4 of 5");
  });

  it("says stats were off and there is no rating yet", () => {
    const html = item({}, false);
    expect(html).toMatch(/>Stats<\/span><span[^>]*>Off</);
    expect(html).toMatch(/Your rating<\/span><span[^>]*>None</);
  });

  it("has a Download button only when this browser still has the log", () => {
    expect(item({}, true)).toMatch(/<button[^>]*>Download<\/button>/);
    expect(item({}, false)).not.toContain("Download");
  });

  it("says when a game was never ended", () => {
    expect(item({ endedAt: null }, false)).toContain("Not ended");
    expect(item({}, false)).not.toContain("Not ended");
  });

  it("has no player name in it: a game row has none to show", () => {
    expect(item({}, true)).not.toMatch(/langan|wright|vargas/i);
  });

  it("says so when the read failed, when there are no games, and lists games otherwise", () => {
    const list = (games: PastGame[] | null) => renderToStaticMarkup(createElement(PastGames, { games }));
    expect(list(null)).toContain("Could not load your past games");
    expect(list([])).toContain("No games yet");
    const html = list([game({ id: "a" }), game({ id: "b", awaySchool: "Oakridge" })]);
    expect(html).toContain("Estancia at Brentwood");
    expect(html).toContain("Oakridge at Brentwood");
    // Before the browser has answered, no game claims a log it may not have.
    expect(html).not.toContain("Download");
  });
});
