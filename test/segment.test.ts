import { describe, expect, it } from "vitest";
import { parseContextFor, parseLine, type ParsedLine } from "@/lib/livestats/parse";
import { PENALTY_HOLD_MS, PLAY_TIMEOUT_MS, POST_LINES, RESULT_SILENCE_MS, Segmenter, segmentNameHits, SWEEP_MS, type PlaySegment } from "@/lib/livestats/segment";
import { ROSTER, TEAMS } from "./parse/roster";

// The play segmenter (v7, Part 3) on made-up broadcasts: ten plays with
// their calls, a flag, a replay, a hurry-up with no calls, a booth that never
// says the down for three plays, and the sweep for a quiet line that names a
// player. Synthetic names only.

const context = parseContextFor(ROSTER, TEAMS, "home");
const START = 1_800_000_000_000;

/** A booth: say a line `ms` after the last, tick the clock, and collect what closes. */
function booth() {
  const segmenter = new Segmenter();
  let at = START;
  let seq = 0;
  const closed: PlaySegment[] = [];
  const said: ParsedLine[] = [];
  return {
    segmenter,
    closed,
    said,
    say(text: string, ms = 2_000) {
      at += ms;
      const line = parseLine(text, context, seq++);
      said.push(line);
      closed.push(...segmenter.push(line, at));
      return line;
    },
    wait(ms: number) {
      // The live screen's timer, every two seconds.
      const until = at + ms;
      while (at < until) {
        at = Math.min(until, at + 2_000);
        closed.push(...segmenter.tick(at));
      }
    },
    finish() {
      closed.push(...segmenter.finish(at));
    },
    get now() {
      return at;
    },
  };
}

const text = (segment: PlaySegment) => segment.lines.map((line) => line.text);

describe("ten plays with their down and distance calls", () => {
  it("makes one segment per play, each with its call before it and the next call after it", () => {
    const b = booth();
    const plays = [
      ["first and 10 at the 25", "castellane hands it off to fennimore up the middle picks up 4", "brought down by quillon"],
      ["second and 6 from the 29", "castellane drops back fires one to tafita", "hauls it in at the 41 for a first down"],
      ["first and 10 from the 41", "fennimore off the right side", "stuffed at the line by amesbury no gain"],
      ["second and 10", "castellane throws over the middle", "incomplete broken up by brown"],
      ["third and 10 at the 41", "castellane scrambles out to his right and gets to the 46", "pushed out of bounds by grenville"],
      ["fourth and 5", "duarte punts it away", "fair caught by brown at the 20"],
      ["first and 10 bulldogs ball at their own 20", "langan hands off to amesbury", "amesbury picks up 7 brought down by okonkwo reyes"],
      ["second and 3 from the 27", "langan keeps it himself", "wrapped up by quillon at the 30"],
      ["first and 10 from the 30", "langan fires deep for ndiaye hall", "caught at the 48 and brought down there"],
      ["first and 10 at the 48", "amesbury takes the handoff bounces outside", "touchdown bulldogs"],
    ];
    for (const [call, play, result] of plays) {
      b.say(call, 6_000);
      b.say(play);
      b.say(result);
    }
    b.say("first and 10", 6_000);
    expect(b.closed).toHaveLength(10);
    b.closed.forEach((segment, index) => {
      const [, play, result] = plays[index];
      expect(text(segment), `play ${index + 1}`).toEqual([play, result]);
      expect(segment.ddBefore, `play ${index + 1} call`).not.toBeNull();
      // Three seconds of silence after the result closes it; a call sooner would.
      expect(["dd", "result"]).toContain(segment.closedBy);
      expect(segment.preLines.map((line) => line.text)).toContain(plays[index][0]);
      // The next call is a post line of this play.
      expect(segment.postLines[0]?.dd).not.toBeNull();
    });
    expect(b.closed[0].ddBefore).toMatchObject({ down: 1, distance: 10 });
    expect(b.closed[0].spotBefore).toMatchObject({ yardLine: 25 });
    expect(b.closed[6].ddBefore).toMatchObject({ down: 1, distance: 10 });
    expect(b.closed[9].cues).toMatchObject({ rush: true, touchdown: true });
    expect(segmentNameHits(b.closed[6]).map((hit) => hit.playerId)).toContain("A32-AMESBURY");
  });

  it("gives each segment a stable id from its lines, and a different one to a second segment on the same lines", () => {
    const b = booth();
    b.say("second and 6");
    b.say("fennimore up the middle for 3");
    b.say("third and 3", 4_000);
    expect(b.closed[0].id).toBe("seg-1-1");
    expect(b.closed[0].lineStart).toBe(1);
    expect(b.closed[0].lineEnd).toBe(1);
  });
});

