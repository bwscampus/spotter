import { describe, expect, it } from "vitest";
import type { TonightTally } from "@/lib/cards/tonight";
import { buildCandidates, candidateAt, MAX_CANDIDATES, NOT_NAMED } from "@/lib/livestats/candidates";
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

  it("caps the list at eight and still ends with NOT_NAMED", () => {
    const list = buildCandidates(
      segment(["castellane fennimore tafita brown vantree pellegrosso okonkwo whitlock quillon langan amesbury duarte grenville all on the field for the handoff"]),
      { offense: "home", qbs: QBS },
      ROSTER,
    );
    expect(list).toHaveLength(MAX_CANDIDATES + 1);
    expect(list[list.length - 1].idx).toBe(NOT_NAMED);
    expect(list.slice(0, -1).map((candidate) => candidate.idx)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("reads an index back", () => {
    const list = buildCandidates(segment(["fennimore up the middle"]), { offense: "home", qbs: QBS }, ROSTER);
    expect(candidateAt(list, 1)?.playerId).toBe("H22-FENNIMORE");
    expect(candidateAt(list, NOT_NAMED)).toBeNull();
    expect(candidateAt(list, null)).toBeNull();
    expect(candidateAt(list, 42)).toBeNull();
  });
});
