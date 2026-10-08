import { describe, expect, it } from "vitest";
import { keyedRoster } from "@/lib/cards/playerKey";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { parseSnapshot } from "@/lib/game/snapshot";
import { checkPlay } from "@/lib/livestats/check";
import { MAX_ALIASES, readRequest } from "@/lib/livestats/request";
import { rostersForPrompt } from "@/lib/livestats/roster";
import type { StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { EMPTY_TEAM, freshRow, replaceWithImport, savedRow, setHeardAs, toSaveArgs } from "@/lib/rosters/editor";
import { checkHeardAs, MAX_HEARD_AS_FORMS, reviewHeardAs, withHeardAs } from "@/lib/rosters/heardAs";
import { reviewRoster } from "@/lib/rosters/reviewPlayers";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { RosterPlayer } from "@/lib/rosters/types";

// =============================================================================
// "Heard as" forms (Part 5, Oct 4): the words Deepgram writes for a surname,
// used three ways: an exact form for the card matcher, an alias the stats
// reader is told about, and the first repair the stats check tries. Made-up
// names only: Vexley is heard as "vecksley", and Reescanto, which Deepgram
// never gets near, as "rios".
// =============================================================================

function result(transcript: string): DeepgramResults {
  const words = transcript.split(" ").map((word, index) => ({ word, start: index * 0.3, end: index * 0.3 + 0.25, confidence: 0.98 }));
  return { type: "Results", is_final: true, speech_final: true, start: 0, duration: words.length * 0.3, channel: { alternatives: [{ transcript, confidence: 0.98, words }] } };
}

const player = (jersey: string, first_name: string, last_name: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  jersey,
  first_name,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...extra,
});

const TEAM = { ...EMPTY_TEAM, school: "Harborview", sport: "football" as const };