describe("a result and silence", () => {
  it("closes the play three seconds after the result cue when no call follows", () => {
    const b = booth();
    b.say("third and 4");
    b.say("castellane keeps it himself");
    b.say("brought down by quillon at the 33");
    expect(b.closed).toHaveLength(0);
    b.wait(RESULT_SILENCE_MS - 1_000);
    expect(b.closed).toHaveLength(0);
    b.wait(2_000);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].closedBy).toBe("result");
    expect(text(b.closed[0])).toEqual(["castellane keeps it himself", "brought down by quillon at the 33"]);
  });

  it("keeps a line said within the silence as part of the play", () => {
    const b = booth();
    b.say("castellane keeps it himself");
    b.say("brought down by quillon");
    b.say("at the 33 that is a gain of 6", 1_500);
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(text(b.closed[0])).toHaveLength(3);
  });

  it("closes a play with no result twelve seconds after its first play word", () => {
    const b = booth();
    b.say("castellane hands it off to fennimore");
    b.say("he is looking for room", 3_000);
    b.wait(PLAY_TIMEOUT_MS);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].closedBy).toBe("timeout");
  });
});

describe("a flag", () => {
  it("keeps the play open so the flag and the foul attach to it", () => {
    const b = booth();
    b.say("second and 8");
    b.say("castellane throws to tafita hauls it in at the 40");
    b.say("brought down there");
    b.say("but there is a flag on the play", 2_000);
    b.say("holding number 72 that will bring it back", 5_000);
    expect(b.closed).toHaveLength(0);
    b.wait(PENALTY_HOLD_MS);
    expect(b.closed).toHaveLength(1);
    expect(text(b.closed[0])).toContain("holding number 72 that will bring it back");
    expect(b.closed[0].cues.penalty).toBe(true);
  });

  it("a flag with no play is a segment of its own", () => {
    const b = booth();
    b.say("first and 10");
    b.say("false start on the offense that will cost them 5", 4_000);
    b.say("first and 15", 5_000);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].cues).toMatchObject({ penalty: true, rush: false, pass: false });
  });
});

describe("a replay", () => {
  it("attaches the replay talk to the play before it as post lines and starts no play", () => {
    const b = booth();
    b.say("third and 2");
    b.say("fennimore takes the handoff up the middle");
    b.say("brought down by quillon short of the marker");
    b.say("let's look at that again", 2_000);
    b.say("he takes the handoff and cuts to his left", 2_000);
    b.say("and quillon comes off his block to make the stop", 2_000);
    b.say("fourth and 1", 6_000);
    expect(b.closed).toHaveLength(1);
    const [play] = b.closed;
    expect(play.closedBy).toBe("replay");
    expect(play.postLines.map((line) => line.text)).toEqual([
      "let's look at that again",
      "he takes the handoff and cuts to his left",
      "and quillon comes off his block to make the stop",
      "fourth and 1",
    ]);
    expect(play.postLines.length).toBeLessThanOrEqual(POST_LINES);
  });

  it("ends the replay span at the next call, which starts the next play as usual", () => {
    const b = booth();
    b.say("second and 5");
    b.say("castellane throws to brown incomplete");
    b.say("on the replay you can see the ball was tipped", 4_000);
    b.say("third and 5", 3_000);
    b.say("castellane hands off to fennimore", 2_000);
    b.say("brought down by quillon");
    b.say("fourth and 2", 5_000);
    expect(b.closed).toHaveLength(2);
    expect(text(b.closed[1])).toEqual(["castellane hands off to fennimore", "brought down by quillon"]);
  });
});

describe("a hurry-up with no down and distance calls", () => {
  it("starts the next play at the next snap after a result", () => {
    const b = booth();
    b.say("castellane from the shotgun throws to tafita complete at the 40");
    b.say("brought down by brown");
    b.say("no huddle castellane takes the snap and fires to vantree", 2_500);
    b.say("caught and he is down at the 30", 1_500);
    b.say("they line up again and castellane spikes it", 2_500);
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(b.closed.map(text)).toEqual([
      ["castellane from the shotgun throws to tafita complete at the 40", "brought down by brown"],
      ["no huddle castellane takes the snap and fires to vantree", "caught and he is down at the 30"],
      ["they line up again and castellane spikes it"],
    ]);
    expect(b.closed[0].closedBy).toBe("snap");
  });

  it("starts the next play at a new carry a second or more after a result", () => {
    const b = booth();
    b.say("fennimore up the middle for 3 brought down by quillon");
    b.say("fennimore again this time off the left side for 6", 2_000);
    b.say("tackled by grenville", 1_000);
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(b.closed.map(text)).toEqual([["fennimore up the middle for 3 brought down by quillon"], ["fennimore again this time off the left side for 6", "tackled by grenville"]]);
  });
});

