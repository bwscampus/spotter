import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside Next's own build; here every face is a class name.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-test", style: { fontFamily: "Test" } });
  return { Atkinson_Hyperlegible_Next: font, IBM_Plex_Sans: font, IBM_Plex_Mono: font };
});

import { NameDisplay } from "@/components/NameDisplay";
import { StageRow } from "@/components/live/StageRow";
import { TeamHalf } from "@/components/panel/TeamHalf";
import { TeamPanel } from "@/components/panel/TeamPanel";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { sideLooks } from "@/lib/game/colors";
import { panelFrom } from "@/lib/game/panelSetting";
import type { GameSnapshot } from "@/lib/game/snapshot";
import { PANEL_WIDTH_PX } from "@/lib/panel/layout";
import { seasonLeaders } from "@/lib/panel/leaders";
import type { TonightSource } from "@/lib/panel/types";
import { scheduleView } from "@/lib/panel/view";
import type { ScheduleGame } from "@/lib/schedule/types";

// =============================================================================
// The team panel as drawn (docs/PANEL_SPEC.md): two halves that never change
// size, the leaders' label, no leaders for volleyball, and the stage beside
// it, whose cards are the same markup with the panel on or off. Every player
// and school here is made up.
// =============================================================================

const ROSTER: KeyedPlayer[] = [
  { playerId: "H7-BRANDT", side: "home", jersey: "7", first: "Cole", last: "Brandt", position: "QB", season: { pass_yds: 1840, pass_cmp: 120, pass_att: 190 } },
  { playerId: "A22-OKAFOR", side: "away", jersey: "22", first: "Remy", last: "Okafor", position: "RB", season: { rush_yds: 902, rush_att: 140, rush_td: 11 } },
];

const SCHEDULE: ScheduleGame[] = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  opponent: index % 2 ? "Kettle Creek" : "Saint Bartholomew of the Valley Preparatory",
  site: index % 3 === 0 ? "A" : "H",
  teamScore: 20 + index,
  opponentScore: 14,
  league: index > 5,
}));

function game(extra: Partial<GameSnapshot> = {}, schedule: ScheduleGame[] = SCHEDULE): GameSnapshot {
  return {
    version: 1,
    builtAt: "2026-10-28T19:00:00.000Z",
    gameId: "3f1e2d3c-4b5a-4697-8a7b-6c5d4e3f2a1b",
    recorded: true,
    home: { id: "h", name: "Delmar", wearing: null, color: "#0b2545", schedule },
    away: { id: "a", name: "Kettle Creek", wearing: null, color: "#ffb612", schedule },
    watchlist: [],
    keyterms: [],
    sport: "football",
    teamCues: [],
    statsEnabled: false,
    statsRoster: ROSTER,
    ...extra,
  } as GameSnapshot;
}

const TONIGHT: TonightSource = { board: () => ({ tallies: new Map(), reached: new Map() }), subscribe: () => () => undefined };

function panel(snapshot: GameSnapshot, tonight: TonightSource | null = null): string {
  return renderToStaticMarkup(
    createElement(TeamPanel, { home: snapshot.home, away: snapshot.away, sport: snapshot.sport, roster: snapshot.statsRoster, tonight }),
  );
}

/** The opening tag of each half: its box, without anything inside it. */
function halves(markup: string): string[] {
  return [...markup.matchAll(/<section data-half="(away|home)"[^>]*>/g)].map((match) => match[0].replace(/data-half="(away|home)"/, ""));
}

describe("the panel's halves", () => {
  it("are two rows of equal, fixed height, away on top", () => {
    const markup = panel(game());
    expect(markup).toContain("grid-template-rows:minmax(0, 1fr) minmax(0, 1fr)");
    expect(markup.indexOf('data-half="away"')).toBeLessThan(markup.indexOf('data-half="home"'));
    const [away, home] = halves(markup);
    expect(away).toBe(home);
  });

  it("keep the same box whatever is in them", () => {
    const full = halves(panel(game()));
    const empty = halves(panel(game({}, [])));
    const volleyball = halves(panel(game({ sport: "volleyball" })));
    expect(empty).toEqual(full);
    expect(volleyball).toEqual(full);
    expect(full[0]).toContain("overflow:hidden");
  });

  it("say there is no schedule in one muted line", () => {
    expect(panel(game({}, []))).toContain("No schedule. Add one on the team page.");
  });
});

