import { describe, expect, it } from "vitest";
import { lineText } from "@/lib/cards/lines";
import { counted } from "@/lib/livestats/session";
import { POST_LINES, POST_WAIT_MS } from "@/lib/livestats/segment";
import { V7_QUEUE_DROPPED, V7_QUEUE_MAX } from "@/lib/livestats/v7";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
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

describe("yards from the words after the play (fix 1, Part 5)", () => {
  it("takes the gain the booth says after the result, and never one said as the next play starts", async () => {
    const h = await started({ answerer: (request) => answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE") }) });
    h.say("castellane hands it to fennimore up the middle");
    h.say("brought down by quillon", 1_500);
    h.say("that's fennimore a gain of 9", 4_000);
    await h.wait(8_000);
    const play = counted(h.controller.getView().session)[0];
    expect(play.play.events[0]).toMatchObject({ playerId: "H22-FENNIMORE", yards: 9, yardsSource: "stated" });
    // The session's late-number rule (R23) or the solver's words after the play (R47): either way the booth's number.
    expect(play.dropped.some((note) => (note.rule === "R23" || note.rule === "R47") && /after the play/.test(note.reason))).toBe(true);

    const next = await started({ answerer: (request) => (playText(request).includes("up the middle") ? answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE") }) : answer({ playType: "pass_complete", passerIdx: idxOf(request, "H7-CASTELLANE"), yardsSaid: 12 })) });
    next.say("castellane hands it to fennimore up the middle");
    next.say("brought down by quillon", 1_500);
    next.say("what a stop", 4_000);
    next.say("castellane takes the snap and fires for 12 yards", 1_000);
    await next.wait(20_000);
    expect(counted(next.controller.getView().session)).toHaveLength(2);
    const run = counted(next.controller.getView().session).find((entry) => entry.play.summary.includes("FENNIMORE"))!;
    expect(run.play.events[0].yards).toBeNull();
  });

  it("works out the gain from a down and distance said after the play, at the first read", async () => {
    const h = await started({ answerer: (request) => answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE") }) });
    h.say("first and 10 at the 25");
    h.say("castellane hands it to fennimore up the middle");
    h.say("brought down by quillon", 1_500);
    h.say("that will bring up second and 3", 4_000);
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(counted(h.controller.getView().session)[0].play.events[0]).toMatchObject({ yards: 7, yardsSource: "downs" });
  });
});

describe("yards from the play before (fix 1, item 2)", () => {
  it("takes a play's down and start from the play before when nobody said them, and its gain from the next call", async () => {
    const h = await started({
      answerer: (request) => (playText(request).includes("picks up 6") ? answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), yardsSaid: 6 }) : playText(request).includes("keeps it") ? answer({ playType: "rush", carrierIdx: idxOf(request, "H7-CASTELLANE") }) : answer({ playType: "not_a_play" })),
    });
    h.say("sharks ball first and 10 at their own 25");
    h.say("castellane hands it to fennimore up the middle picks up 6");
    h.say("brought down by quillon", 1_500);
    await h.wait(8_000);
    h.say("castellane keeps it up the middle", 4_000);
    h.say("brought down by grenville", 1_500);
    h.say("third and 1", 4_000);
    await h.settle();
    const keeper = counted(h.controller.getView().session).find((entry) => entry.play.summary.includes("CASTELLANE"))!;
    // Second and 4 from the play before, third and 1 after it: a gain of 3.
    expect(keeper.play.events[0]).toMatchObject({ playerId: "H7-CASTELLANE", yards: 3, yardsSource: "downs" });
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

describe("waiting for the POST lines (fix 1, Part 1)", () => {
  /** Credits whoever the list names Fennimore as, when he is on it. */
  const fennimoreRun = (request: SegmentRequest) => (idxOf(request, "H22-FENNIMORE") ? answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), yardsSaid: 6 }) : answer({ playType: "not_a_play" }));

  it("holds a play closed by its result until the wait runs out, and the name said after the result reaches the request and the list", async () => {
    const h = await started({ answerer: fennimoreRun });
    h.say("castellane hands it off up the middle");
    h.say("brought down by quillon");
    await h.wait(4_000);
    expect(h.requests).toHaveLength(0);
    h.say("that's the run by fennimore for 6", 1_000);
    await h.settle();
    expect(h.requests).toHaveLength(0);
    await h.wait(POST_WAIT_MS);
    expect(h.requests).toHaveLength(1);
    const [request] = h.requests;
    expect(request.segment.lines.filter((line) => line.role === "post").map((line) => line.text)).toEqual(["that's the run by fennimore for 6"]);
    expect(request.candidates.map((candidate) => candidate.playerId)).toContain("H22-FENNIMORE");
    expect(counted(h.controller.getView().session)).toHaveLength(1);
  });

  it("sends it at once when its POST lines are full, or when the next call closes the window", async () => {
    const h = await started({ answerer: fennimoreRun });
    h.say("castellane hands it off up the middle");
    h.say("brought down by quillon");
    await h.wait(4_000);
    for (let i = 0; i < POST_LINES - 1; i++) h.say(`what a crowd ${i}`, 500);
    await h.settle();
    expect(h.requests).toHaveLength(0);
    h.say("nice effort from fennimore", 500);
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].segment.lines.filter((line) => line.role === "post")).toHaveLength(POST_LINES);

    const call = await started({ answerer: fennimoreRun });
    call.say("castellane hands it off up the middle");
    call.say("brought down by quillon");
    await call.wait(4_000);
    call.say("second and 4", 500);
    await call.settle();
    // Read at once (a second look may follow it: nobody was credited).
    expect(call.requests[0].segment.lines.at(-1)).toMatchObject({ role: "post", text: "second and 4" });
    expect(call.requests.filter((request) => request.look === "segment")).toHaveLength(1);
  });

  it("End game sends what is still held", async () => {
    const h = await started({ answerer: fennimoreRun });
    h.say("castellane hands it off to fennimore up the middle");
    h.say("brought down by quillon");
    await h.wait(4_000);
    expect(h.requests).toHaveLength(0);
    await h.controller.finish();
    expect(h.requests).toHaveLength(1);
  });
});

describe("a name said before the snap (fix 1, Part 1)", () => {
  it("is on the list, tagged, and is no reason for a second look", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }) });
    h.say("second and 6");
    h.say("fennimore set deep with tafita out wide");
    h.say("they hand it off up the middle and he is stopped", 2_000);
    h.say("third and 5", 6_000);
    await h.settle();
    const first = h.requests.find((request) => request.look === "segment")!;
    expect(first.candidates.filter((candidate) => candidate.tags.includes("named before snap")).map((candidate) => candidate.playerId).sort()).toEqual(["H22-FENNIMORE", "H3-TAFITA"]);
    expect(h.requests.filter((request) => request.look === "second")).toHaveLength(0);
  });
});

