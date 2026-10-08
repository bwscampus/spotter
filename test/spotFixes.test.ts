import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { NamesTables } from "@/components/game/NamesTables";
import { assembleGame, type GamePlayerRow, type LoadedGame } from "@/lib/game/buildGame";
import { buildTeamCues } from "@/lib/game/teamCues";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { DETERMINER_VETO, DETERMINERS } from "@/lib/matching/determiners";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { SpotMode } from "@/lib/rosters/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

// =============================================================================
// The name-spotting fixes from the Sept 25 game (docs/V3_DEFINITION.md 7.3),
// driven through the real engine with the real matcher. Every phrase below is a
// transcript from that game's near misses and wrong cards.
//
// Estancia is away, Brentwood home. Wright wears 0, Vargas 21 and Bargas 8, all
// Estancia, as they did.
// =============================================================================

const player = (jersey: string, last_name: string, spot_mode?: SpotMode, pronunciations: string[] = []): GamePlayer => ({
  jersey,
  last_name,
  spoken_forms: spokenForms(last_name, pronunciations),
  ...(spot_mode ? { spot_mode } : {}),
});

/** The roster, with the four common-phrase names exact-only or not. */
function game(exact: boolean, pronunciations: Record<string, string[]> = {}) {
  const mode = exact ? "exact_only" : undefined;
  const { entries } = buildGameWatchlist(
    [player("22", "Langan"), player("3", "Ramos")],
    [
      player("0", "Wright"),
      player("21", "Vargas"),
      player("8", "Bargas"),
      player("5", "Longhi", mode, pronunciations.Longhi),
      player("44", "Aragon", mode),
      player("2", "Piesik", mode, pronunciations.Piesik),
    ],
  );
  const teamCues = buildTeamCues(
    { school: "Brentwood", mascot: "Eagles", wearing: null },
    { school: "Estancia", mascot: "Matadors", wearing: null },
  );
  return () => new SpotterEngine(entries, { sport: "football", teamCues });
}

function result(transcript: string, isFinal = true): DeepgramResults {
  const words = transcript.split(" ").map((word, index) => ({
    word,
    start: index * 0.3,
    end: index * 0.3 + 0.25,
    confidence: 0.98,
  }));
  return {
    type: "Results",
    is_final: isFinal,
    speech_final: isFinal,
    start: 0,
    duration: words.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.98, words }] },
  };
}

/** What one utterance puts on screen, by surname and jersey, and the rows it logs. */
function say(makeEngine: () => SpotterEngine, transcript: string, isFinal = true) {
  const outcome = makeEngine().process(result(transcript, isFinal), 1, 0, 0);
  return {
    cards: outcome.display?.players.map((card) => `${card.last_name} #${card.jersey}`) ?? [],
    rows: outcome.rows,
    nearMisses: outcome.rows.filter((row) => row.type === "near_miss").map((row) => [row.name, row.reason ?? null]),
  };
}

describe("single digits need a cue (Sept 25: Estancia 0)", () => {
  const engine = game(false);

  it("estancia 0 does not fire Wright #0, and is logged with its reason", () => {
    const heard = say(engine, "estancia 0");
    expect(heard.cards).toEqual([]);
    expect(heard.nearMisses).toEqual([["0", "single_digit_team_cue"]]);
    // The row carries the team word that cued it, which is what says why it was turned away.
    expect(heard.rows[0]).toMatchObject({ type: "near_miss", cueWord: "estancia", reason: "single_digit_team_cue" });
  });

  it("number 0 fires Wright #0", () => {
    expect(say(engine, "number 0").cards).toEqual(["Wright #0"]);
  });

  it("wright 0 fires Wright #0: the surname is right beside it", () => {
    expect(say(engine, "wright 0").cards).toEqual(["Wright #0"]);
  });

  it("estancia number 0 fires Wright #0: an explicit cue beats the team", () => {
    expect(say(engine, "estancia number 0").cards).toEqual(["Wright #0"]);
  });

  it("estancia 21 still fires Vargas #21 with a team cue", () => {
    expect(say(engine, "estancia 21").cards).toEqual(["Vargas #21"]);
  });

  it("the rule holds for every single digit on a team cue, at any point in an interim", () => {
    expect(say(engine, "estancia 5", false).cards).toEqual([]);
    expect(say(engine, "brentwood 2 on the play").cards).toEqual([]);
  });

  it("a blocked single digit is only logged from a final, like every other near miss", () => {
    expect(say(engine, "estancia 0", false).rows).toEqual([]);
  });
});

