import { describe, expect, it } from "vitest";
import { buildCandidates } from "@/lib/livestats/candidates";
import { answerToPlay, creditsAnyone } from "@/lib/livestats/extract/mapping";
import { EXTRACT_PLAY_TYPES, NOT_A_PLAY, type ExtractAnswer } from "@/lib/livestats/extract/schema";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { Segmenter, type PlaySegment } from "@/lib/livestats/segment";
import { ROSTER, TEAMS } from "../parse/roster";

// The answer as a play (v7, Part 5): every playType maps to the v6 vocabulary
// the rules read, and NOT_NAMED never credits anyone.

const context = parseContextFor(ROSTER, TEAMS, "home");
const QBS = { home: "H7-CASTELLANE", away: "A9-LANGAN" } as const;

function segment(lines: string[]): PlaySegment {
  const segmenter = new Segmenter();
  let at = 1_800_000_000_000;
  let seq = 0;
  let closed: PlaySegment[] = [];
  for (const text of lines) closed = closed.concat(segmenter.push(parseLine(text, context, seq++), (at += 2_000)));
  closed = closed.concat(segmenter.push(parseLine("first and 10", context, seq++), (at += 6_000)));
  return closed[0];
}

const answer = (extra: Partial<ExtractAnswer>): ExtractAnswer => ({ ...NOT_A_PLAY, playType: "rush", confidence: "high", ...extra });

/** A segment that names Castellane (1), Fennimore (2), Tafita (3) and Quillon (4) in that order. */
const SEG = segment(["castellane hands off to fennimore then throws to tafita at the 40", "brought down by quillon"]);
const CANDIDATES = buildCandidates(SEG, { offense: "home", qbs: QBS }, ROSTER);
const STATE = { offense: "home" as const, out: new Set<string>(), roster: ROSTER };
const idx = (id: string) => CANDIDATES.find((candidate) => candidate.playerId === id)!.idx;
const map = (extra: Partial<ExtractAnswer>, seg = SEG) => answerToPlay(answer(extra), seg, CANDIDATES, STATE);
const events = (extra: Partial<ExtractAnswer>) => map(extra).play!.events.map((event) => `${event.playerId}:${event.action}${event.yards === null ? "" : `:${event.yards}`}`);

