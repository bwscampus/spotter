import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchupChips, NO_TEAM_COLOR, TeamChip, teamChipColors } from "@/components/ui/TeamChip";
import { MiniCard } from "@/components/ui/MiniCard";
import { relativeLuminance } from "@/lib/game/colors";
import { sampleCard } from "@/lib/demo/sample";

// The Broadcast look (Nov 19, docs/UI_STYLE.md). Every pair of tokens used for
// text meets WCAG AA (4.5:1), the team chip follows the card's own ink rule,
// and the mini card says what the real card would.

const css = readFileSync("app/globals.css", "utf8");
const token = (name: string): string => {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  if (!match) throw new Error(`no token ${name}`);
  return match[1];
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the tokens", () => {
  const TEXT_PAIRS: Array<[string, string]> = [
    ["ink", "page"],
    ["ink-2", "page"],
    ["muted", "page"],
    ["muted", "surface"],
    ["accent", "surface"],
    ["accent", "page"],
    ["on-navy", "navy"],
    ["on-navy-2", "navy"],
    ["on-navy", "navy-2"],
    ["on-navy-2", "navy-2"],
    ["highlight", "navy"],
    ["highlight-ink", "highlight"],
    ["highlight-ink", "highlight-hover"],
    ["amber-text", "amber-fill"],
    ["red", "surface"],
    ["green", "surface"],
  ];

  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (text, background) => {
    expect(contrast(token(text), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the highlight bright on navy, the one thing that stands out in the bar", () => {
    expect(contrast(token("highlight"), token("navy"))).toBeGreaterThan(8);
  });
});

describe("a team's chip", () => {
  it("is the school code on the team's colour, in the card's own ink", () => {
    const html = renderToStaticMarkup(createElement(TeamChip, { school: "Harborview", color: "#0b2d5b" }));
    expect(html).toContain(">HAR<");
    expect(html).toContain("background:#0b2d5b");
    expect(html).toContain("color:#FFFFFF");
    expect(teamChipColors("#ffd700")).toEqual({
      background: "#ffd700",
      color: "#111111",
    });
  });

  it("falls back to neutral ink for a team with no colour, or one that is not a colour", () => {
    expect(teamChipColors(null).background).toBe(NO_TEAM_COLOR);
    expect(teamChipColors("blue").background).toBe(NO_TEAM_COLOR);
  });

  it("is decoration: hidden from a screen reader, the school's name beside it says it", () => {
    expect(renderToStaticMarkup(createElement(TeamChip, { school: "Millbrook" }))).toContain('aria-hidden="true"');
  });

  it("draws a matchup away first, and only the side it has", () => {
    const both = renderToStaticMarkup(
      createElement(MatchupChips, {
        away: { school: "Millbrook" },
        home: { school: "Harborview" },
      }),
    );
    expect(both.indexOf("MIL")).toBeLessThan(both.indexOf("HAR"));
    expect(both).toContain(">at<");
    const one = renderToStaticMarkup(
      createElement(MatchupChips, {
        away: { school: null },
        home: { school: "Harborview" },
      }),
    );
    expect(one).not.toContain(">at<");
    expect(
      renderToStaticMarkup(
        createElement(MatchupChips, {
          away: { school: null },
          home: { school: null },
        }),
      ),
    ).toBe("");
  });
});

describe("the mini card", () => {
  it("says what the real card says: the number, the respelling stressed, the name, a fact and the season", () => {
    const card = sampleCard("Nwachukwu");
    expect(card).not.toBeNull();
    const html = renderToStaticMarkup(createElement(MiniCard, { card: card! }));
    expect(html).toContain(">55<");
    expect(html).toContain(">LB<");
    expect(html).toMatch(/wah-<b[^>]*>CHOO<\/b>-koo/);
    expect(html).toContain("Team captain");
    expect(html).toContain("74 tkl");
  });

  it("shows a surname plain when there is no respelling", () => {
    const html = renderToStaticMarkup(createElement(MiniCard, { card: sampleCard("Langan")! }));
    expect(html).toMatch(/<b class="font-bold">Langan<\/b>/);
    expect(html).toContain("1,012 yds");
  });
});
