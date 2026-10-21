import { describe, expect, it } from "vitest";
import { lineText } from "@/lib/cards/lines";
import { counted } from "@/lib/livestats/session";
import { answer, idxOf, playText, START, started } from "./v7Harness";

// The v7 loop end to end (Oct 20): finals parsed and segmented on the hot
// path, each closed segment read through the fake route, the answer mapped,
// checked and counted, the yards solved and back-filled, the second look, the
// cost cap, the latency, the log, and a reload. Synthetic names.

/** Answers the two plays of the opening drive by what the segment says. */
const openingDrive = (request: Parameters<typeof idxOf>[0]) => {
  const text = playText(request);
  if (text.includes("fennimore")) return answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), tacklerIdx: idxOf(request, "A17-QUILLON"), yardsSaid: text.includes("picks up 6") ? 6 : null });
  if (text.includes("tafita")) return answer({ playType: "pass_complete", passerIdx: idxOf(request, "H7-CASTELLANE"), receiverIdx: idxOf(request, "H3-TAFITA"), yardsSaid: 14 });
  return answer({ playType: "not_a_play" });
};

describe("reading a play", () => {
  it("reads the segment the moment its call closes it, counts the play, and puts it on the cards", async () => {
    const h = await started({ answerer: openingDrive });
    h.say("sharks ball first and 10 at their own 25");
    h.say("castellane hands off to fennimore up the middle picks up 6");
    h.say("brought down by quillon");
    expect(h.requests).toHaveLength(0);
    h.say("second and 4 from the 31", 6_000);
    await h.settle();

    expect(h.requests).toHaveLength(1);
    const [request] = h.requests;
    expect(request.look).toBe("segment");
    expect(request.segment.lines.map((line) => `${line.role}:${line.seq}`)).toEqual(["pre:0", "play:1", "play:2", "post:3"]);
    expect(request.segment.dd).toEqual({ down: 1, distance: 10, isGoal: false });
    expect(request.candidates.map((candidate) => candidate.playerId)).toEqual(["H7-CASTELLANE", "H22-FENNIMORE", "A17-QUILLON", null]);
    expect(request.gameState).toMatchObject({ teams: { home: "Harborview", away: "Millbrook" }, offense: "home", down: 1, distance: 10, qbs: { home: "H7-CASTELLANE", away: "A9-LANGAN" } });
    expect(request.budget).toEqual({ spentUsd: 0, maxCostUsd: null });

    const view = h.controller.getView();
    expect(counted(view.session).map((play) => play.playId)).toEqual(["1-2"]);
    const lines = h.controller.bridge.lines();
    expect(lineText(lines.get("H22-FENNIMORE")?.tonight ?? [])).toBe("1 car · 6 yds");
    expect(lineText(lines.get("A17-QUILLON")?.tonight ?? [])).toBe("1 tkl");
    expect(h.controller.bridge.counts()).toMatchObject({ playsApplied: 1, pipeline: "v7", tokensIn: 2_600, tokensOut: 40, tokensCached: 2_500 });
    expect(h.controller.latencies()).toHaveLength(1);
    expect(h.controller.latencies()[0]).toBeGreaterThanOrEqual(6);
    expect(h.tracked.find((event) => event.name === "stats.play_applied")?.props).toMatchObject({ play_type: "run", yards_stated: 1 });
  });

  it("records each request exactly as it was sent, with its answer and the play it became, only when asked", async () => {
    const h = await started({ answerer: openingDrive, recordDetail: true });
    h.say("sharks ball first and 10 at their own 25");
    h.say("castellane hands off to fennimore up the middle picks up 6");
    h.say("brought down by quillon");
    h.say("second and 4 from the 31", 6_000);
    await h.wait(10_000);
    const [detail] = h.controller.segmentDetail();
    const [request] = h.requests;
    expect(detail).toMatchObject({ segmentId: request.segment.id, look: "segment", lines: request.segment.lines, reconciled: { playType: "rush" }, failed: null, playId: "1-2" });
    expect(detail.candidates).toEqual(request.candidates.map(({ idx, playerId, label, score, tags }) => ({ idx, playerId, label, score, tags })));
    expect(detail.gameState).toMatchObject({ offense: request.gameState.offense, down: 1, distance: 10 });
    const quiet = await started({ answerer: openingDrive });
    quiet.say("castellane hands off to fennimore up the middle picks up 6");
    quiet.say("second and 4", 6_000);
    await quiet.wait(10_000);
    expect(quiet.requests.length).toBeGreaterThan(0);
    expect(quiet.controller.segmentDetail()).toEqual([]);
  });

  it("logs the reply with the segment, the agreement and the answer, then the play", async () => {
    const h = await started({ answerer: openingDrive });
    h.say("first and 10");
    h.say("fennimore up the middle picks up 6 brought down by quillon");
    h.say("second and 4", 6_000);
    await h.settle();
    const reply = h.logged.find((record) => record.kind === "stats_reply")!;
    expect(reply).toMatchObject({ ok: true, seqFrom: 1, seqTo: 1, segmentId: "seg-1-1", agreement: "agree", tokensIn: 2_600, answer: { playType: "rush" } });
    expect(h.logged.map((record) => record.kind)).toEqual(["stats_reply", "stats_play", "stats_decision"]);
    expect(JSON.stringify(h.tracked).toLowerCase()).not.toMatch(/fennimore|quillon/);
  });

  it("keeps the hot path synchronous: heard() returns before the route is asked, and one segment is read at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const h = await started({
      answerer: (request) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        inFlight -= 1;
        return openingDrive(request);
      },
    });
    h.say("first and 10");
    h.say("fennimore up the middle picks up 6 brought down by quillon");
    h.say("second and 4", 6_000);
    h.say("castellane throws to tafita hauls it in at the 45 for 14", 1_000);
    h.say("first down sharks", 1_000);
    h.say("first and 10 at the 45", 6_000);
    // heard() never awaited anything: both segments are queued, not read, until the loop turns.
    await h.settle();
    expect(h.requests).toHaveLength(2);
    expect(most).toBe(1);
    expect(counted(h.controller.getView().session)).toHaveLength(2);
  });
});