describe("exact-only (Sept 25: long, are gonna, oregon, be sick)", () => {
  // Each of these fires its player when the player is spotted normally, which is
  // what made them wrong cards. Asserted first, or the exact-only half proves nothing.
  const cases: Array<[phrase: string, player: string, jersey: string]> = [
    ["long", "Longhi", "5"],
    ["he went long on that one", "Longhi", "5"],
    ["are gonna", "Aragon", "44"],
    ["oregon", "Aragon", "44"],
    // "be sick" scores 0.8 against Piesik, under the 0.85 line, so it only
    // comes close on its own (reviewPlayers.test.ts holds that). These two are
    // the Piesik near sounds that do clear the line.
    ["pee sick", "Piesik", "2"],
    ["be sik", "Piesik", "2"],
  ];

  for (const [phrase, name, jersey] of cases) {
    it(`"${phrase}" fires ${name} when spotted normally, and not when exact-only`, () => {
      expect(say(game(false), phrase).cards).toEqual([`${name} #${jersey}`]);
      const exact = say(game(true), phrase);
      expect(exact.cards).toEqual([]);
      expect(exact.nearMisses).toContainEqual([name, "exact_only"]);
    });
  }

  it("a near sound in the middle of a call fires Piesik normally, and not when exact-only", () => {
    // "be sick" itself never fired (it scores under the line either way), so it
    // proved nothing about exact-only (audit L7). This one does fire first.
    const phrase = "tackle by pie sick";
    expect(say(game(false), phrase).cards).toEqual(["Piesik #2"]);
    const exact = say(game(true), phrase);
    expect(exact.cards).toEqual([]);
    expect(exact.nearMisses).toContainEqual(["Piesik", "exact_only"]);
  });

  it("longhi, said properly, fires Longhi when exact-only", () => {
    expect(say(game(true), "longhi").cards).toEqual(["Longhi #5"]);
    expect(say(game(true), "longhi").rows[0]).toMatchObject({ type: "match", score: 1 });
  });

  it("piesik, said properly, fires Piesik when exact-only", () => {
    expect(say(game(true), "piesik").cards).toEqual(["Piesik #2"]);
  });

  it("a pronunciation note is an exact form, so it still fires an exact-only player", () => {
    const heard = say(game(true, { Piesik: ["pee-sick"] }), "pee sick");
    expect(heard.cards).toEqual(["Piesik #2"]);
    expect(heard.rows[0]).toMatchObject({ type: "match", score: 1 });
  });

  it("logs the drop with the score and threshold it missed, so the setting can be judged on the log", () => {
    const [drop] = say(game(true), "long").rows;
    expect(drop).toMatchObject({ type: "near_miss", name: "Longhi", reason: "exact_only", threshold: 0.85 });
    expect(drop.score).toBeGreaterThanOrEqual(0.85);
    expect(drop.score).toBeLessThan(1);
  });

  it("logs a drop from a final only, and puts nothing on screen from an interim either", () => {
    const interim = say(game(true), "long", false);
    expect(interim.cards).toEqual([]);
    expect(interim.rows).toEqual([]);
  });

  it("leaves everyone else alone: a normal player's near sound still fires", () => {
    // Exact-only is per player. Bargas, said as Vargas is, still answers as before.
    expect(say(game(true), "vargas").cards).toEqual(["Vargas #21"]);
    expect(say(game(true), "langan").cards).toEqual(["Langan #22"]);
  });

  it("does not block a number: exact-only is about how the surname sounds", () => {
    expect(say(game(true), "number 5").cards).toEqual(["Longhi #5"]);
    expect(say(game(true), "estancia 44").cards).toEqual(["Aragon #44"]);
  });

  it("a dropped near sound is not a cue for the number beside it", () => {
    // "long 5" would have been Longhi with a surname cue. With the near sound
    // dropped there is no surname and no cue, so the 5 is just a number.
    const heard = say(game(true), "long 5");
    expect(heard.cards).toEqual([]);
    expect(heard.nearMisses).toEqual([
      ["Longhi", "exact_only"],
      ["5", "no_cue"],
    ]);
    // Said properly, the surname is a cue again.
    expect(say(game(true), "longhi 5").cards).toEqual(["Longhi #5"]);
  });
});