describe("the queue (fix 1, Part 1)", () => {
  /** A drive that ends in a punt, answered by what each segment says; the first re-read waits until the test lets it go. */
  function blockingDrive() {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let blockedOnce = false;
    const answerer = async (request: SegmentRequest) => {
      if (request.look === "reread" && !blockedOnce) {
        blockedOnce = true;
        await blocked;
        return request.current!;
      }
      if (request.look === "reread") return request.current!;
      const text = playText(request);
      if (text.includes("punt")) return answer({ playType: "punt", carrierIdx: idxOf(request, "A2-DUARTE"), yardsSaid: 40 });
      if (text.includes("amesbury")) return answer({ playType: "rush", carrierIdx: idxOf(request, "A32-AMESBURY"), yardsSaid: 4 });
      if (text.includes("ndiaye")) return answer({ playType: "pass_complete", passerIdx: idxOf(request, "A9-LANGAN"), receiverIdx: idxOf(request, "A81-NDIAYE-HALL"), yardsSaid: 5 });
      if (text.includes("fennimore")) return answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), yardsSaid: 3 });
      return answer({ playType: "not_a_play" });
    };
    return { answerer, release: () => release() };
  }

  /** Lets the loop run without waiting for it to be idle: a re-read is held on purpose. */
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  async function driveThenPunt(h: Awaited<ReturnType<typeof started>>) {
    h.say("bulldogs ball first and 10 at their own 20");
    h.say("langan hands off to amesbury picks up 4 brought down by quillon");
    h.say("second and 6", 6_000);
    h.say("langan throws to ndiaye hall caught at the 29 gain of 5", 2_000);
    h.say("third and 1", 6_000);
    h.say("fourth and 1 and they will punt", 6_000);
    h.say("duarte punts it away 40 yards fair caught at the 31", 3_000);
    h.say("sharks ball first and 10 at the 31", 6_000);
    await flush();
  }

  it("reads the next play before the drive's re-reads, and a re-read sends the list the play was first read with", async () => {
    const drive = blockingDrive();
    const h = await started({ answerer: drive.answerer });
    await driveThenPunt(h);
    // The first re-read is in flight; the next play closes meanwhile.
    expect(h.requests.at(-1)?.look).toBe("reread");
    h.say("castellane hands off to fennimore picks up 3", 3_000);
    h.say("second and 7", 6_000);
    await flush();
    drive.release();
    await h.settle();
    const looks = h.requests.map((request) => `${request.look}:${request.segment.id}`);
    const firstReread = looks.findIndex((look) => look.startsWith("reread"));
    const nextPlay = looks.findIndex((look) => look.startsWith("segment") && h.requests[looks.indexOf(look)].segment.lines.some((line) => line.text.includes("fennimore")));
    expect(nextPlay).toBe(firstReread + 1);
    for (const reread of h.requests.filter((request) => request.look === "reread")) {
      const first = h.requests.find((request) => request.look === "segment" && request.segment.id === reread.segment.id)!;
      expect(reread.candidates).toEqual(first.candidates);
    }
  });

  it("drops the oldest re-read first when the backlog runs past the cap", async () => {
    const drive = blockingDrive();
    const h = await started({ answerer: drive.answerer });
    await driveThenPunt(h);
    const rereadIds = new Set(h.requests.filter((request) => request.look === "segment").map((request) => request.segment.id));
    for (let i = 0; i < V7_QUEUE_MAX; i++) {
      h.say(`castellane hands off to fennimore picks up ${i % 9}`, 3_000);
      h.say(`down number ${i} coming up second and 7`, 6_000);
    }
    const dropped = h.logged.filter((record) => record.kind === "stats_reply" && record.code === V7_QUEUE_DROPPED);
    expect(dropped.length).toBeGreaterThan(0);
    expect(rereadIds.has((dropped[0] as { segmentId: string }).segmentId)).toBe(true);
    drive.release();
    await h.settle();
  });
});

