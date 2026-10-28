import { describe, expect, it } from "vitest";
import type { TonightTally } from "@/lib/cards/tonight";
import { buildCandidates, candidateAt, MAX_CANDIDATES, NAMED_BEFORE_SNAP, NOT_NAMED } from "@/lib/livestats/candidates";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { Segmenter, type PlaySegment } from "@/lib/livestats/segment";
import { ROSTER, TEAMS } from "./parse/roster";

// The candidate list (v7, Part 4): shared surnames, a misspelled name, a
// jersey-only mention, the quarterback nobody named, the running-back prior,
// the cap. Synthetic roster.

const context = parseContextFor(ROSTER, TEAMS, "home");
const QBS = { home: "H7-CASTELLANE", away: "A9-LANGAN" } as const;

/** A segment from a few lines said two seconds apart, closed by a call. */
function segment(lines: string[], post: string[] = []): PlaySegment {
  const segmenter = new Segmenter();
  let at = 1_800_000_000_000;
  let seq = 0;
  let closed: PlaySegment[] = [];
  for (const text of lines) closed = closed.concat(segmenter.push(parseLine(text, context, seq++), (at += 2_000)));
  closed = closed.concat(segmenter.push(parseLine("first and 10", context, seq++), (at += 6_000)));
  for (const text of post) segmenter.push(parseLine(text, context, seq++), (at += 2_000));
  const [first] = closed;
  if (!first) throw new Error("no segment closed");
  return first;
}

const ids = (list: ReturnType<typeof buildCandidates>) => list.map((candidate) => candidate.playerId);

