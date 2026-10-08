import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { assembleGame, buildSnapshot, type GamePlayerRow, type GameRosterRow } from "@/lib/game/buildGame";
import { sideLooks } from "@/lib/game/colors";
import { parseSnapshot } from "@/lib/game/snapshot";
import { EMPTY_TEAM, mergeTeam } from "@/lib/rosters/editor";
import { spokenForms } from "@/lib/rosters/spokenForms";

// Team colours, back from V2 on the testrun branch (Jed, Oct 3): saved with
// the team, read off a PDF's crest on import, carried into the game, and
// drawn as each card's number slab (docs/CARD_SPEC.md). Made-up teams.

const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football", primary_color: "#0B2A5B" };
const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football", primary_color: "#c8102e" };
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
const PLAYERS = [row("home", "22", "Fennimore"), row("away", "17", "Quillon")];
const choices = { wearing: { home: null, away: null }, keytermBoost: false, gameId: "game-1", recorded: true };

const loaded = (home: GameRosterRow = HOME, away: GameRosterRow = AWAY) => ({ ...assembleGame(home, away, PLAYERS), keyterm: { kind: "ok" as const } });

describe("the colours in a game", () => {
  it("go into the game as lowercase hex, one per side", () => {
    const snapshot = buildSnapshot(loaded(), choices);
    expect(snapshot.home.color).toBe("#0b2a5b");
    expect(snapshot.away.color).toBe("#c8102e");
    expect(parseSnapshot(JSON.stringify(snapshot))?.home.color).toBe("#0b2a5b");
  });

  it("are null for a team without one, and a game saved before colours still opens", () => {
    const snapshot = buildSnapshot(loaded({ ...HOME, primary_color: null }), choices);
    expect(snapshot.home.color).toBeNull();
    const before = JSON.parse(JSON.stringify(snapshot));
    delete before.home.color;
    delete before.away.color;
    expect(parseSnapshot(JSON.stringify(before))).not.toBeNull();
  });

  it("refuses a colour that is not one, so it can never reach the screen as a broken style", () => {
    const broken = JSON.parse(JSON.stringify(buildSnapshot(loaded(), choices)));
    broken.home.color = "red; background: url(x)";
    expect(parseSnapshot(JSON.stringify(broken))).toBeNull();
  });

  it("fill each side's number slabs, with the ink that reads on them", () => {
    const snapshot = buildSnapshot(loaded(), choices);
    const looks = sideLooks(
      { color: snapshot.home.color, school: snapshot.home.name },
      { color: snapshot.away.color, school: snapshot.away.name },
    );
    expect(looks.H).toMatchObject({ background: "#0b2a5b", ink: "#FFFFFF", code: "" });
    expect(looks.A).toMatchObject({ background: "#c8102e", ink: "#FFFFFF", code: "MIL" });
  });

  it("say at setup when the two teams are nearly the same colour", () => {
    expect(loaded().colorNote).toBeNull();
    const navy = loaded(HOME, { ...AWAY, primary_color: "#0c2b5c" });
    expect(navy.colorNote).toMatch(/nearly the same colour/);
    const html = renderToStaticMarkup(
      createElement(Summary, {
        loaded: navy,
        wearing: { home: null, away: null },
        onWearing: () => undefined,
        starting: false,
        onStart: () => undefined,
        today: "2026-10-03",
      }),
    );
    expect(html).toContain("nearly the same colour");
  });
});

describe("the colour on the team", () => {
  it("comes from an import only when the team has none, and only when it is a colour", () => {
    expect(mergeTeam({ ...EMPTY_TEAM }, { color: "#0B2A5B" }).color).toBe("#0b2a5b");
    expect(mergeTeam({ ...EMPTY_TEAM, color: "#123456" }, { color: "#0b2a5b" }).color).toBe("#123456");
    expect(mergeTeam({ ...EMPTY_TEAM }, { color: "navy" }).color).toBe("");
  });
});
