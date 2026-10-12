import { describe, expect, it } from "vitest";
import { checkPlay } from "@/lib/livestats/check";
import { MIN_METAPHONE_CODE, nameIndex, namedHow, soundAlike, soundAlikeEdits, soundsOf } from "@/lib/livestats/names";
import { EMPTY_SESSION, okPlay, readPlays } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// Names that sound alike (fix 6, Part 4b): a word whose double-metaphone code
// is within one edit of the surname's names the player, and a return by the
// side's last returner is named enough. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H30-VENRO", side: "home", jersey: "30", first: "Ike", last: "Venro", position: "RB" },
  { playerId: "H3-VANTREE", side: "home", jersey: "3", first: "Cole", last: "Vantree", position: "WR" },
  { playerId: "H2-LEE", side: "home", jersey: "2", first: "Jin", last: "Lee", position: "CB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A22-QUILLEN", side: "away", jersey: "22", first: "Dale", last: "Quillen", position: "RB" },
  { playerId: "A80-HOLLINGWADE", side: "away", jersey: "80", first: "Ned", last: "Hollingwade", position: "WR" },
];
const INDEX = nameIndex(ROSTER);
const who = (id: string) => ROSTER.find((player) => player.playerId === id)!;

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function play(seqStart: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd: seqStart,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "kickoff",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: "",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}

describe("sound-alikes", () => {
  it("passes a word whose code is within one edit of the surname's, with the same first sound", () => {
    expect(soundsOf("Hollingwade")).toEqual(["HLNKT"]);
    // "holencoat" spells nothing like Hollingwade (four letters off) and sounds just like it.
    expect(soundAlike(who("A80-HOLLINGWADE"), "holencoat", INDEX)).toBe(true);
    expect(namedHow(who("A80-HOLLINGWADE"), "returned by holencoat to the 30", INDEX)).toBe("sound");
    // A close spelling is named as a spelling first.
    expect(namedHow(who("A80-HOLLINGWADE"), "returned by hollingway to the 30", INDEX)).toBe("spelling");
    // A surname split in two is a form already; split and misspelled, the pair sounds like it.
    expect(namedHow(who("H3-VANTREE"), "van tree brings it out", INDEX)).toBe("form");
    expect(namedHow(who("H3-VANTREE"), "van trea brings it out", INDEX)).toBe("sound");
    // Two ordinary words that happen to sound like a surname do not.
    expect(namedHow(who("A80-HOLLINGWADE"), "holding way back there", INDEX)).toBeNull();
  });

  it("does not pass a word as close to another player, nor a short code, nor a different first sound", () => {
    // "quillin" sounds like both Quillon and Quillen: neither is named.
    expect(soundAlike(who("A17-QUILLON"), "quillin", INDEX)).toBe(false);
    expect(soundAlike(who("A22-QUILLEN"), "quillin", INDEX)).toBe(false);
    // "Lee" is one sound: too short to mean anyone.
    expect(soundsOf("Lee")).toEqual([]);
    expect(soundAlike(who("H2-LEE"), "li", INDEX)).toBe(false);
    expect(MIN_METAPHONE_CODE).toBe(3);
    // A three-sound surname needs its code exactly; a longer one allows one edit.
    expect(soundAlikeEdits("FNR")).toBe(0);
    expect(soundAlikeEdits("HLNKT")).toBe(1);
    expect(soundAlike(who("H30-VENRO"), "venroe", INDEX)).toBe(true);
    expect(soundAlike(who("H30-VENRO"), "fenway", INDEX)).toBe(false);
    // "barlew" is a different word from a surname starting with another sound.
    expect(soundAlike(who("A80-HOLLINGWADE"), "bollingwade", INDEX)).toBe(false);
  });

  it("the check keeps a credit named only by sound, and says so", () => {
    const checked = checkPlay(play(1, [ev("A80-HOLLINGWADE", "kick_return", 24)]), ROSTER, { qbs: { home: "H7-CASTELLANE", away: null }, lines: "holencoat takes it out to the 30" });
    expect(checked.play.events.map((event) => event.playerId)).toEqual(["A80-HOLLINGWADE"]);
    expect(checked.notes).toEqual([expect.objectContaining({ rule: "R18", kind: "restored", reason: "named by a sound-alike of the surname" })]);
    const dropped = checkPlay(play(1, [ev("A80-HOLLINGWADE", "kick_return", 24)]), ROSTER, { qbs: { home: "H7-CASTELLANE", away: null }, lines: "somebody takes it out to the 30" });
    expect(dropped.play.events).toEqual([]);
  });

  it("the same returner as the side's last return is named enough on the next return", () => {
    const first = play(1, [ev("A80-HOLLINGWADE", "kick_return", 24)]);
    const read = readPlays(EMPTY_SESSION, [first], ROSTER, 1000, { utterances: [{ seq: 1, text: "hollingwade takes it out to the 30" }] });
    const session = okPlay(read.session, 1001, read.added[0].playId).session;
    const second = play(9, [ev("A80-HOLLINGWADE", "kick_return", 18)]);
    const later = readPlays(session, [second], ROSTER, 2000, { utterances: [{ seq: 1, text: "hollingwade takes it out to the 30" }, { seq: 9, text: "the return goes out to the 22" }] });
    expect(later.added[0].play.events.map((event) => event.playerId)).toEqual(["A80-HOLLINGWADE"]);
    expect(later.added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R18", kind: "restored", reason: "the same returner as this side's last return" }));
    // Another returner, unnamed, is still dropped.
    const other = readPlays(session, [play(9, [ev("A22-QUILLEN", "kick_return", 18)])], ROSTER, 2000, { utterances: [{ seq: 9, text: "the return goes out to the 22" }] });
    expect(other.added[0].play.events).toEqual([]);
  });
});