describe("the setup warnings show", () => {
  // The whole path an announcer takes: saved rows in, what the setup screen says out.
  const row = (roster_id: string, jersey: string, last_name: string): GamePlayerRow => ({
    roster_id,
    jersey,
    first_name: null,
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
    stats_as_of: null,
  });
  const HOME = { id: "home", school: "Brentwood", mascot: "Eagles", sport: "football" };
  const AWAY = { id: "away", school: "Estancia", mascot: "Matadors", sport: "football" };
  const assembled = assembleGame(HOME, AWAY, [
    row("home", "22", "Langan"),
    row("away", "8", "Bargas"),
    row("away", "21", "Vargas"),
    row("away", "6", "Estanza"),
  ]);
  const loaded: LoadedGame = { ...assembled, keyterm: { kind: "ok" } };
  const html = renderToStaticMarkup(
    createElement(Summary, {
      loaded,
      wearing: { home: "", away: "" },
      onWearing: () => undefined,
      starting: false,
      onStart: () => undefined,
    }),
  );

  // The lists moved to setup's Names page (docs/UI_STYLE.md, A7), built from the same assembled game.
  const names = renderToStaticMarkup(createElement(NamesTables, { game: assembled }));

  it("warns about a name that sounds like a school, naming the phrase", () => {
    // Setup says so in a warning row, with the way to the names.
    expect(html).toMatch(/1 name sounds like a team, 1 of them enough to go up when a team is named/);
    expect(html).toMatch(/href="\/games\/new\/names\?away=away&amp;home=home">See names</);
    // The Names page names it, and the phrase it goes up on.
    expect(names).toContain("Names that sound like a team");
    expect(names).toMatch(/>Estanza<\/td><td[^>]*>&quot;estancia&quot;<\/td><td[^>]*>Goes up</i);
  });

  it("pairs Bargas and Vargas, the look-alikes that were both Estancia, and says what to do", () => {
    expect(assembled.collisions.map((pair) => [pair.a, pair.b].sort().join("/"))).toContain("Bargas/Vargas");
    // Setup counts the pairs beside the link; the Names page lists them.
    expect(html).toMatch(/[1-9]\d* pairs? sounds? alike/);
    expect(html).not.toContain("Names that sound alike");
    expect(names).toContain("Names that sound alike");
    expect(names).toContain("Bargas and Vargas");
    expect(names).toMatch(/pronunciation note, or exact-only spotting/);
  });
});

describe("a surname right after a determiner is not a name (Oct 6)", () => {
  const engine = game(false);

  it('"the <surname>" puts up no card, and is logged as its own veto', () => {
    const said = say(engine, "and the langan just bounces off");
    expect(said.cards).toEqual([]);
    expect(said.nearMisses).toContainEqual(["Langan", DETERMINER_VETO]);
  });

  it.each([...DETERMINERS])('"%s <surname>" puts up no card', (word) => {
    expect(say(engine, `${word} ramos`).cards).toEqual([]);
  });

  it('"<first> <surname>", "by <surname>" and "<surname>" alone still do', () => {
    expect(say(engine, "sam langan up the middle").cards).toEqual(["Langan #22"]);
    expect(say(engine, "brought down by langan").cards).toEqual(["Langan #22"]);
    expect(say(engine, "langan").cards).toEqual(["Langan #22"]);
  });

  it("a jersey cue is unaffected", () => {
    expect(say(engine, "the number 22").cards).toEqual(["Langan #22"]);
    expect(say(engine, "the jersey 21").cards).toEqual(["Vargas #21"]);
  });

  it("is logged only from a final, like every other near miss", () => {
    const interim = say(engine, "the langan", false);
    expect(interim.cards).toEqual([]);
    expect(interim.rows).toEqual([]);
  });
});
