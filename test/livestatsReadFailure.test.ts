import { describe, expect, it, vi } from "vitest";
import type { EventName, EventProps } from "@/lib/analytics/events";
import { APPLY_FAILED, MAX_FAILURES, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { NO_USAGE, type ExtractStatsRequest, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// Audit L5: a reply that comes back but throws while it is read in (the
// check, the rules, the merge) must not lose its window or leave an unhandled
// rejection. The loop pauses through its one failure path, and reading moves
// on only once a reply has been applied. Made-up names only.

const broken = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/livestats/session", async (original) => {
  const real = await original<typeof import("@/lib/livestats/session")>();
  return {
    ...real,
    readPlays: (...args: Parameters<typeof real.readPlays>) => {
      if (broken.on) throw new TypeError("a bug in reading a play in");
      return real.readPlays(...args);
    },
  };
});

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const RUN: StatsPlay = {
  seqStart: 0,
  seqEnd: 1,
  quarter: 2,
  clock: "4:10",
  down: 3,
  distance: 4,
  offense: "home",
  playType: "run",
  nullified: false,
  touchdown: false,
  firstDown: false,
  confidence: 0.9,
  summary: "FENNIMORE 8 yd run",
  evidence: "fennimore up the middle for eight, quillon on the stop",
  events: [
    { playerId: "H22-FENNIMORE", action: "rush", yards: 8, yardsSource: "stated", made: null },
    { playerId: "A17-QUILLON", action: "tackle", yards: null, yardsSource: null, made: null },
  ],
};

const reply = (...plays: StatsPlay[]): ExtractReply => ({ ok: true, plays, usage: { ...NO_USAGE, inputTokens: 10, outputTokens: 5 } });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function harness() {
  let now = 1_800_000_000_000;
  const requests: ExtractStatsRequest[] = [];
  const answers: Array<(reply: ExtractReply) => void> = [];
  const logged: StatsRecord[] = [];
  const tracked: Array<{ name: EventName; props: EventProps }> = [];
  const controller = new StatsController({
    gameId: "game-1",
    startedAt: now,
    roster: ROSTER,
    deps: {
      extract: (request) => {
        requests.push(request);
        return new Promise((resolve) => answers.push(resolve));
      },
      log: (record) => logged.push(record),
      readLog: async () => [],
      track: (name, props) => tracked.push({ name, props }),
      now: () => now,
    },
  });
  await controller.start();
  return {
    controller,
    requests,
    logged,
    tracked,
    say(text: string, ms = 1000) {
      now += ms;
      controller.heard(text, now);
    },
    async answer(next: ExtractReply) {
      answers.shift()!(next);
      await settle();
    },
  };
}

describe("a reply that throws while it is read in (L5)", () => {
  it("pauses through the failure path, loses nothing, and reads the same lines again next call", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const h = await harness();
      h.say("fennimore up the middle for eight");
      h.say("quillon on the stop");
      await h.answer(reply());
      h.say("second and four", 11_000);
      expect(h.requests[1].utterances.map((said) => said.seq)).toEqual([0, 1, 2]);

      broken.on = true;
      await h.answer(reply(RUN));
      broken.on = false;

      expect(h.controller.getView().loop).toEqual({ kind: "paused", code: APPLY_FAILED });
      expect(h.controller.getView().session.plays).toEqual([]);
      expect(h.logged.at(-1)).toMatchObject({ kind: "stats_reply", ok: false, code: APPLY_FAILED, seqFrom: 0, seqTo: 2 });
      // Analytics take declared codes only.
      expect(h.tracked.at(-1)).toEqual({ name: "stats.call_failed", props: { code: "bad_response" } });

      // The watermark did not move: the next call sends the same lines, and the play is read in.
      h.say("third and one", 11_000);
      expect(h.requests[2].utterances.map((said) => said.seq)).toEqual([0, 1, 2, 3]);
      await h.answer(reply(RUN));
      expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["0-1"]);
      expect(h.controller.getView().loop).toEqual({ kind: "listening" });
      await settle();
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
      broken.on = false;
    }
  });

  it(`counts toward the ${MAX_FAILURES} failures that stop the loop`, async () => {
    const h = await harness();
    broken.on = true;
    try {
      for (let i = 0; i < MAX_FAILURES; i++) {
        h.say(`fennimore, third and ${i + 2}`, 11_000);
        await h.answer(reply());
      }
    } finally {
      broken.on = false;
    }
    expect(h.controller.getView().loop).toEqual({ kind: "stopped", code: APPLY_FAILED, retrying: false });
  });
});