describe("answerToPlay", () => {
  it("maps every play type", () => {
    const C = idx("H7-CASTELLANE");
    const F = idx("H22-FENNIMORE");
    const T = idx("H3-TAFITA");
    const Q = idx("A17-QUILLON");
    expect(events({ playType: "rush", carrierIdx: F, tacklerIdx: Q, yardsSaid: 6 })).toEqual(["H22-FENNIMORE:rush:6", "A17-QUILLON:tackle"]);
    expect(map({ playType: "rush", carrierIdx: F }).play!.playType).toBe("run");
    expect(events({ playType: "pass_complete", passerIdx: C, receiverIdx: T, tacklerIdx: Q, yardsSaid: 14 })).toEqual(["H7-CASTELLANE:pass_complete:14", "H3-TAFITA:reception:14", "A17-QUILLON:tackle"]);
    expect(events({ playType: "pass_incomplete", passerIdx: C, receiverIdx: T, tacklerIdx: Q })).toEqual(["H7-CASTELLANE:pass_incomplete", "A17-QUILLON:pass_breakup"]);
    expect(events({ playType: "sack", carrierIdx: C, tacklerIdx: Q, yardsSaid: -7 })).toEqual(["H7-CASTELLANE:sacked:7", "A17-QUILLON:sack:7"]);
    expect(map({ playType: "sack", carrierIdx: C }).play!.playType).toBe("sack");
    expect(events({ playType: "interception", passerIdx: C, receiverIdx: Q })).toEqual(["H7-CASTELLANE:pass_intercepted", "A17-QUILLON:interception"]);
    expect(events({ playType: "fumble_lost", carrierIdx: F, tacklerIdx: Q })).toEqual(["H22-FENNIMORE:fumble", "A17-QUILLON:fumble_recovery"]);
    expect(events({ playType: "punt", carrierIdx: C, receiverIdx: Q, yardsSaid: 42 })).toEqual(["H7-CASTELLANE:punt:42", "A17-QUILLON:punt_return"]);
    expect(map({ playType: "penalty_only", penalty: "offense" }).play).toMatchObject({ playType: "penalty_only", events: [], penalty: { on: "offense", noPlay: false } });
    expect(map({ playType: "no_play", carrierIdx: F, yardsSaid: 20, penalty: "offense" }).play).toMatchObject({ playType: "run", nullified: true, penalty: { on: "offense", noPlay: true } });
    expect(map({ playType: "not_a_play" }).play).toBeNull();
  });

  it("reads which kick a kick was from the words", () => {
    const fg = segment(["whitlock field goal attempt from 42 and it is good"]);
    const candidates = buildCandidates(fg, { offense: "home", qbs: QBS }, ROSTER);
    const kicker = candidates.find((candidate) => candidate.playerId === "H1-WHITLOCK")!.idx;
    const play = answerToPlay(answer({ playType: "kick", carrierIdx: kicker, yardsSaid: 42 }), fg, candidates, STATE).play!;
    expect(play.playType).toBe("field_goal");
    expect(play.events).toEqual([{ playerId: "H1-WHITLOCK", action: "field_goal", yards: 42, yardsSource: "stated", made: true }]);
    const ko = segment(["the kickoff is taken by amesbury at the 5 and returned out to the 30"]);
    const koCandidates = buildCandidates(ko, { offense: "home", qbs: QBS }, ROSTER);
    const returner = koCandidates.find((candidate) => candidate.playerId === "A32-AMESBURY")!.idx;
    const kickoff = answerToPlay(answer({ playType: "kick", receiverIdx: returner }), ko, koCandidates, STATE).play!;
    expect(kickoff.playType).toBe("kickoff");
    expect(kickoff.events).toEqual([{ playerId: "A32-AMESBURY", action: "kick_return", yards: null, yardsSource: null, made: null }]);
  });

  it("never credits anyone for NOT_NAMED: the carry is nobody's, the pass is left for the quarterback rule", () => {
    expect(events({ playType: "rush", carrierIdx: 0 })).toEqual([":rush"]);
    expect(events({ playType: "pass_complete", passerIdx: 0, receiverIdx: 0 })).toEqual([":pass_complete", ":reception"]);
    expect(events({ playType: "rush", carrierIdx: 0, tacklerIdx: 0 })).toEqual([":rush"]);
    expect(creditsAnyone(answer({ carrierIdx: 0, tacklerIdx: 0 }))).toBe(false);
    expect(creditsAnyone(answer({ carrierIdx: 2 }))).toBe(true);
    for (const type of EXTRACT_PLAY_TYPES) {
      const play = map({ playType: type, carrierIdx: 0, passerIdx: 0, receiverIdx: 0, tacklerIdx: 0 }).play;
      if (play) expect(play.events.every((event) => event.playerId === ""), type).toBe(true);
    }
  });

  it("drops a player marked out tonight, with the rule", () => {
    const mapped = answerToPlay(answer({ playType: "rush", carrierIdx: idx("H22-FENNIMORE") }), SEG, CANDIDATES, { ...STATE, out: new Set(["H22-FENNIMORE"]) });
    expect(mapped.play!.events).toEqual([{ playerId: "", action: "rush", yards: null, yardsSource: null, made: null }]);
    expect(mapped.notes).toEqual([{ playerId: "H22-FENNIMORE", action: "rush", rule: "R35", reason: expect.stringContaining("out tonight"), kind: "dropped" }]);
  });

  it("carries the segment's lines, call, spots and the words into the play", () => {
    const play = map({ playType: "pass_complete", passerIdx: idx("H7-CASTELLANE"), receiverIdx: idx("H3-TAFITA"), confidence: "low" }).play!;
    // "at the 40" says no half: the reader never guesses one (the ledger and R37 place it).
    expect(play).toMatchObject({ seqStart: 0, seqEnd: 1, down: null, offense: "home", confidence: 0.4, endSpot: { yardLine: 40, territory: "unknown" }, updates: "" });
    expect(play.evidence.split(" ").length).toBeLessThanOrEqual(20);
    expect(play.summary).toBe("CASTELLANE to TAFITA pass");
    expect(map({ playType: "pass_complete", passerIdx: idx("H7-CASTELLANE"), receiverIdx: idx("H3-TAFITA"), tacklerIdx: idx("A17-QUILLON"), yardsSaid: 9 }).play!.summary).toBe("CASTELLANE to TAFITA 9 yd pass, brought down by QUILLON");
  });
});