describe("buildCandidates", () => {
  it("lists everyone the lines name, best first, side-tagged, and NOT_NAMED last at index 0", () => {
    const list = buildCandidates(segment(["castellane hands off to fennimore up the middle", "brought down by quillon"]), { offense: "home", qbs: QBS }, ROSTER);
    expect(ids(list)).toEqual(["H7-CASTELLANE", "H22-FENNIMORE", "A17-QUILLON", null]);
    expect(list[0]).toMatchObject({ idx: 1, label: "#7 Dax Castellane QB HOME", side: "home", score: 1, tags: ["prior:qb"] });
    expect(list[2]).toMatchObject({ idx: 3, label: "#17 Marek Quillon LB AWAY", side: "away" });
    expect(list[3]).toMatchObject({ idx: NOT_NAMED, label: "NOT_NAMED", playerId: null });
  });

  it("keeps both players who share a surname, tagged, with the position and side in the label", () => {
    const list = buildCandidates(segment(["brown breaks it up"]), { offense: "home", qbs: QBS }, ROSTER);
    const browns = list.filter((candidate) => candidate.playerId?.endsWith("-BROWN"));
    expect(browns).toHaveLength(2);
    for (const brown of browns) expect(brown.tags).toContain("same surname");
    expect(browns.map((brown) => brown.label).sort()).toEqual(["#11 Eli Brown WR HOME", "#4 Jace Brown CB AWAY"]);
  });

  it("takes a misspelled surname with the words it was heard as", () => {
    const list = buildCandidates(segment(["tafitaga hauls it in at the 40"]), { offense: "home", qbs: QBS }, ROSTER);
    const tafita = list.find((candidate) => candidate.playerId === "H3-TAFITA")!;
    expect(tafita.score).toBeGreaterThanOrEqual(0.7);
    expect(tafita.heardAs).toEqual(["tafitaga"]);
  });

  it("takes a jersey-only mention, on both sides when both have the number", () => {
    const list = buildCandidates(segment(["number 22 up the middle for 6"]), { offense: "home", qbs: QBS }, ROSTER);
    expect(ids(list).filter((id) => id?.includes("22"))).toEqual(["H22-FENNIMORE", "A22-GRENVILLE"]);
    expect(list[0].tags).toContain("by jersey");
  });

  it("adds the offense's quarterback when nobody named him, tagged prior:qb with no score", () => {
    const list = buildCandidates(segment(["a throw to tafita caught at the 40"]), { offense: "home", qbs: QBS }, ROSTER);
    const qb = list.find((candidate) => candidate.playerId === "H7-CASTELLANE")!;
    expect(qb).toMatchObject({ score: 0, tags: ["prior:qb"] });
    expect(list.indexOf(qb)).toBe(list.length - 2);
  });

  it("adds the offense's most-credited back on a run nobody is named for, tagged prior:rb", () => {
    const tonight = new Map<string, TonightTally>([
      ["H22-FENNIMORE", { stats: { rush_att: 9, rush_yds: 40 }, estimated: [] }],
      ["H40-PELLEGROSSO", { stats: { rush_att: 2 }, estimated: [] }],
    ]);
    const list = buildCandidates(segment(["handoff up the middle for 4", "brought down by quillon"]), { offense: "home", qbs: QBS }, ROSTER, tonight);
    const back = list.find((candidate) => candidate.playerId === "H22-FENNIMORE")!;
    expect(back).toMatchObject({ score: 0, tags: ["prior:rb"] });
    // Named, and it is no prior; a pass, and there is no back to guess at.
    expect(buildCandidates(segment(["fennimore up the middle for 4"]), { offense: "home", qbs: QBS }, ROSTER, tonight).find((c) => c.playerId === "H22-FENNIMORE")!.tags).toEqual([]);
    expect(ids(buildCandidates(segment(["a throw over the middle incomplete"]), { offense: "home", qbs: QBS }, ROSTER, tonight))).not.toContain("H22-FENNIMORE");
  });

  it("caps the list at MAX_CANDIDATES (ten since fix 1, Part 4) and still ends with NOT_NAMED", () => {
    const list = buildCandidates(
      segment(["castellane fennimore tafita brown vantree pellegrosso okonkwo whitlock quillon langan amesbury duarte grenville all on the field for the handoff"]),
      { offense: "home", qbs: QBS },
      ROSTER,
    );
    expect(list).toHaveLength(MAX_CANDIDATES + 1);
    expect(list[list.length - 1].idx).toBe(NOT_NAMED);
    expect(MAX_CANDIDATES).toBe(10);
    expect(list.slice(0, -1).map((candidate) => candidate.idx)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("reads an index back", () => {
    const list = buildCandidates(segment(["fennimore up the middle"]), { offense: "home", qbs: QBS }, ROSTER);
    expect(candidateAt(list, 1)?.playerId).toBe("H22-FENNIMORE");
    expect(candidateAt(list, NOT_NAMED)).toBeNull();
    expect(candidateAt(list, null)).toBeNull();
    expect(candidateAt(list, 42)).toBeNull();
  });
});

describe("names said before the snap (fix 1, Part 1)", () => {
  it("lists a player named only in the PRE lines, tagged, and before the priors", () => {
    const play = segment(["second and 6", "fennimore set deep with tafita out wide", "they hand it off up the middle", "brought down by quillon"]);
    expect(play.preLines.map((line) => line.text)).toContain("fennimore set deep with tafita out wide");
    // With nobody's offense known the play's own names come first (fix 1, Part 4 puts the offense's backs and receivers ahead when it is).
    expect(ids(buildCandidates(play, { offense: null, qbs: QBS }, ROSTER))[0]).toBe("A17-QUILLON");
    const list = buildCandidates(play, { offense: "home", qbs: QBS }, ROSTER);
    const before = list.filter((candidate) => candidate.tags.includes(NAMED_BEFORE_SNAP)).map((candidate) => candidate.playerId);
    expect(before.sort()).toEqual(["H22-FENNIMORE", "H3-TAFITA"]);
    expect(list.find((candidate) => candidate.playerId === "A17-QUILLON")?.tags).not.toContain(NAMED_BEFORE_SNAP);
    // The quarterback nobody named comes after them, and NOT_NAMED is still last.
    const order = ids(list);
    expect(order.indexOf("H7-CASTELLANE")).toBeGreaterThan(order.indexOf("H22-FENNIMORE"));
    expect(list.at(-1)?.idx).toBe(NOT_NAMED);
  });

  it("does not tag a player the play's own lines name as well", () => {
    const play = segment(["fennimore set deep", "castellane hands it off to fennimore up the middle", "brought down by quillon"]);
    const fennimore = buildCandidates(play, { offense: "home", qbs: QBS }, ROSTER).find((candidate) => candidate.playerId === "H22-FENNIMORE");
    expect(fennimore?.tags).not.toContain(NAMED_BEFORE_SNAP);
  });
});

describe("the quarterback prior (fix 1, Part 3)", () => {
  it("is offered only when the offense is known", () => {
    const play = segment(["the pass is complete over the middle", "brought down at the 40"]);
    expect(buildCandidates(play, { offense: null, qbs: QBS }, ROSTER).some((candidate) => candidate.tags.includes("prior:qb"))).toBe(false);
    expect(buildCandidates(play, { offense: "home", qbs: QBS }, ROSTER).find((candidate) => candidate.tags.includes("prior:qb"))?.playerId).toBe("H7-CASTELLANE");
  });
});

describe("the order (fix 1, Part 4)", () => {
  it("puts the offense's quarterback, backs and receivers first (named in the play, then before the snap), then everyone else the same way, then the priors", () => {
    const play = segment(["second and 6", "amesbury fennimore and quillon up close", "quillon blitzes and brown covers as castellane throws to tafita", "brought down by grenville at the 40"]);
    const list = buildCandidates(play, { offense: "home", qbs: QBS }, ROSTER);
    const order = ids(list);
    const at = (id: string) => order.indexOf(id);
    // Castellane (QB) and Tafita (WR) are the offense's; Quillon, Brown (the corner) and Grenville are not.
    expect(Math.max(at("H7-CASTELLANE"), at("H3-TAFITA"))).toBeLessThan(Math.min(at("A17-QUILLON"), at("A22-GRENVILLE")));
    // Fennimore, the offense's back, named only before the snap, comes before the defenders the play names;
    // Amesbury, the other side's back named only before the snap, after them.
    expect(at("H22-FENNIMORE")).toBeLessThan(at("A17-QUILLON"));
    expect(at("A32-AMESBURY")).toBeGreaterThan(at("A22-GRENVILLE"));
    expect(list.find((candidate) => candidate.playerId === "A32-AMESBURY")?.tags).toContain(NAMED_BEFORE_SNAP);
  });
});
