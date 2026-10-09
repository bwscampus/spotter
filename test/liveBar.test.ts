import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarMenu } from "@/components/live/BarMenu";
import { ConnectionStatus } from "@/components/live/ConnectionStatus";
import { applyResult, EMPTY_TRANSCRIPT, TranscriptLine } from "@/components/live/TranscriptLine";
import { LatestStat, StatsPanel, statsButton } from "@/components/livestats/StatsStrip";
import type { StatsView } from "@/lib/livestats/controller";
import { EMPTY_SESSION, okPlay, readPlays } from "@/lib/livestats/session";
import type { StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// The live screen's two bars (Jed, Oct 3): every control in one thin bar at
// the top, the cards' stage under it, and at the bottom the raw transcript on
// the left and the latest stat on the right. Made-up names only.

const LIVE_SCREEN = readFileSync(new URL("../components/live/LiveScreen.tsx", import.meta.url), "utf8");
const LIVE_GAME = readFileSync(new URL("../components/livestats/LiveGame.tsx", import.meta.url), "utf8");

/** The live screen's game layout, from the top bar to the end of the bottom one. */
const layout = LIVE_SCREEN.slice(LIVE_SCREEN.indexOf("{/* Every control"));
const top = layout.slice(0, layout.indexOf("</header>"));
const bottom = layout.slice(layout.indexOf("<footer "), layout.indexOf("</footer>"));

describe("the live screen's layout", () => {
  it("has every control in the top bar, above the cards", () => {
    for (const control of ["<ListenButton", "<ConnectionStatus", "<LevelMeter", "{statsMenu}", 'label="Audio"', "<RefreshRosters", "End game", 'label="⋯"']) {
      expect(top, control).toContain(control);
    }
    expect(layout.indexOf("</header>")).toBeLessThan(layout.indexOf("<NameDisplay"));
  });

  it("has one bar at the bottom, below the cards: the transcript on the left and the latest stat on the right", () => {
    expect(LIVE_SCREEN.match(/<footer /g)).toHaveLength(1);
    expect(layout.indexOf("<footer ")).toBeGreaterThan(layout.indexOf("<NameDisplay"));
    expect(bottom.indexOf("<TranscriptLine")).toBeGreaterThan(-1);
    expect(bottom.indexOf("<TranscriptLine")).toBeLessThan(bottom.indexOf("{statsLatest}"));
    expect(bottom).not.toMatch(/<ListenButton|<BarMenu|End game/);
  });

  it("has no recent names, no Log panel and no stats strip of its own", () => {
    expect(LIVE_SCREEN).not.toContain("RecentMatches");
    expect(LIVE_SCREEN).not.toContain("LogPanel");
    expect(LIVE_SCREEN).not.toContain("statsPanel");
  });

  it("gets the Stats button and the latest stat from live stats, built where the two meet", () => {
    expect(LIVE_GAME).toMatch(/statsMenu=\{[\s\S]*<BarMenu[\s\S]*<StatsPanel/);
    expect(LIVE_GAME).toMatch(/statsLatest=\{[\s\S]*<LatestStat view=\{view\} onCorrect=\{\(playId, correction\) => controller\.correct\(playId, correction\)\} \/>/);
  });
});

describe("the bar's pieces", () => {
  it("a menu shows only its button until it is opened, with a dot when something inside needs a look", () => {
    const html = renderToStaticMarkup(createElement(BarMenu, { label: "Audio", title: "Audio settings", warn: true }, "inside"));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("inside");
    expect(html).toContain("bg-amber-500");
  });

  it("the speech recognition status is a dot and a word, with the detail on hover", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionStatus, { state: { status: "open" } as never, micOn: true, hasApiKey: true }),
    );
    expect(html).toContain(">LIVE<");
    expect(html).toContain('title="Speech recognition: Hearing you"');
  });

  it("the transcript keeps more words, two lines' worth, newest last, read from the left", () => {
    let transcript = EMPTY_TRANSCRIPT;
    for (let i = 0; i < 120; i++) transcript = applyResult(transcript, `word${i}`, true);
    expect(transcript.final.length).toBeGreaterThan(300);
    expect(transcript.final.endsWith("word119")).toBe(true);
    const html = renderToStaticMarkup(createElement(TranscriptLine, { transcript }));
    expect(html).toContain("h-10");
    expect(html).toContain("word119");
    expect(html).not.toContain("text-right");
  });
});

// -----------------------------------------------------------------------------
// The latest stat, and the Stats button.
// -----------------------------------------------------------------------------

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const RUN: StatsPlay = {
  seqStart: 0,
  seqEnd: 1,
  quarter: 2,
  clock: null,
  down: 3,
  distance: 4,
  offense: "home",
  playType: "run",
  nullified: false,
  touchdown: false,
  firstDown: false,
  confidence: 0.9,
  summary: "run",
  evidence: "Fennimore up the middle for eight, Quillon on the stop",
  events: [
    { playerId: "H22-FENNIMORE", action: "rush", yards: 8, yardsSource: "stated", made: null },
    { playerId: "A17-QUILLON", action: "tackle", yards: null, yardsSource: null, made: null },
  ],
};

