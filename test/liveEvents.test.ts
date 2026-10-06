import { describe, expect, it } from "vitest";
import { sanitizeProps, scoreBucket } from "@/lib/analytics/events";
import { endedEventProps, EMPTY_COUNTS } from "@/lib/game/liveCounts";
import { cardRemovedProps, cueOf, matchOf } from "@/lib/game/liveEvents";
import type { WrongShape } from "@/lib/matching/SpotterEngine";

// names.card_removed and the other live-screen events, as they reach app_events.
// Codes and counts only: the privacy filter must keep every prop, because a
// prop it drops is a metric silently missing.

const name: WrongShape = {
  kind: "name",
  cue: null,
  score: 0.88,
  threshold: 0.85,
  confidence: 0.9,
  cards: 1,
  digits: null,
  sound: false,
  matchesBefore: 12,
};
const number: WrongShape = { ...name, kind: "number", cue: "team", score: 0.9, digits: 1 };

describe("names.card_removed", () => {
  it("says which cue put the card up", () => {
    expect(cueOf(name)).toBe("name");
    expect(cueOf(number)).toBe("number_team");
    expect(cueOf({ ...number, cue: "explicit" })).toBe("number_explicit");
    expect(cueOf({ ...number, cue: "surname" })).toBe("number_surname");
  });

  it("calls a name exact only when it scored 1, and a number near only when it was heard as words", () => {
    expect(matchOf(name)).toBe("near");
    expect(matchOf({ ...name, score: 1 })).toBe("exact");
    expect(matchOf(number)).toBe("exact");
    expect(matchOf({ ...number, sound: true })).toBe("near");
  });

  it("buckets the score against the thresholds", () => {
    expect([0.6, 0.85, 0.92, 0.97, 1].map(scoreBucket)).toEqual([
      "under_0_85",
      "0_85_to_0_9",
      "0_9_to_0_95",
      "0_95_to_1",
      "exact",
    ]);
  });

  it("carries key, cue, match, score bucket, cards on screen and seconds since shown, all past the privacy filter", () => {
    const props = cardRemovedProps(name, "2", 3, 4.6);
    expect(props).toEqual({
      key: "2",
      cue: "name",
      match: "near",
      score_bucket: "0_85_to_0_9",
      cards_on_screen: 3,
      seconds_since_shown: 5,
    });
    expect(sanitizeProps("names.card_removed", props)).toEqual(props);
  });

  it("has nothing in it that says who: only these six keys, and every string one of its declared codes", () => {
    const props = cardRemovedProps(number, "x", 1, null);
    expect(Object.keys(props).sort()).toEqual(
      ["cards_on_screen", "cue", "key", "match", "score_bucket", "seconds_since_shown"].sort(),
    );
    // A string that is not a declared enum would be dropped; none is.
    const strings = Object.entries(props).filter(([, value]) => typeof value === "string");
    expect(Object.keys(sanitizeProps("names.card_removed", Object.fromEntries(strings)))).toHaveLength(strings.length);
  });
});

describe("the other live-screen events", () => {
  it("game.started keeps its sport and counts", () => {
    const props = { sport: "football", stats: false, setup_warnings: 2, keyterms: 88 };
    expect(sanitizeProps("game.started", props)).toEqual(props);
  });

  it("game.started drops a sport that is not one of Spotter's", () => {
    expect(sanitizeProps("game.started", { sport: "Brentwood" })).toEqual({});
  });

  it("game.ended keeps every count, with a null latency simply left out", () => {
    const props = endedEventProps(EMPTY_COUNTS, new Date(0), new Date(60_000));
    const kept = sanitizeProps("game.ended", props);
    expect(Object.keys(kept)).toEqual(Object.keys(props).filter((key) => props[key as keyof typeof props] !== null));
  });

  it("mic and refresh events are counts only", () => {
    expect(sanitizeProps("game.mic_started", { seconds: 0 })).toEqual({ seconds: 0 });
    expect(sanitizeProps("game.mic_stopped", { seconds: 61, total_seconds: 300 })).toEqual({ seconds: 61, total_seconds: 300 });
    expect(sanitizeProps("names.roster_refreshed", { changes: 2 })).toEqual({ changes: 2 });
  });
});