const rosterPlayer = (jersey: string | null, first_name: string | null, last_name: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey,
  first_name,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

describe("spoken forms with heard-as words", () => {
  it("adds each heard-as word as a normalized form after the pronunciations, without repeats", () => {
    expect(spokenForms("Vexley", ["vex-lee"], ["Vecksley", "vecksley", "vexley", ""])).toEqual(["vexley", "vexlee", "vecksley"]);
    expect(spokenForms("Vexley")).toEqual(["vexley"]);
  });
});

describe("a heard-as form in a game", () => {
  it.each(["normal", "exact_only"] as const)("fires the card at 1.0 on the word Deepgram writes, with spotting %s", (spot_mode) => {
    const home = [player("22", "Ked", "Reescanto", { spoken_forms: spokenForms("Reescanto", [], ["rios"]), spot_mode }), player("81", "Cal", "Pruett")];
    const { entries } = buildGameWatchlist(home, [player("5", "Marek", "Quillon")]);
    const reescanto = entries.find((entry) => entry.name === "Reescanto")!;
    expect(reescanto.aliases).toContain("rios");

    const engine = new SpotterEngine(entries, { sport: "football", teamCues: [] });
    const outcome = engine.process(result("rios up the middle for three"), 1, 0, 0);
    expect(outcome.display?.players.map((card) => card.last_name)).toEqual(["Reescanto"]);
    expect(outcome.rows.find((row) => row.type === "match")!.score).toBe(1);
  });

  it("does not fire without the form, which is the whole problem", () => {
    const { entries } = buildGameWatchlist([player("22", "Ked", "Reescanto"), player("81", "Cal", "Pruett")], [player("5", "Marek", "Quillon")]);
    const engine = new SpotterEngine(entries, { sport: "football", teamCues: [] });
    const outcome = engine.process(result("rios up the middle for three"), 1, 0, 0);
    expect(outcome.display?.players.map((card) => card.last_name) ?? []).not.toContain("Reescanto");
  });
});

describe("checkHeardAs", () => {
  const vexley = rosterPlayer("7", "Noah", "Vexley");
  const team = [rosterPlayer("81", "Tobin", "Pruett"), rosterPlayer("22", "Reed", "Fennimore", { heard_as: ["fenimoor"] }), rosterPlayer("3", "Kit", "Boothby", { pronunciations: ["booth-bee"] })];

  it("accepts a word that is nobody's name and not an everyday word", () => {
    expect(checkHeardAs(" vecksley ", vexley, team)).toEqual({ ok: true, form: "vecksley" });
  });

  it("refuses another player's surname, pronunciation or heard-as form, and says whose", () => {
    expect(checkHeardAs("pruett", vexley, team)).toEqual({ ok: false, reason: `"pruett" is Tobin Pruett's surname, so it stays theirs.` });
    expect(checkHeardAs("Booth-bee", vexley, team)).toMatchObject({ ok: false, reason: expect.stringContaining("Kit Boothby's surname") });
    expect(checkHeardAs("fenimoor", vexley, team)).toMatchObject({ ok: false, reason: expect.stringContaining("Reed Fennimore's surname") });
  });

  it("refuses another player's first name", () => {
    expect(checkHeardAs("tobin", vexley, team)).toEqual({ ok: false, reason: `"tobin" is Tobin Pruett's first name.` });
  });

  it("refuses an everyday word, naming it", () => {
    const check = checkHeardAs("early", vexley, team);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain(`sounds like "early"`);
  });

  it("refuses the player's own spelling, a blank, and a sentence", () => {
    expect(checkHeardAs("Vexley", vexley, team)).toMatchObject({ ok: false, reason: expect.stringContaining("already how Vexley is listened for") });
    expect(checkHeardAs("   ", vexley, team)).toMatchObject({ ok: false });
    expect(checkHeardAs("12 34", vexley, team)).toMatchObject({ ok: false, reason: "A heard-as form needs letters." });
    expect(checkHeardAs("x".repeat(41), vexley, team)).toMatchObject({ ok: false, reason: expect.stringContaining("under 40") });
  });

  it("reviews a player's typed list: repeats fold, rejections carry their reason, and the list is capped", () => {
    const extra = Array.from({ length: MAX_HEARD_AS_FORMS }, (_, i) => `vexlee${"a".repeat(i + 1)}`);
    const typed = ["Vecksley", "vecksley", "pruett", ...extra];
    const review = reviewHeardAs({ ...vexley, heard_as: typed }, team);
    expect(review.accepted).toHaveLength(MAX_HEARD_AS_FORMS);
    expect(review.accepted[0]).toBe("Vecksley");
    expect(review.rejected.map((each) => each.form)).toEqual(["pruett", extra[extra.length - 1]]);
    expect(review.rejected[1].reason).toContain(`At most ${MAX_HEARD_AS_FORMS}`);
  });

  it("adds a form to a list once, keeping the newest when the list is full", () => {
    expect(withHeardAs(["a"], "b")).toEqual(["a", "b"]);
    expect(withHeardAs(["a", "b"], "A")).toEqual(["b", "A"]);
    expect(withHeardAs(Array.from({ length: MAX_HEARD_AS_FORMS }, (_, i) => `f${i}`), "new")).toHaveLength(MAX_HEARD_AS_FORMS);
  });
});

describe("the editor", () => {
  it("sends only the accepted forms of saved rows, in the one save_roster call", () => {
    const rows = [
      setHeardAs(freshRow(rosterPlayer("7", "Noah", "Vexley"), "football"), ["vecksley", "pruett"]),
      freshRow(rosterPlayer("81", "Tobin", "Pruett"), "football"),
      setHeardAs(freshRow(rosterPlayer(null, null, ""), "football"), ["ghost"]),
    ];
    const reviews = reviewRoster(
      rows.map((row) => row.player),
      "football",
    );
    expect(reviews[0].heardAs).toEqual(["vecksley"]);
    expect(reviews[0].heardAsRejected).toEqual([{ form: "pruett", reason: `"pruett" is Tobin Pruett's surname, so it stays theirs.` }]);
    expect(reviews[0].forms).toContain("vecksley");
    const { p_players } = toSaveArgs(TEAM, rows, null, reviews);
    // The blank-surname draft row is not saved; the others always carry the key, so an empty list clears.
    expect(p_players.map((player) => [player.last_name, player.heard_as])).toEqual([
      ["Vexley", ["vecksley"]],
      ["Pruett", []],
    ]);
    // Without the review screen's reviews, the same check runs inside toSaveArgs.
    expect(toSaveArgs(TEAM, rows, null).p_players[0].heard_as).toEqual(["vecksley"]);
  });

  it("keeps a player's heard-as forms through a re-import, like the pronunciations", () => {
    const before = [savedRow(rosterPlayer("7", "Noah", "Vexley", { heard_as: ["vecksley"] }), null)];
    const after = replaceWithImport(before, [rosterPlayer("7", "N.", "Vexley"), rosterPlayer("81", "Tobin", "Pruett")], "football");
    expect(after[0].player.heard_as).toEqual(["vecksley"]);
    expect(after[0].heardAsAtStart).toBe(1);
    expect(after[1].player.heard_as).toBeUndefined();
  });
});

describe("the stats roster", () => {
  it("carries heard-as forms as aliases, blanks dropped, and none when there are none", () => {
    const roster = keyedRoster(
      [
        { jersey: "7", first_name: "Noah", last_name: "Vexley", position: "QB", heard_as: ["vecksley", " ", "vexlee"] },
        { jersey: "81", first_name: "Tobin", last_name: "Pruett", position: "WR", heard_as: [] },
        { jersey: "22", first_name: "Reed", last_name: "Fennimore", position: "RB", heard_as: "nope" },
      ],
      [],
    );
    expect(roster[0].aliases).toEqual(["vecksley", "vexlee"]);
    expect(roster[1].aliases).toBeUndefined();
    expect(roster[2].aliases).toBeUndefined();
  });

  it("is kept by the snapshot when the aliases are strings, and dropped when they are not", () => {
    const card = { jersey: "7", first_name: "Noah", last_name: "Vexley", position: "QB", grade: null, height: null, weight: null, side: "H", stat_lines: [] };
    const snapshot = (aliases: unknown) => ({
      version: 1,
      builtAt: "2026-10-04T00:00:00.000Z",
      gameId: "g1",
      recorded: false,
      home: { id: "h", name: "Northfield", wearing: null },
      away: { id: "a", name: "Westmere", wearing: null },
      watchlist: [{ name: "Vexley", aliases: ["vecksley"], players: [card] }],
      keyterms: [],
      sport: "football",
      teamCues: [],
      statsEnabled: true,
      statsRoster: [{ playerId: "H7-VEXLEY", side: "home", jersey: "7", first: "Noah", last: "Vexley", position: "QB", aliases }],
    });
    expect(parseSnapshot(JSON.stringify(snapshot(["vecksley"])))?.statsRoster?.[0].aliases).toEqual(["vecksley"]);
    expect(parseSnapshot(JSON.stringify(snapshot("vecksley")))?.statsRoster).toBeUndefined();
  });

  it("reaches the route, at most four short forms per player", () => {
    const body = {
      utterances: [{ seq: 1, text: "vecksley to pruett", offsetMs: 0 }],
      rosters: [
        { playerId: "H7-VEXLEY", side: "home", jersey: "7", first: "Noah", last: "Vexley", position: "QB", aliases: ["vecksley", "", 4, ...Array.from({ length: 10 }, (_, i) => `v${i}`)] },
        { playerId: "H81-PRUETT", side: "home", jersey: "81", first: "Tobin", last: "Pruett", position: "WR" },
      ],
      recentPlays: [],
    };
    const request = readRequest(body);
    expect(request).not.toBeNull();
    if (!request || request === "too_long") return;
    expect(request.rosters[0].aliases).toHaveLength(MAX_ALIASES);
    expect(request.rosters[0].aliases?.slice(0, 2)).toEqual(["vecksley", "v0"]);
    expect(request.rosters[1].aliases).toBeUndefined();
  });

  it("is printed for the reader with the forms in brackets", () => {
    const text = rostersForPrompt([
      { playerId: "H7-VEXLEY", side: "home", jersey: "7", first: "Noah", last: "Vexley", position: "QB", aliases: ["vecksley", "vexlee"] },
      { playerId: "H81-PRUETT", side: "home", jersey: "81", first: "Tobin", last: "Pruett", position: "WR" },
    ]);
    expect(text).toContain("H7-VEXLEY Noah QB (heard as vecksley, vexlee)");
    expect(text.split("\n")).toContain("H81-PRUETT Tobin WR");
    expect(text).toContain("heard as");
  });
});

describe("the stats check", () => {
  const roster: StatsRosterPlayer[] = [
    { playerId: "H7-VEXLEY", side: "home", jersey: "7", first: "Noah", last: "Vexley", position: "QB", aliases: ["vecksley"] },
    { playerId: "H12-BRINDLE", side: "home", jersey: "12", first: "Ash", last: "Brindle", position: "QB" },
    { playerId: "H81-PRUETT", side: "home", jersey: "81", first: "Tobin", last: "Pruett", position: "WR" },
    { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  ];
  const pass = (passerId: string): StatsPlay => ({
    seqStart: 10,
    seqEnd: 11,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.8,
    summary: "VECKSLEY pass to PRUETT",
    evidence: "vecksley finds pruett for eight",
    events: [
      { playerId: passerId, action: "pass_complete", yards: 8, yardsSource: "stated", made: null },
      { playerId: "H81-PRUETT", action: "reception", yards: 8, yardsSource: "stated", made: null },
    ],
  });

  it("a heard-as form in the words names the player, so the credit stays where the reader put it", () => {
    const checked = checkPlay(pass("H7-VEXLEY"), roster, { qbs: { home: "H12-BRINDLE", away: null } });
    expect(checked.notes).toEqual([]);
    expect(checked.play.events.map((event) => `${event.playerId} ${event.action}`)).toEqual(["H7-VEXLEY pass_complete", "H81-PRUETT reception"]);
  });

  it("without the form, the words do not name him and the pass goes to the quarterback on the field", () => {
    const plain = roster.map((each) => (each.aliases ? { ...each, aliases: undefined } : each));
    const checked = checkPlay(pass("H7-VEXLEY"), plain, { qbs: { home: "H12-BRINDLE", away: null } });
    expect(checked.play.events[0].playerId).toBe("H12-BRINDLE");
    expect(checked.notes.map((note) => note.rule)).toEqual(["R14"]);
  });
});