describe("who has the ball (fix 1, Part 3)", () => {
  it("does not let one misheard receiver flip the offense the drive already has", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }) });
    h.say("sharks ball first and 10 at their own 25");
    h.say("castellane hands it to fennimore up the middle brought down at the 29");
    h.say("second and 6", 6_000);
    h.say("over the middle complete to ndiaye hall at the 35", 6_000);
    h.say("brought down there", 1_500);
    h.say("first and 10", 6_000);
    await h.settle();
    const [first, second] = h.requests.filter((request) => request.look === "segment");
    expect(first.gameState.offense).toBe("home");
    expect(second.gameState.offense).toBe("home");
    expect(second.candidates.find((candidate) => candidate.tags.includes("prior:qb"))?.playerId).toBe("H7-CASTELLANE");
  });

  it("gives a pass credited to the other side's quarterback to the one on the field when the words said who had the ball", async () => {
    const h = await started({
      answerer: (request) => (playText(request).includes("tafita") ? answer({ playType: "pass_complete", passerIdx: idxOf(request, "A9-LANGAN"), receiverIdx: idxOf(request, "H3-TAFITA"), yardsSaid: 6 }) : answer({ playType: "not_a_play" })),
    });
    h.say("sharks ball first and 10 at their own 25");
    h.say("the pass is complete to tafita at the 31 with langan watching from the sideline");
    h.say("brought down there", 1_500);
    h.say("second and 4", 6_000);
    await h.settle();
    const play = counted(h.controller.getView().session)[0];
    expect(play.play.offense).toBe("home");
    expect(play.play.events.find((event) => event.action === "pass_complete")).toMatchObject({ playerId: "H7-CASTELLANE", estimated: true });
    expect(play.dropped).toContainEqual(expect.objectContaining({ rule: "R14", kind: "filled", reason: expect.stringContaining("without the ball") }));
  });

  it("offers no quarterback prior and sends no offense when nothing says who has the ball", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }) });
    h.say("the pass is complete over the middle");
    h.say("brought down at the 40", 1_500);
    h.say("second and 3", 6_000);
    await h.settle();
    const [first] = h.requests;
    expect(first.gameState.offense).toBeUndefined();
    expect(first.candidates.some((candidate) => candidate.tags.includes("prior:qb"))).toBe(false);
  });
});
