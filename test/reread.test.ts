import { describe, expect, it } from "vitest";
import { V7_SECOND_LOOKS_PER_GAME } from "@/lib/livestats/v7";
import { answer, idxOf, playText, started } from "./v7Harness";

// The v7 re-reads (Part 9): a drive that ends has each play re-read with its
// current answer; a correction that fails the name check or names yards no
// method gives is refused and noted; a snap the downs skipped is read from
// its lines; the second-look cap holds.

/** A three-play drive that ends in a punt, answered by what each segment says. */
function drive(request: Parameters<typeof idxOf>[0]) {
  const text = playText(request);
  if (text.includes("punt")) return answer({ playType: "punt", carrierIdx: idxOf(request, "A2-DUARTE"), yardsSaid: 40 });
  if (text.includes("amesbury")) return answer({ playType: "rush", carrierIdx: idxOf(request, "A32-AMESBURY"), tacklerIdx: idxOf(request, "H55-OKONKWO-REYES"), yardsSaid: 4 });
  if (text.includes("ndiaye")) return answer({ playType: "pass_complete", passerIdx: idxOf(request, "A9-LANGAN"), receiverIdx: idxOf(request, "A81-NDIAYE-HALL"), yardsSaid: 5 });
  return answer({ playType: "not_a_play" });
}

async function playedDrive(correction: (request: Parameters<typeof idxOf>[0]) => ReturnType<typeof answer>) {
  const h = await started({ answerer: (request) => (request.look === "reread" ? correction(request) : drive(request)) });
  h.say("bulldogs ball first and 10 at their own 20");
  h.say("langan hands off to amesbury picks up 4 brought down by okonkwo reyes");
  h.say("second and 6", 6_000);
  h.say("langan throws to ndiaye hall caught at the 29 gain of 5", 2_000);
  h.say("third and 1", 6_000);
  h.say("langan keeps it and is stuffed at the line no gain", 2_000);
  h.say("fourth and 1 and they will punt", 6_000);
  h.say("duarte punts it away 40 yards fair caught at the 31", 3_000);
  h.say("sharks ball first and 10 at the 31", 6_000);
  await h.settle();
  return h;
}

describe("the drive re-read", () => {
  it("re-reads each play of a drive that ended, with its current answer, takes a correction that passes the checks and refuses one that names a player the lines do not", async () => {
    const h = await playedDrive((request) => {
      const text = playText(request);
      // The run: the tackle was nobody's after all. Allowed: nothing new is credited.
      if (text.includes("amesbury")) return { ...request.current!, tacklerIdx: null };
      // The punt: the quarterback returned it, says the re-read. He is on the list only as the prior, unnamed in these lines: refused.
      if (text.includes("punt")) return { ...request.current!, receiverIdx: idxOf(request, "A9-LANGAN") };
      return request.current!;
    });
    const rereads = h.requests.filter((request) => request.look === "reread");
    expect(rereads.length).toBeGreaterThanOrEqual(3);
    expect(rereads.every((request) => request.current !== undefined)).toBe(true);
    expect(h.controller.bridge.counts().driveRereads).toBe(1);

    const run = h.controller.getView().session.plays.find((play) => play.play.summary.includes("run"))!;
    expect(run.play.events.some((event) => event.action === "tackle")).toBe(false);
    expect(run.dropped).toContainEqual(expect.objectContaining({ rule: "R39", kind: "noted" }));
    expect(h.controller.bridge.lines().get("H55-OKONKWO-REYES")).toBeUndefined();

    const punt = h.controller.getView().session.plays.find((play) => play.play.playType === "punt")!;
    expect(punt.play.events.some((event) => event.action === "punt_return")).toBe(false);
    expect(punt.dropped).toContainEqual(expect.objectContaining({ rule: "R49", kind: "noted", reason: expect.stringContaining("not named") }));
  });

  it("takes a correction to a player the lines do name, noted R39", async () => {
    const h = await playedDrive((request) => {
      // The pass's tackler was missed: Okonkwo-Reyes is not in those lines, so the one named defender is... nobody; change the yards instead, to a number in the lines.
      if (playText(request).includes("ndiaye")) return { ...request.current!, yardsSaid: 5, touchdown: false, tacklerIdx: null, carrierIdx: null, passerIdx: idxOf(request, "A9-LANGAN"), receiverIdx: idxOf(request, "A81-NDIAYE-HALL"), playType: "pass_complete", penalty: "none", confidence: "high" };
      if (playText(request).includes("amesbury")) return { ...request.current!, yardsSaid: 4 };
      return request.current!;
    });
    // Nothing changed on those: no R39 note, no refusal.
    const notes = h.controller.getView().session.plays.flatMap((play) => play.dropped.filter((note) => note.rule === "R39" || note.rule === "R49"));
    expect(notes).toEqual([]);
  });

  it("refuses yards no method gives, and a removal of a play the announcer corrected", async () => {
    const h = await playedDrive((request) => {
      if (playText(request).includes("amesbury")) return { ...request.current!, yardsSaid: 27 };
      if (playText(request).includes("ndiaye")) return answer({ playType: "not_a_play" });
      return request.current!;
    });
    const run = h.controller.getView().session.plays.find((play) => play.play.summary.includes("run"))!;
    expect(run.play.events[0].yards).toBe(4);
    expect(run.dropped).toContainEqual(expect.objectContaining({ rule: "R49", reason: expect.stringContaining("27 yards matches no method") }));
    // The pass was taken out: the re-read said it was not a play, and nobody had corrected it.
    const pass = h.controller.getView().session.plays.find((play) => play.play.summary.includes("pass"))!;
    expect(pass.status).toBe("discarded");
    expect(pass.dropped).toContainEqual(expect.objectContaining({ rule: "R49", kind: "dropped" }));
  });

  it("never touches a play the announcer corrected", async () => {
    const h = await started({ answerer: (request) => (request.look === "reread" ? answer({ playType: "not_a_play" }) : drive(request)) });
    h.say("bulldogs ball first and 10 at their own 20");
    h.say("langan hands off to amesbury picks up 4 brought down by okonkwo reyes");
    h.say("second and 6", 6_000);
    await h.settle();
    const playId = h.controller.getView().session.plays[0].playId;
    h.controller.correct(playId, { type: "amount", index: 1, amount: 5 });
    h.say("duarte punts it away 40 yards fair caught at the 31", 2_000);
    h.say("sharks ball first and 10 at the 31", 6_000);
    await h.settle();
    const play = h.controller.getView().session.plays.find((each) => each.playId === playId)!;
    expect(play.status).toBe("applied");
    expect(play.dropped).toContainEqual(expect.objectContaining({ rule: "R49", reason: expect.stringContaining("the announcer corrected") }));
  });
});