describe("the leaders", () => {
  it("are tonight's on a game with live stats", () => {
    const markup = panel(game({ statsEnabled: true }), TONIGHT);
    expect(markup).toContain(">TONIGHT<");
    expect(markup).not.toContain("SEASON LEADERS");
    // Nobody has done anything yet: – and no name.
    expect(markup).not.toContain("Brandt");
  });

  it("are the season's, labelled so, with live stats off", () => {
    const markup = panel(game());
    expect(markup).toContain(">SEASON LEADERS<");
    expect(markup).toContain("1,840");
    expect(markup).toContain("Brandt");
  });

  it("are left out for volleyball, and the schedule takes the half", () => {
    const markup = panel(game({ sport: "volleyball" }));
    expect(markup).not.toContain('data-part="leaders"');
    expect(markup).not.toContain("SEASON LEADERS");
    expect(markup).toContain('data-part="schedule"');
  });
});

describe("one half, drawn", () => {
  const looks = sideLooks({ color: "#0b2545", school: "Delmar" }, { color: null, school: "Kettle Creek" });

  function half(rows: number, today = "2026-10-28"): string {
    return renderToStaticMarkup(
      createElement(TeamHalf, {
        side: "home",
        school: "Delmar",
        look: looks.H,
        view: scheduleView([...SCHEDULE, { date: "2026-11-06", opponent: "Coastline", site: "N", teamScore: null, opponentScore: null, league: true }], today),
        rows,
        leaders: seasonLeaders(ROSTER, "home"),
        leadersLabel: "SEASON LEADERS",
        fits: null,
        names: null,
        opponents: null,
        advances: null,
        measure: null,
      }),
    );
  }

  it("shows as many played games as fit, newest first, with the streak and next game", () => {
    const markup = half(3);
    expect(markup.match(/data-part="game"/g)).toHaveLength(3);
    expect(markup.indexOf("Sep 12")).toBeLessThan(markup.indexOf("Sep 11"));
    expect(markup).not.toContain("Sep 9<");
    expect(markup).toContain("Won 12 straight");
    expect(markup).toContain("Fri Nov 6 vs Coastline");
    expect(markup).toContain("12-0");
    expect(markup).toContain("6-0 league");
  });

  it("puts the team's colour on the band with the slab's ink", () => {
    const markup = half(0);
    expect(markup).toContain("background-color:#0b2545");
    expect(markup).toContain("color:#FFFFFF");
    expect(markup).toContain(">HOME<");
  });

  it("colours a win and a loss, and never lets the colour carry it alone", () => {
    const markup = half(3);
    expect(markup).toContain("color:#145A2B");
    expect(markup).toMatch(/color:#145A2B[^>]*>W</);
  });
});

// -----------------------------------------------------------------------------
// The stage beside it: the cards never change, only the stage's width.
// -----------------------------------------------------------------------------

function stageRow(panelOn: boolean): string {
  const snapshot = game();
  const panelNode: ReactNode = createElement(TeamPanel, { home: snapshot.home, away: snapshot.away, sport: snapshot.sport, roster: snapshot.statsRoster, tonight: null });
  const cards = createElement(
    "main",
    { className: "relative min-h-0 flex-1" },
    createElement(NameDisplay, { ref: { current: null }, dimmed: false, placeholder: "Listening", tonight: true, background: null }),
  );
  return renderToStaticMarkup(createElement(StageRow, { panel: panelNode, panelOn }, cards));
}

/** Everything from the stage's column on: the cards and what holds them. */
function stage(markup: string): string {
  return markup.slice(markup.indexOf('data-testid="stage-column"'));
}

describe("the panel beside the stage", () => {
  it("is a fixed 360px column, and the cards' markup is identical with it on and off", () => {
    const on = stageRow(true);
    const off = stageRow(false);
    expect(on).toContain(`width:${PANEL_WIDTH_PX}px`);
    expect(stage(on)).toBe(stage(off));
    expect(stage(on)).toContain('data-testid="spotted-names"');
  });

  it("is hidden, not removed, when switched off, and the stage takes the whole width", () => {
    const off = stageRow(false);
    expect(off).toMatch(/<aside hidden=""/);
    expect(off).toContain('data-testid="team-panel"');
    expect(stageRow(true)).not.toMatch(/<aside hidden/);
    // The stage's column is a flex child that takes whatever the panel leaves.
    expect(stage(off)).toMatch(/^data-testid="stage-column"/);
    expect(off).toContain('class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="stage-column"');
  });

  it("with no panel at all, the stage is all there is", () => {
    const markup = renderToStaticMarkup(createElement(StageRow, { panelOn: true }, createElement("main")));
    expect(markup).not.toContain("<aside");
  });
});

describe("the remembered setting", () => {
  it("is on unless this announcer turned it off", () => {
    expect(panelFrom(null)).toBe(true);
    expect(panelFrom("on")).toBe(true);
    expect(panelFrom("off")).toBe(false);
    expect(panelFrom("anything")).toBe(true);
  });
});
