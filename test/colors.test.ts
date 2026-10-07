import { describe, expect, it } from "vitest";
import {
  colorDistance,
  contrastOnWhite,
  normalizeHex,
  readableInk,
  resolveGameColors,
  tooClose,
  splitBackground,
  withAlpha,
  MIN_COLOR_DISTANCE,
} from "@/lib/game/colors";

describe("normalizeHex", () => {
  it("takes the shapes a colour input or a person might produce", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHex("aabbcc")).toBe("#aabbcc");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("  #AbC  ")).toBe("#aabbcc");
  });

  it("refuses anything that is not a colour", () => {
    expect(normalizeHex("navy")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe("colorDistance", () => {
  it("calls two shades of the same navy a clash", () => {
    expect(tooClose("#000080", "#00007e")).toBe(true);
  });

  it("keeps navy and scarlet apart", () => {
    expect(tooClose("#000080", "#b5303a")).toBe(false);
  });

  it("weights green, because that is what the eye does", () => {
    // The same numeric gap reads as a bigger difference in green than in blue.
    expect(colorDistance("#000000", "#00ff00")).toBeGreaterThan(colorDistance("#000000", "#0000ff"));
  });

  it("treats an unreadable colour as infinitely far, never as a clash", () => {
    expect(colorDistance("navy", "#000080")).toBe(Infinity);
  });

  it("agrees with the threshold it is compared against", () => {
    expect(colorDistance("#000000", "#ffffff")).toBeGreaterThan(MIN_COLOR_DISTANCE);
  });
});

describe("readableInk", () => {
  it("leaves a dark colour alone", () => {
    expect(readableInk("#000080")).toBe("#000080");
  });

  it("darkens a school colour that would vanish on a white card", () => {
    // Gold and white are real school colours and unreadable as printed.
    for (const pale of ["#ffd700", "#ffffff", "#87ceeb"]) {
      const ink = readableInk(pale)!;
      expect(contrastOnWhite(ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the hue while darkening", () => {
    // Gold darkens toward brown, not toward grey: red stays the strongest channel.
    const ink = readableInk("#ffd700")!;
    const r = parseInt(ink.slice(1, 3), 16);
    const b = parseInt(ink.slice(5, 7), 16);
    expect(r).toBeGreaterThan(b);
  });

  it("returns null for something that is not a colour", () => {
    expect(readableInk("navy")).toBeNull();
  });
});

describe("withAlpha", () => {
  it("makes a wash the card can sit behind", () => {
    expect(withAlpha("#000080", 0.14)).toBe("rgba(0, 0, 128, 0.14)");
  });

  it("returns null rather than a broken css value", () => {
    expect(withAlpha("navy", 0.14)).toBeNull();
  });
});

describe("resolveGameColors", () => {
  const navy = "#000080";
  const scarlet = "#b5303a";

  it("gives each side its own colour", () => {
    expect(resolveGameColors(navy, scarlet)).toEqual({ home: navy, away: scarlet, note: null });
  });

  it("keeps both even when they are the same, and says they will look alike", () => {
    // Which colour a team wears is the announcer's call, not the code's.
    const colors = resolveGameColors(navy, navy);
    expect(colors.home).toBe(navy);
    expect(colors.away).toBe(navy);
    expect(colors.note).toContain("look alike");
  });

  it("warns on a near miss, not just an exact match", () => {
    expect(resolveGameColors("#000080", "#00007e").note).not.toBeNull();
  });

  it("says nothing when the two are plainly different", () => {
    expect(resolveGameColors(navy, scarlet).note).toBeNull();
  });

  it("colours whichever side has one when the other has none", () => {
    expect(resolveGameColors(navy, null)).toEqual({ home: navy, away: null, note: null });
    expect(resolveGameColors(null, scarlet)).toEqual({ home: null, away: scarlet, note: null });
  });

  it("says nothing when neither side has a colour", () => {
    expect(resolveGameColors(null, null)).toEqual({ home: null, away: null, note: null });
  });

  it("normalizes whatever shape the colours were stored in", () => {
    expect(resolveGameColors("#00F", "B5303A")).toEqual({ home: "#0000ff", away: "#b5303a", note: null });
  });
});

describe("splitBackground", () => {
  const navy = "#000080";
  const crimson = "#980633";

  it("puts the left side's colour first and the right side's second", () => {
    const css = splitBackground(navy, crimson)!;
    expect(css.indexOf("0, 0, 128")).toBeLessThan(css.indexOf("152, 6, 51"));
  });

  it("leans the divider past vertical, which is the positive slope", () => {
    // Above 90deg the stop line tilts so its top sits right of its bottom.
    const angle = Number(splitBackground(navy, crimson)!.match(/^linear-gradient\((\d+)deg/)![1]);
    expect(angle).toBeGreaterThan(90);
    expect(angle).toBeLessThan(135);
  });

  it("does not split down the exact middle", () => {
    const stops = [...splitBackground(navy, crimson)!.matchAll(/(\d+\.\d)%/g)].map((m) => Number(m[1]));
    for (const stop of stops) expect(stop).not.toBe(50);
  });

  it("shows the page's white for a side with no colour", () => {
    // Not transparent: interpolating to transparent greys the boundary.
    expect(splitBackground(null, crimson)).toContain("#ffffff");
    expect(splitBackground(navy, null)).toContain("#ffffff");
  });

  it("is nothing at all when neither side has a colour", () => {
    expect(splitBackground(null, null)).toBeNull();
  });

  it("refuses a colour it cannot parse rather than emitting broken css", () => {
    expect(splitBackground("navy", null)).toBeNull();
  });
});