describe("a booth that never says the down for three plays", () => {
  it("still cuts three plays, by their results and the silence between them", () => {
    const b = booth();
    b.say("fennimore up the middle picks up 4 brought down by quillon");
    b.say("castellane throws incomplete intended for tafita", 7_000);
    b.say("castellane keeps it and is stopped at the line by amesbury", 7_000);
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(b.closed).toHaveLength(3);
    expect(b.closed.every((segment) => segment.ddBefore === null)).toBe(true);
    expect(b.closed.every((segment) => segment.closedBy === "result")).toBe(true);
  });
});

describe("the sweep", () => {
  it("sweeps a line that names a player but opened no play, fifteen seconds on", () => {
    const b = booth();
    b.say("first and 10");
    b.say("fennimore");
    b.say("yes sir", 2_000);
    b.wait(SWEEP_MS - 4_000);
    expect(b.closed).toHaveLength(0);
    b.wait(4_000);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0]).toMatchObject({ closedBy: "sweep", lineStart: 1, lineEnd: 1 });
    expect(b.closed[0].ddBefore).toMatchObject({ down: 1, distance: 10 });
  });

  it("does not sweep a line that became a play's own", () => {
    const b = booth();
    b.say("fennimore");
    b.say("takes the handoff for 5", 3_000);
    b.say("second and 5", 5_000);
    b.wait(SWEEP_MS + 1_000);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].closedBy).toBe("dd");
  });

  it("ignores talk that is not football", () => {
    const b = booth();
    b.say("the valley credit union reminds you to open an account today");
    b.say("great night for football", 2_000);
    b.wait(SWEEP_MS + 5_000);
    b.finish();
    expect(b.closed).toHaveLength(0);
  });
});

describe("End game", () => {
  it("closes what is open and sweeps what was named", () => {
    const b = booth();
    b.say("castellane hands off to fennimore");
    b.finish();
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].closedBy).toBe("finish");
    expect(b.segmenter.isOpen()).toBe(false);
  });
});

describe("the POST window (fix 1, Part 1)", () => {
  const post = (segment: PlaySegment) => segment.postLines.map((line) => line.text);

  it("takes the lines after the play, the next down-and-distance call last, and nothing of the next play's pre-snap talk", () => {
    const b = booth();
    b.say("castellane keeps it himself");
    b.say("brought down by quillon");
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(b.closed).toHaveLength(1);
    expect(b.closed[0].postClosedAt).toBeNull();
    b.say("a nice gain there");
    b.say("second and 5");
    b.say("fennimore lined up deep");
    expect(post(b.closed[0])).toEqual(["a nice gain there", "second and 5"]);
    expect(b.closed[0].postClosedAt).not.toBeNull();
  });

  it("closes at a snap", () => {
    const b = booth();
    b.say("fennimore up the middle brought down by quillon");
    b.wait(RESULT_SILENCE_MS + 1_000);
    b.say("what a stop");
    b.say("castellane in the shotgun hands off to fennimore");
    b.say("tafita with the block");
    expect(post(b.closed[0])).toEqual(["what a stop"]);
    expect(b.closed[0].postClosedAt).not.toBeNull();
  });

  it("stays open until a call, a snap or a later segment, at most POST_LINES lines", () => {
    const b = booth();
    b.say("fennimore up the middle brought down by quillon");
    b.wait(RESULT_SILENCE_MS + 1_000);
    for (const line of ["what a stop", "that is quillon again", "big crowd tonight", "the band is playing", "cold one out here", "lots of noise"]) b.say(line);
    expect(b.closed[0].postClosedAt).toBeNull();
    expect(b.closed[0].postLines).toHaveLength(POST_LINES);
    b.say("castellane hands off to fennimore");
    b.say("brought down by grenville");
    b.wait(RESULT_SILENCE_MS + 1_000);
    expect(b.closed).toHaveLength(2);
    expect(b.closed[0].postClosedAt).not.toBeNull();
  });
});