describe("the yards", () => {
  it("works out a gain nobody said from the next down and distance, with the ~", async () => {
    const h = await started({ answerer: openingDrive });
    h.say("first and 10 at the 25");
    h.say("fennimore up the middle");
    h.say("brought down by quillon");
    h.say("second and 4 from the 31", 6_000);
    await h.settle();
    // The call that closed the play is this play's next facts: 10 - 4 is 6.
    const play = h.controller.getView().session.plays[0];
    expect(play.play.events[0]).toMatchObject({ playerId: "H22-FENNIMORE", yards: 6, yardsSource: "downs" });
    expect(play.dropped).toContainEqual(expect.objectContaining({ rule: "R47", kind: "changed" }));
    expect(lineText(h.controller.bridge.lines().get("H22-FENNIMORE")?.tonight ?? [])).toBe("1 car · ~6 yds");
    expect(h.logged.filter((record) => record.kind === "stats_update")).toHaveLength(1);
  });

  it("never replaces a stated number", async () => {
    const h = await started({ answerer: openingDrive });
    h.say("first and 10 at the 25");
    h.say("fennimore up the middle picks up 6");
    h.say("brought down by quillon");
    h.say("second and 7", 6_000);
    await h.settle();
    expect(h.controller.getView().session.plays[0].play.events[0]).toMatchObject({ yards: 6, yardsSource: "stated" });
  });
});

