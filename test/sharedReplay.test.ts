import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readReplayLog, ReplayLogError } from "@/lib/livestats/replayLog";
import type { StoredRecord } from "@/lib/log/records";
import { SCRUB_VERSION, toSharedLog } from "@/lib/log/scrub";
import { REPLAYABLE_SCRUB_VERSION, replayableLog, sharedLogProblem, tagWord } from "@/lib/log/sharedReplay";
import { compileWatchlist, phoneticKeys, scoreAgainst } from "@/lib/matching/matcher";
import { CardLogError, checkCards, logRecords, replayCards, type CardFrame } from "@/lib/replay/cardEquality";

// A shared game log replays (scrub 3, Oct 12): the copy that reaches
// shared_game_logs, first names and schools as tags, runs through the real
// card path and the stats replay, and puts up the same cards as the log it was
// scrubbed from. That is what makes a shared log worth collecting. The game is
// test/fixtures/g5-synthetic-log.json: made-up schools, made-up players, a
// team cue ("harborview 22", the school as [HOME1]), a takedown and a Refresh rosters.

const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, "fixtures/g5-synthetic-log.json"), "utf8")) as {
  records: StoredRecord[];
};

const shared = toSharedLog(FIXTURE.records).log;
/** The scrub makes every time an offset from the first record's. */
const START = FIXTURE.records[0].at as number;
const shifted = (frames: CardFrame[]) => frames.map((frame) => ({ ...frame, at: frame.at - START }));

describe("a shared log replays", () => {
  it("is a log the scrub wrote at a version that can replay", () => {
    expect(shared.scrubVersion).toBe(SCRUB_VERSION);
    expect(SCRUB_VERSION).toBeGreaterThanOrEqual(REPLAYABLE_SCRUB_VERSION);
  });

  it("puts up exactly the cards the unscrubbed log does, frame for frame", async () => {
    const original = await replayCards(logRecords(FIXTURE), { stats: false });
    const copy = await replayCards(logRecords(JSON.parse(JSON.stringify(shared))), { stats: false });
    expect(copy.frames.length).toBeGreaterThan(8);
    expect(copy.frames).toEqual(shifted(original.frames));
    expect(copy.unplacedTakedowns).toBe(0);
  });

  it("hears a team cue where the school's name was masked", async () => {
    // "first and ten harborview at ...": the school became [HOME1] in the words and in the cue list alike.
    const records = logRecords(shared);
    const game = records.find((record) => record.kind === "game") as { snapshot: { teamCues: Array<{ words: string[] }> } };
    expect(game.snapshot.teamCues.flatMap((cue) => cue.words)).toContain(tagWord("[HOME1]"));
    const text = JSON.stringify(records);
    expect(text).not.toContain("harborview");
    expect(text).toContain(tagWord("[HOME1]"));
  });

  it("passes G5 too: with stats off and on, the same cards", async () => {
    const check = await checkCards(shared);
    expect(check.equal).toBe(true);
    expect(check.on.stats!.playsRead).toBeGreaterThan(2);
  });

  it("gives live stats' replay the same rosters and every line said", () => {
    const original = readReplayLog(FIXTURE);
    const copy = readReplayLog(shared);
    expect(copy.rosters.map((roster) => roster.players.map((player) => player.playerId))).toEqual(
      original.rosters.map((roster) => roster.players.map((player) => player.playerId)),
    );
    expect(copy.utterances.map((said) => said.seq)).toEqual(original.utterances.map((said) => said.seq));
    expect(copy.home).toBe(tagWord("[HOME1]"));
  });
});

describe("tags as words", () => {
  it("is letters only, the same every time, and unlike any other tag's", () => {
    expect(tagWord("[H22]")).toBe(tagWord("[H22]"));
    const tags = ["[H2]", "[H22]", "[H23]", "[A2]", "[H4|A18]", "[HOME1]", "[HOME2]", "[AWAY1]", "[name]", "[H?]"];
    const words = tags.map(tagWord);
    for (const word of words) expect(word).toMatch(/^[a-z]{10}$/);
    expect(new Set(words).size).toBe(tags.length);
  });

  it("does not let one first-name tag score as another", () => {
    // Two players called Sanders, first names [H2] and [H23]: the word for one must not narrow to the other.
    const [h2, h23] = [tagWord("[H2]"), tagWord("[H23]")];
    const first = compileWatchlist([{ name: h2, aliases: [] }])[0];
    const { score, minScore } = scoreAgainst(h23, phoneticKeys(h23), first);
    expect(score).toBeLessThan(minScore);
  });

  it("leaves a downloaded log alone, and refuses a shared log scrubbed before rosters were kept", () => {
    expect(replayableLog(FIXTURE)).toBe(FIXTURE);
    const old = { format: "spotter-v3-shared-log", scrubVersion: 2, records: [] };
    expect(sharedLogProblem(old)).toContain("version 2");
    expect(() => logRecords(old)).toThrow(CardLogError);
    expect(() => readReplayLog(old)).toThrow(ReplayLogError);
  });
});
