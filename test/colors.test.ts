import { describe, expect, it } from "vitest";
import {
  colorDistance,
  contrastOnWhite,
  normalizeHex,
  resolveGameColors,
  sideLooks,
  tooClose,
  withAlpha,
  MIN_COLOR_DISTANCE,
  splitBackground,
  STAGE_DARKEN,
  relativeLuminance,
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

describe("contrastOnWhite", () => {
  it("is what the logo colour picker uses to skip a colour that would vanish on white", () => {
    expect(contrastOnWhite("#000080")).toBeGreaterThan(4.5);
    expect(contrastOnWhite("#ffd700")).toBeLessThan(4.5);
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

describe("sideLooks", () => {
  it("never tells the away team apart by colour alone: same colour, still hatched and coded", () => {
    const looks = sideLooks({ color: "#0b2545", school: "Harborview" }, { color: "#0b2545", school: "Castellan Prep" });
    expect(looks.H.background).toBe(looks.A.background);
    expect(looks.H.hatch).toBe("");
    expect(looks.H.code).toBe("");
    expect(looks.A.hatch).toContain("repeating-linear-gradient(45deg");
    expect(looks.A.code).toBe("CP");
  });

  it("refuses a colour it cannot parse, and falls back to the side's plain slab", () => {
    expect(sideLooks({ color: "navy", school: "Harborview" }, { color: null, school: "Estancia" }).H.background).toBe("#111111");
  });
});

describe("splitBackground, the diagonal behind the cards", () => {
  const navy = "#000080";
  const crimson = "#980633";

  it("puts the left side's colour first and the right side's second, each its own colour darkened, not mixed with grey", () => {
    const css = splitBackground(navy, crimson)!;
    const colours = css.match(/#[0-9a-f]{6}/g)!;
    // Left, left, white line twice, right, right.
    expect(colours).toEqual(["#000053", "#000053", "#ffffff", "#ffffff", "#630421", "#630421"]);
    // 35% darker, rounded: navy's blue 0x80 is 0x53; crimson 0x98, 0x06, 0x33 is 0x63, 0x04, 0x21.
    expect(STAGE_DARKEN).toBe(0.35);
  });

  it("has a hard edge and a thin white line between them, never a soft blend", () => {
    const css = splitBackground(navy, crimson)!;
    const stops = [...css.matchAll(/(#[0-9a-f]{6}) (\d+\.?\d*)%/g)].map((m) => [m[1], Number(m[2])] as const);
    // Each colour holds to its edge: the left until the line starts, the line, the right from where it ends.
    const white = stops.filter(([hex]) => hex === "#ffffff");
    expect(white).toHaveLength(2);
    const [lineStart, lineEnd] = [white[0][1], white[1][1]];
    expect(lineEnd - lineStart).toBeGreaterThan(0.3);
    expect(lineEnd - lineStart).toBeLessThan(1);
    const left = stops.filter(([hex]) => hex === "#000053");
    expect(left[1][1]).toBe(lineStart);
    expect(stops.filter(([hex]) => hex === "#630421")[0][1]).toBe(lineEnd);
  });

  it("keeps a white or gold team from becoming white behind the white card", () => {
    const css = splitBackground("#ffffff", "#ffb612")!;
    const [first, , , , second] = css.match(/#[0-9a-f]{6}/g)!;
    expect(first).toBe("#a6a6a6");
    expect(second).toBe("#a6760c");
    expect(relativeLuminance(first)).toBeLessThan(0.5);
  });

  it("leans the divider past vertical and not down the middle", () => {
    const css = splitBackground(navy, crimson)!;
    const angle = Number(css.match(/^linear-gradient\((\d+)deg/)![1]);
    expect(angle).toBeGreaterThan(90);
    expect(angle).toBeLessThan(135);
    for (const stop of css.matchAll(/(\d+\.\d)%/g)) expect(Number(stop[1])).not.toBe(50);
  });

  it("leaves a side with no colour as the stage's grey, and is nothing when neither has one", () => {
    expect(splitBackground(null, crimson)).toContain("#6B6B6B");
    expect(splitBackground(navy, null)).toContain("#6B6B6B");
    expect(splitBackground(null, null)).toBeNull();
  });

  it("refuses a colour it cannot parse rather than emitting broken css", () => {
    expect(splitBackground("nonsense", "also nonsense")).toBeNull();
  });
});