describe("the gap re-read", () => {
  it("reads the lines where the downs skipped a snap, and counts what comes back as R44", async () => {
    const h = await started({
      answerer: (request) => {
        const text = playText(request);
        if (request.look === "gap") return answer({ playType: "pass_incomplete", passerIdx: idxOf(request, "H7-CASTELLANE"), confidence: "medium" });
        if (text.includes("fennimore")) return answer({ playType: "rush", carrierIdx: idxOf(request, "H22-FENNIMORE"), yardsSaid: 3 });
        if (text.includes("vantree")) return answer({ playType: "pass_complete", passerIdx: idxOf(request, "H7-CASTELLANE"), receiverIdx: idxOf(request, "H88-VANTREE"), yardsSaid: 9 });
        return answer({ playType: "not_a_play" });
      },
    });
    h.say("sharks ball first and 10 at the 30");
    h.say("fennimore up the middle picks up 3");
    h.say("second and 7", 6_000);
    // The second-down snap is never described as a play: the booth talks over it.
    h.say("and that one is away and it is on the ground", 2_000);
    h.say("third and 7 from the 33", 8_000);
    h.say("castellane finds vantree for 9 and a first down", 2_000);
    h.say("first and 10 at the 42", 6_000);
    await h.settle();
    const gap = h.requests.find((request) => request.look === "gap");
    expect(gap).toBeDefined();
    expect(gap!.note).toMatch(/one snap is missing|yards is missing/);
    expect(h.controller.bridge.counts().gapRereads).toBe(1);
    const inferred = h.controller.getView().session.plays.find((play) => play.dropped.some((note) => note.rule === "R44"));
    expect(inferred).toBeDefined();
    expect(inferred!.play.events[0]).toMatchObject({ action: "pass_incomplete", playerId: "H7-CASTELLANE" });
  });
});

describe("the caps", () => {
  it("takes at most the game's share of second looks", async () => {
    const h = await started({ answerer: () => answer({ playType: "not_a_play" }) });
    for (let i = 0; i < V7_SECOND_LOOKS_PER_GAME + 5; i++) {
      h.say(`fennimore carries it for ${(i % 7) + 1}`, 2_000);
      h.say("second and 5", 6_000);
      await h.settle();
    }
    const seconds = h.requests.filter((request) => request.look === "second");
    expect(seconds).toHaveLength(V7_SECOND_LOOKS_PER_GAME);
    expect(h.controller.bridge.counts().secondLooks).toBe(V7_SECOND_LOOKS_PER_GAME);
  });
});