/** What a reader sees: the markup without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

function view(partial: Partial<StatsView> = {}): StatsView {
  return { session: EMPTY_SESSION, loop: { kind: "listening" }, on: true, roster: ROSTER, autoOk: false, gaps: [], ...partial };
}

describe("the latest stat", () => {
  it("is the play counted most recently, each player named once", () => {
    const read = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000).session;
    const session = okPlay(read, 2000).session;
    const html = renderToStaticMarkup(createElement(LatestStat, { view: view({ session }) }));
    expect(text(html)).toContain("Last counted (Q2 3rd &amp; 4): FENNIMORE #22 +1 CAR +8 RUSH YDS · QUILLON #17 +1 TKL");
  });

  it("makes every player, number and stat in it a button, the player once (Jed, Oct 8)", () => {
    const session = okPlay(readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000).session, 2000).session;
    const html = renderToStaticMarkup(createElement(LatestStat, { view: view({ session, autoOk: true }) }));
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(buttons).toEqual(["FENNIMORE #22", "+1", "CAR", "+8", "RUSH YDS", "QUILLON #17", "+1", "TKL"]);
  });

  it("is the front of the line when every play waits for an OK, and says so", () => {
    const session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000).session;
    expect(text(renderToStaticMarkup(createElement(LatestStat, { view: view({ session }) })))).toContain(
      "Waiting for your OK (Q2 3rd &amp; 4): FENNIMORE #22",
    );
    // Counted as read, a play read and not yet counted is not the latest: none is, here.
    expect(text(renderToStaticMarkup(createElement(LatestStat, { view: view({ session, autoOk: true }) })))).not.toContain(
      "FENNIMORE",
    );
  });

  it("takes the right half of the bottom bar, the transcript the left", () => {
    expect(renderToStaticMarkup(createElement(LatestStat, { view: view() }))).toMatch(/class="relative w-1\/2 /);
  });

  it("says what stats are doing before anything has counted, and says why when they stop", () => {
    expect(renderToStaticMarkup(createElement(LatestStat, { view: view() }))).toContain("Listening for plays");
    const paused = renderToStaticMarkup(createElement(LatestStat, { view: view({ loop: { kind: "paused", code: "network" } }) }));
    expect(paused).toContain("Stats paused: no connection");
    expect(paused).toContain("text-amber-700");
  });
});

describe("three plays counted in the same millisecond (M6)", () => {
  const plays: StatsPlay[] = [
    RUN,
    { ...RUN, seqStart: 2, seqEnd: 3, down: 1, distance: 10, events: [{ ...RUN.events[0], yards: 3 }, RUN.events[1]] },
    { ...RUN, seqStart: 4, seqEnd: 5, down: 2, distance: 7, events: [{ ...RUN.events[0], yards: 5 }, RUN.events[1]] },
  ];
  let session = readPlays(EMPTY_SESSION, plays, ROSTER, 1000).session;
  for (let i = 0; i < 3; i++) session = okPlay(session, 2000).session;

  it("shows the third as the latest stat", () => {
    const html = renderToStaticMarkup(createElement(LatestStat, { view: view({ session }) }));
    expect(text(html)).toContain("Last counted (Q2 2nd &amp; 7): FENNIMORE #22 +1 CAR +5 RUSH YDS");
  });

  it("puts Take back on the third, at the top of the counted list", () => {
    const html = renderToStaticMarkup(
      createElement(StatsPanel, {
        view: view({ session }),
        onOk: () => undefined,
        onDiscard: () => undefined,
        onUndo: () => undefined,
        onCorrect: () => undefined,
        onSwitch: () => undefined,
      }),
    );
    const list = html.slice(html.indexOf('data-testid="stats-counted"'));
    const rows = [...list.matchAll(/data-play="([^"]+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["4-5", "2-3", "0-1"]);
    const takeBack = list.indexOf("Take back");
    expect(takeBack).toBeGreaterThan(list.indexOf('data-play="4-5"'));
    expect(takeBack).toBeLessThan(list.indexOf('data-play="2-3"'));
    expect(list.match(/Take back/g)).toHaveLength(1);
  });
});

describe("the Stats panel's keys", () => {
  const panel = (autoOk: boolean) =>
    renderToStaticMarkup(
      createElement(StatsPanel, {
        view: view({ autoOk }),
        onOk: () => undefined,
        onDiscard: () => undefined,
        onUndo: () => undefined,
        onCorrect: () => undefined,
        onSwitch: () => undefined,
      }),
    );

  it("are shown on every width, and say nothing counts until it is OK'd", () => {
    const html = panel(false);
    const hint = html.slice(html.indexOf('data-testid="stats-keys"') - 200, html.indexOf("to fix it"));
    expect(hint).not.toMatch(/\bhidden\b/);
    expect(hint).toContain("Nothing counts until you OK it");
    expect(hint).toContain("Enter</kbd> or OK keeps the front play");
    expect(hint).toContain("Backspace</kbd> or Discard drops it");
    expect(hint).toContain("U</kbd> takes back the last one");
  });

  it("say so when every play counts as it is read (the default since Oct 8)", () => {
    expect(panel(true)).toContain("Every play counts as soon as it is read");
  });
});

describe("the Stats button", () => {
  it("counts the plays waiting and puts a dot on it when something needs a look", () => {
    expect(statsButton(view())).toEqual({ label: "Stats", warn: false });
    const waiting = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000).session;
    expect(statsButton(view({ session: waiting }))).toEqual({ label: "Stats · 1", warn: true });
    expect(statsButton(view({ loop: { kind: "stopped", code: "network", retrying: true } })).warn).toBe(true);
  });
});