describe("the second look", () => {
  it("asks once more about a segment answered not_a_play when a candidate was named clearly, and reads what comes back", async () => {
    const h = await started({
      answerer: (request) => (request.look === "second" ? answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), yardsSaid: 3 }) : answer({ playType: "not_a_play" })),
    });
    h.say("second and 4");
    h.say("fennimore again this time for 3");
    h.say("third and 1", 6_000);
    await h.settle();
    expect(h.requests.map((request) => request.look)).toEqual(["segment", "second"]);
    expect(h.requests[1].segment.id).toBe(h.requests[0].segment.id);
    const play = h.controller.getView().session.plays[0];
    expect(play.status).toBe("applied");
    expect(play.dropped).toContainEqual(expect.objectContaining({ rule: "R38", kind: "noted" }));
    expect(h.controller.bridge.counts().secondLooks).toBe(1);
  });

  it("takes no second look when nobody was named clearly, or when the answer credited someone", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }) });
    h.say("first and 10");
    h.say("they hand it off and it's stuffed at the line");
    h.say("second and 10", 6_000);
    await h.settle();
    expect(h.requests.map((request) => request.look)).toEqual(["segment"]);
  });
});

describe("the cost cap", () => {
  it("rides on every request, and stops the optional calls once spent", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }), maxCostUsd: 0.0025, costPerCall: 0.001 });
    h.say("first and 10");
    h.say("fennimore up the middle for 3");
    h.say("second and 7", 6_000);
    await h.settle();
    h.say("fennimore again for 2", 2_000);
    h.say("third and 5", 6_000);
    await h.settle();
    // The first segment got its second look; the second, over the cap, did not.
    expect(h.requests.map((request) => request.look)).toEqual(["segment", "second", "segment"]);
    expect(h.requests[2].budget).toEqual({ spentUsd: 0.002, maxCostUsd: 0.0025 });
    expect(h.controller.bridge.counts().costUsd).toBeCloseTo(0.003, 6);
  });
});

describe("failures and the switch", () => {
  it("pauses on a failed read and says why, then goes on with the next segment", async () => {
    let failOnce = true;
    const h = await started({
      answerer: (request) => {
        if (failOnce) {
          failOnce = false;
          return "fail";
        }
        return openingDrive(request);
      },
    });
    h.say("first and 10");
    h.say("fennimore up the middle picks up 6 brought down by quillon");
    h.say("second and 4", 6_000);
    await h.settle();
    expect(h.controller.getView().loop).toEqual({ kind: "paused", code: "claude_timeout" });
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_reply", ok: false, code: "claude_timeout", seqFrom: 1, seqTo: 1 });
    h.say("castellane throws to tafita hauls it in for 14", 1_000);
    h.say("first and 10", 6_000);
    await h.settle();
    expect(h.controller.getView().loop).toEqual({ kind: "listening" });
    expect(counted(h.controller.getView().session)).toHaveLength(1);
  });

  it("End game closes the open segment and reads it", async () => {
    const h = await started({ answerer: openingDrive });
    h.say("second and 4");
    h.say("fennimore up the middle picks up 6");
    await h.controller.finish();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(counted(h.controller.getView().session)).toHaveLength(1);
  });
});

describe("a reload", () => {
  it("rebuilds the plays from the log and reads nothing again", async () => {
    const first = await started({ answerer: openingDrive });
    first.say("first and 10 at the 25");
    first.say("fennimore up the middle picks up 6 brought down by quillon");
    first.say("second and 4", 6_000);
    await first.settle();
    const log = [
      ...[0, 1, 2].map((seq) => ({ kind: "utterance", at: START + 2_000 * (seq + 1) + (seq === 2 ? 4_000 : 0), text: ["first and 10 at the 25", "fennimore up the middle picks up 6 brought down by quillon", "second and 4"][seq] })),
      ...first.logged,
    ];
    const again = await started({ answerer: openingDrive, log });
    expect(counted(again.controller.getView().session).map((play) => play.playId)).toEqual(["1-1"]);
    expect(again.requests).toHaveLength(0);
    again.say("castellane throws to tafita hauls it in for 14", 1_000);
    again.say("first and 10", 6_000);
    await again.settle();
    expect(again.requests).toHaveLength(1);
    expect(again.requests[0].gameState).toMatchObject({ offense: "home" });
    expect(counted(again.controller.getView().session)).toHaveLength(2);
  });
});
