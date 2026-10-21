import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Summary, openingSport, teamsFor } from "@/components/game/GameSetup";
import { toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";
import { lineText } from "@/lib/cards/lines";
import {
  cleanStatValues,
  hittingPct,
  MAX_STAT_VALUES,
  POSITION_PRIORITY,
  volleyballLine,
  volleyballPosition,
  volleyballStatKey,
  VOLLEYBALL_STAT_KEYS,
  type StatValue,
} from "@/lib/cards/volleyball";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { assembleGame, buildSnapshot, type GamePlayerRow } from "@/lib/game/buildGame";
import { readSetupReturn, readSetupSport, setupHref, stepHref } from "@/lib/game/setupReturn";
import { buildTeamCues } from "@/lib/game/teamCues";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { EMPTY_TEAM, replaceWithImport, savedRow, toSaveArgs } from "@/lib/rosters/editor";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { RosterPlayer, TeamSummary } from "@/lib/rosters/types";
import { normalizeValues } from "@/lib/stats/extractStats";
import { buildStatsReview, toSetSeasonStatsArgs, valueColumnsIn, withValue } from "@/lib/stats/review";
import { statsKindFor } from "@/lib/stats/types";
import { isSaveRosterBody, isSeasonStatsBody } from "@/lib/server/validate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

// =============================================================================
// Volleyball (Jed, Oct 21): prep and spot only. A roster with its season stats,
// a card that leads with what matters for the position, and the same name
// spotting as football. Made-up names and numbers throughout.
// =============================================================================

const v = (label: string, value: string): StatValue => ({ label, value });
const items = (values: StatValue[], position: string | null) => lineText(volleyballLine(values, position));

// An outside hitter with a full MaxPreps line, one column the card does not know.
const HITTER = [
  v("K", "245"),
  v("E", "66"),
  v("TA", "560"),
  v("K/S", "3.4"),
  v("SA", "31"),
  v("SE", "22"),
  v("DIG", "180"),
  v("Kill %", "43.8"),
  v("PTS", "300"),
];

// A libero: no attack stats worth showing, a zero the sheet printed anyway.
const LIBERO = [v("K", "0"), v("A", "25"), v("SA", "14"), v("SE", "9"), v("DIG", "310"), v("DIG/S", "4.6"), v("R", "280"), v("RE", "12"), v("R%", "93.5%")];

describe("positions", () => {
  it.each([
    ["OH", "OH"],
    ["Outside", "OH"],
    ["Outside Hitter", "OH"],
    ["LH", "OH"],
    ["MB", "MB"],
    ["MH", "MB"],
    ["Middle", "MB"],
    ["Middle Blocker", "MB"],
    ["S", "S"],
    ["Setter", "S"],
    ["OPP", "OPP"],
    ["RS", "OPP"],
    ["Right Side", "OPP"],
    ["Opposite", "OPP"],
    ["L", "L"],
    ["Libero", "L"],
    ["Libero/DS", "L"],
    ["L, DS", "L"],
    ["DS", "DS"],
    ["Defensive Specialist", "DS"],
    ["MB, RS", "MB"],
    ["S/RS", "S"],
    ["o.h.", "OH"],
  ])("%s is %s", (raw, code) => {
    expect(volleyballPosition(raw)).toBe(code);
  });

  it("leaves anything else alone", () => {
    expect(volleyballPosition("Utility")).toBeNull();
    expect(volleyballPosition("")).toBeNull();
    expect(volleyballPosition(null)).toBeNull();
  });
});

describe("cleaning what a sheet printed", () => {
  it("files a known header under its abbreviation and keeps any other under its own", () => {
    expect(
      cleanStatValues([
        { label: "Kills", value: "245" },
        { label: "Hit %", value: ".301" },
        { label: "Kills/Set", value: "3.4" },
        { label: "Digs per set", value: "2.1" },
        { label: "Serving Att", value: "312" },
      ]),
    ).toEqual([v("K", "245"), v("PCT", ".301"), v("K/S", "3.4"), v("DIG/S", "2.1"), v("Serving Att", "312")]);
  });

  it("keeps values as printed, a number as written, and drops blanks, dashes and junk", () => {
    expect(
      cleanStatValues([
        { label: "K", value: 245 },
        { label: "DIG", value: "1,024" },
        { label: "SA", value: "" },
        { label: "SE", value: "—" },
        { label: "BA", value: "N/A" },
        { label: "", value: "3" },
        { label: "BS", value: { n: 3 } },
        "K 245",
        null,
      ]),
    ).toEqual([v("K", "245"), v("DIG", "1,024")]);
  });

  it("keeps the first value for a stat and no more than the cap", () => {
    expect(cleanStatValues([v("K", "245"), v("Kills", "999")])).toEqual([v("K", "245")]);
    const many = Array.from({ length: MAX_STAT_VALUES + 5 }, (_, n) => v(`Col ${n}`, String(n)));
    expect(cleanStatValues(many)).toHaveLength(MAX_STAT_VALUES);
  });

  it("knows every key it lists", () => {
    for (const key of VOLLEYBALL_STAT_KEYS) expect(volleyballStatKey(key)).toBe(key);
  });
});

describe("hitting percentage", () => {
  it("is (K - E) / TA, written the volleyball way, when the sheet gives all three", () => {
    expect(hittingPct([v("K", "245"), v("E", "66"), v("TA", "560")])).toBe(".320");
    expect(hittingPct([v("K", "10"), v("E", "15"), v("TA", "100")])).toBe("-.050");
  });

  it("is never worked out from less, from no attacks, or over one the sheet printed", () => {
    expect(hittingPct([v("K", "245"), v("TA", "560")])).toBeNull();
    expect(hittingPct([v("K", "0"), v("E", "0"), v("TA", "0")])).toBeNull();
    expect(hittingPct([v("K", "245"), v("E", "66"), v("TA", "560"), v("PCT", ".298")])).toBeNull();
  });
});

describe("what the card says", () => {
  it("leads an outside hitter with kills, hitting %, kills per set, aces and digs", () => {
    expect(items(HITTER, "OH")).toBe(
      "245 kills · .320 hit% · 3.4 kills/set · 31 aces · 180 digs · 66 att err · 560 attacks · 22 serve err · 300 pts",
    );
    // Two groups, so the card gives the priority stats their own column.
    expect(volleyballLine(HITTER, "OH").map((item) => item.group)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("follows each position's priority", () => {
    const all = [v("K", "50"), v("PCT", ".250"), v("K/S", "1.1"), v("A", "640"), v("A/S", "9.8"), v("SA", "20"), v("DIG", "90"), v("BLK", "30"), v("BLK/S", "0.7"), v("DIG/S", "1.4"), v("R%", "88%")];
    for (const [position, lead] of Object.entries(POSITION_PRIORITY)) {
      const line = volleyballLine(all, position);
      expect(line.filter((item) => item.group === 0).length, position).toBe(lead.length);
    }
    expect(items(all, "S").startsWith("640 assists · 9.8 ast/set · 20 aces · 90 digs · 30 blocks")).toBe(true);
    expect(items(all, "Middle").startsWith("50 kills · .250 hit% · 30 blocks · 0.7 blk/set")).toBe(true);
  });

  it("gives a libero a short, deliberate card: no zeros, no attacking", () => {
    expect(items(LIBERO, "Libero")).toBe("310 digs · 4.6 digs/set · 93.5% rec · 14 aces · 25 assists · 9 serve err · 280 rec · 12 rec err");
    expect(items(LIBERO, "L")).not.toContain("kills");
  });

  it("with no position, leads with the biggest counts", () => {
    expect(items([v("SA", "20"), v("DIG", "60"), v("K", "95"), v("PTS", "120"), v("SP", "40")], null)).toBe("120 pts · 95 kills · 60 digs · 20 aces · 40 sets");
  });

  it("shows nothing it does not know, and nothing for a player with no stats", () => {
    expect(items([v("Kill %", "43.8"), v("BHE", "3")], "OH")).toBe("");
    expect(volleyballLine([], "OH")).toEqual([]);
  });
});

const source = (extra: Partial<CardSource> = {}): CardSource => ({
  jersey: "4",
  first_name: "Tess",
  last_name: "Varga",
  position: "Outside Hitter",
  grade: "Sr.",
  height: null,
  weight: null,
  pronunciations: [],
  season_stats: null,
  season_lines: [],
  stats_as_of: "2026-10-20",
  ...extra,
});

describe("a volleyball card", () => {
  it("shows the position as OH and the season as items", () => {
    const card = toCardPlayer(source({ season_values: HITTER }), "volleyball", "H");
    expect(card.face?.position).toBe("OH");
    expect(card.position).toBe("Outside Hitter");
    expect(card.face?.season.slice(0, 2)).toEqual([
      { value: "245", label: "kills", estimated: false, group: 0 },
      { value: ".320", label: "hit%", estimated: false, group: 0 },
    ]);
    expect(card.face?.seasonText).toBe("");
    expect(card.stat_lines).toEqual([items(HITTER, "OH")]);
  });

  it("still gets a card with a name, a number and no stats", () => {
    const card = toCardPlayer(source({ position: "DS", season_values: null }), "volleyball", "A");
    expect(card.face).toMatchObject({ jersey: "4", position: "DS", plain: "Varga", season: [], seasonText: "" });
    expect(card.stat_lines).toEqual([]);
  });

  it("keeps the written lines of a team saved before values existed", () => {
    const card = toCardPlayer(source({ season_lines: ["245 kills, 31 aces"] }), "volleyball", "H");
    expect(card.face?.seasonText).toBe("245 kills, 31 aces");
    expect(card.face?.season).toEqual([]);
  });

  it("leaves football's card exactly as it was", () => {
    const football = toCardPlayer(
      source({ position: "RB", season_stats: { rush_att: 64, rush_yds: 420 }, season_values: HITTER }),
      "football",
      "H",
    );
    expect(football.face?.position).toBe("RB");
    expect(lineText(football.face!.season)).toBe("64 car · 420 yds");
  });
});

// -----------------------------------------------------------------------------
// The game: built from two volleyball rosters, heard through the real engine.
// -----------------------------------------------------------------------------

const HOME = { id: "home", school: "Lakeview", mascot: "Lions", sport: "volleyball" };
const AWAY = { id: "away", school: "Harbor", mascot: "Gulls", sport: "volleyball" };

const row = (roster_id: string, jersey: string, first_name: string, last_name: string, extra: Partial<GamePlayerRow> = {}): GamePlayerRow => ({
  roster_id,
  jersey,
  first_name,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spoken_forms: spokenForms(last_name),
  spot_mode: "normal",
  season_stats: null,
  season_lines: [],
  stats_as_of: "2026-10-20",
  ...extra,
});

const ROWS = [
  row("home", "4", "Tess", "Varga", { position: "Outside Hitter", season_values: HITTER }),
  row("home", "2", "Maya", "Okafor", { position: "Setter", season_values: [v("A", "640"), v("A/S", "9.8")] }),
  row("home", "13", "Jada", "Okafor", { position: "OH", season_values: [v("K", "120"), v("SA", "11")] }),
  row("home", "7", "Lena", "Brandt", { position: "Libero", season_values: LIBERO }),
  row("home", "15", "Kira", "Hollis", { position: "RS", season_values: [v("K", "88")] }),
  row("home", "9", "Rosa", "Quint", { position: "DS", stats_as_of: null }),
  row("away", "3", "Ava", "Delmar", { position: "OH", season_values: [v("K", "201")] }),
  row("away", "10", "June", "Sorell", { position: "L", season_values: [v("DIG", "250")] }),
];

const assembled = assembleGame(HOME, AWAY, ROWS);
const cardOf = (last: string, jersey: string) =>
  assembled.watchlist.entries.flatMap((entry) => entry.players).find((player) => player?.last_name === last && player.jersey === jersey)!;

describe("a volleyball game", () => {
  it("is a volleyball game, with every player's card built from their values", () => {
    expect(assembled.sport).toBe("volleyball");
    expect(cardOf("Varga", "4").face?.position).toBe("OH");
    expect(cardOf("Brandt", "7").face?.season[0]).toMatchObject({ value: "310", label: "digs" });
    expect(cardOf("Quint", "9").face).toMatchObject({ position: "DS", season: [] });
    expect(cardOf("Varga", "4").hasStats).toBe(true);
    expect(cardOf("Quint", "9").hasStats).toBeUndefined();
  });

  it("never has live stats, even when asked", () => {
    const snapshot = buildSnapshot({ ...assembled, keyterm: { kind: "ok" } }, {
      wearing: { home: null, away: null },
      keytermBoost: true,
      gameId: "00000000-0000-4000-8000-000000000001",
      recorded: true,
      statsEnabled: true,
    });
    expect(snapshot.sport).toBe("volleyball");
    expect(snapshot.statsEnabled).toBe(false);
  });
});

function result(transcript: string): DeepgramResults {
  const words = transcript.split(" ").map((word, index) => ({ word, start: index * 0.3, end: index * 0.3 + 0.25, confidence: 0.98 }));
  return {
    type: "Results",
    is_final: true,
    speech_final: true,
    start: 0,
    duration: words.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.98, words }] },
  };
}

describe("hearing a volleyball game", () => {
  const teamCues = buildTeamCues(
    { school: HOME.school, mascot: HOME.mascot, wearing: null },
    { school: AWAY.school, mascot: AWAY.mascot, wearing: null },
  );
  const say = (transcript: string) =>
    new SpotterEngine(assembled.watchlist.entries, { sport: "volleyball", teamCues })
      .process(result(transcript), 1, 0, 0)
      .display?.players.map((card) => `${card.last_name} #${card.jersey}`) ?? [];

  it("puts a card up on a surname", () => {
    expect(say("kill by varga")).toEqual(["Varga #4"]);
    expect(say("great dig from brandt")).toEqual(["Brandt #7"]);
  });

  it("shows two players with one surname together", () => {
    expect(say("okafor with the block").sort()).toEqual(["Okafor #13", "Okafor #2"]);
  });

  it("narrows a shared surname by number or first name", () => {
    expect(say("okafor number 13")).toEqual(["Okafor #13"]);
    expect(say("maya okafor sets it up")).toEqual(["Okafor #2"]);
  });

  it("puts a number up only with a cue beside it", () => {
    expect(say("number 15 on the serve")).toEqual(["Hollis #15"]);
    expect(say("15")).toEqual([]);
  });

  it("keeps scores, set numbers and serving scores off the screen", () => {
    expect(say("its 17 to 15")).toEqual([]);
    expect(say("lakeview leads 15")).toEqual([]);
    expect(say("set 2 coming up")).toEqual([]);
    expect(say("serving at 15")).toEqual([]);
    expect(say("she has 15 kills")).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The roster editor and what it saves.
// -----------------------------------------------------------------------------

const imported = (extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey: "4",
  first_name: "Tess",
  last_name: "Varga",
  position: "OH",
  grade: "Sr.",
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

describe("importing a volleyball roster in the editor", () => {
  it("puts the stats that came with a player on the row, dated, and saves them", () => {
    const [row] = replaceWithImport([], [imported({ season_values: HITTER })], "volleyball", "2026-10-21");
    expect(row.player).not.toHaveProperty("season_values");
    expect(row.season).toEqual({ season_stats: null, season_lines: [], season_values: cleanStatValues(HITTER), stats_as_of: "2026-10-21" });
    const args = toSaveArgs({ ...EMPTY_TEAM, school: "Lakeview", sport: "volleyball" }, [row], null);
    expect(args.p_players[0]).toMatchObject({ season_values: cleanStatValues(HITTER), stats_as_of: "2026-10-21" });
    expect(isSaveRosterBody(args)).toBe(true);
  });

  it("gives a player with no stats a row with none", () => {
    const [row] = replaceWithImport([], [imported({ position: "DS" })], "volleyball", "2026-10-21");
    expect(row.season).toBeNull();
  });

  it("sends a football save exactly as before: no values key at all", () => {
    const [row] = replaceWithImport([], [imported({ position: "RB" })], "football", "2026-10-21");
    expect(row.season).toBeNull();
    const kept = savedRow(imported({ position: "RB" }), { season_stats: { rush_att: 64 }, season_lines: [], stats_as_of: "2026-10-01" });
    const args = toSaveArgs({ ...EMPTY_TEAM, school: "Lakeview", sport: "football" }, [row, kept], null);
    for (const player of args.p_players) expect(player).not.toHaveProperty("season_values");
  });

  it("refuses values that are not labelled text", () => {
    const body = (season_values: unknown) => ({ p_roster: { school: "Lakeview", sport: "volleyball" }, p_players: [{ last_name: "Varga", season_values }] });
    expect(isSaveRosterBody(body([{ label: "K", value: "245" }, { label: "PTS", value: 300 }]))).toBe(true);
    expect(isSaveRosterBody(body([{ label: "K", value: { n: 245 } }]))).toBe(false);
    expect(isSaveRosterBody(body([{ label: "x".repeat(40), value: "1" }]))).toBe(false);
    expect(isSaveRosterBody(body("K 245"))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The Season stats page, for a volleyball team.
// -----------------------------------------------------------------------------

describe("a volleyball stats import", () => {
  it("is read as labelled values", () => {
    expect(statsKindFor("volleyball")).toBe("values");
    expect(statsKindFor("football")).toBe("numbers");
    expect(statsKindFor("basketball")).toBe("lines");
  });

  it("keeps each player's values and skips a player with none", () => {
    const read = normalizeValues({
      players: [
        { jersey: "4", last_name: "Varga", stats: [{ label: "Kills", value: "245" }, { label: "Serving Att", value: "312" }] },
        { jersey: "9", last_name: "Quint", stats: [{ label: "K", value: "" }] },
      ],
      warnings: ["#30 J. Nobody is not on the roster."],
    });
    expect(read.blocks).toEqual([{ jersey: "4", last_name: "Varga", values: [v("K", "245"), v("Serving Att", "312")] }]);
    expect(read.warnings).toEqual(["#30 J. Nobody is not on the roster."]);
  });

  it("reviews, edits and saves them through set_season_stats", () => {
    const review = buildStatsReview({
      kind: "values",
      blocks: [{ jersey: "4", last_name: "Varga", values: [v("K", "245"), v("Serving Att", "312")] }],
      warnings: [],
      roster: [
        { id: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10", jersey: "4", last_name: "Varga", position: "OH" },
        { id: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b11", jersey: "9", last_name: "Quint", position: "DS" },
      ],
      format: "pdf",
      route: "vision",
      pages: 1,
    });
    expect(review.rows[0].values).toEqual([v("K", "245"), v("Serving Att", "312")]);
    expect(review.silent).toBe(1);
    expect(valueColumnsIn(review.rows, VOLLEYBALL_STAT_KEYS)).toEqual(["K", "Serving Att"]);

    const edited = { ...review.rows[0], values: withValue(withValue(review.rows[0].values!, "K", "246"), "SA", "31") };
    expect(edited.values).toEqual([v("K", "246"), v("Serving Att", "312"), v("SA", "31")]);
    expect(withValue(edited.values, "Serving Att", " ")).toEqual([v("K", "246"), v("SA", "31")]);

    const args = toSetSeasonStatsArgs("8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b12", "values", [edited], "2026-10-21");
    expect(args.p_stats).toEqual({
      as_of: "2026-10-21",
      players: [{ id: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10", stats: null, lines: [], values: edited.values }],
    });
    expect(isSeasonStatsBody(args.p_stats)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Game setup: the sport picker.
// -----------------------------------------------------------------------------

const team = (id: string, sport: string): TeamSummary => ({
  id,
  school: id,
  mascot: null,
  sport,
  gender: null,
  level: null,
  season: null,
  updated_at: "",
  playerCount: 12,
  statsAsOf: null,
});

describe("picking the sport at setup", () => {
  const teams = [team("a", "football"), team("b", "volleyball"), team("c", "basketball"), team("d", "volleyball")];

  it("offers volleyball's teams for volleyball, and every other team for football, as before", () => {
    expect(teamsFor(teams, "volleyball").map((t) => t.id)).toEqual(["b", "d"]);
    expect(teamsFor(teams, "football").map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("opens on football unless the URL or a picked team says volleyball", () => {
    expect(openingSport(teams, { away: null, home: null }, null)).toBe("football");
    expect(openingSport(teams, { away: "a", home: null }, null)).toBe("football");
    expect(openingSport(teams, { away: null, home: "d" }, null)).toBe("volleyball");
    expect(openingSport(teams, { away: null, home: null }, "volleyball")).toBe("volleyball");
  });

  it("carries volleyball through Add a team and back, and leaves football's URLs as they were", () => {
    const back = { side: "home" as const, away: null, home: null, sport: "volleyball" as const };
    expect(stepHref("/teams/new", back)).toBe("/teams/new?for=game&side=home&sport=volleyball");
    expect(readSetupReturn({ for: "game", side: "home", sport: "volleyball" })).toEqual(back);
    expect(setupHref(back, "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10")).toBe("/games/new?home=8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10&sport=volleyball");
    expect(stepHref("/teams/new", { side: "home", away: null, home: null, sport: "football" })).toBe("/teams/new?for=game&side=home");
    expect(readSetupSport({ sport: "curling" })).toBeNull();
  });

  it("shows a volleyball game's setup with the sport picked and nothing about live stats", () => {
    const html = renderToStaticMarkup(
      createElement(Summary, {
        loaded: { ...assembled, keyterm: { kind: "ok" } },
        wearing: { home: "", away: "" },
        onWearing: () => undefined,
        starting: false,
        onStart: () => undefined,
      }),
    );
    expect(html).toMatch(/<option value="volleyball" selected="">Volleyball<\/option>/);
    expect(html).not.toMatch(/live stats|Check each play|Out tonight/i);
    expect(html).not.toContain("TONIGHT");
  });
});
