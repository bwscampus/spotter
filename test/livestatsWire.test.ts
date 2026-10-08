import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeProps, STAT_PLAY_TYPES, STATS_FAIL_CODES } from "@/lib/analytics/events";
import { extractFromRoute } from "@/components/livestats/useLiveStats";
import { PLAY_TYPES, type ExtractStatsRequest } from "@/lib/livestats/types";

// Between the browser and POST /api/livestats/extract, and what reaches
// analytics from it: codes and counts only.

const REQUEST: ExtractStatsRequest = { utterances: [{ seq: 0, text: "first and ten", offsetMs: 0 }], rosters: [], recentPlays: [] };

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking the route", () => {
  it("hands back the plays and the usage", async () => {
    vi.stubGlobal("fetch", reply(200, { plays: [{ seqEnd: 0 }], usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: -5 } }));
    const answer = await extractFromRoute(REQUEST);
    expect(answer).toEqual({
      ok: true,
      plays: [{ seqEnd: 0 }],
      usage: { inputTokens: 10, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 },
    });
  });

  it("passes on the route's own code when it refuses", async () => {
    vi.stubGlobal("fetch", reply(403, { code: "not_approved", error: "waiting" }));
    expect(await extractFromRoute(REQUEST)).toEqual({ ok: false, code: "not_approved" });
  });

  it("calls anything it cannot read a bad response, never a thrown error", async () => {
    vi.stubGlobal("fetch", reply(413, "<html>Request Entity Too Large</html>"));
    expect(await extractFromRoute(REQUEST)).toEqual({ ok: false, code: "bad_response" });
    vi.stubGlobal("fetch", reply(200, { nothing: true }));
    expect(await extractFromRoute(REQUEST)).toEqual({ ok: false, code: "bad_response" });
  });

  it("tells no connection apart from a call that took too long", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await extractFromRoute(REQUEST)).toEqual({ ok: false, code: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    expect(await extractFromRoute(REQUEST)).toEqual({ ok: false, code: "claude_timeout" });
  });
});

describe("what analytics can be told", () => {
  it("knows every play type live stats reads", () => {
    expect([...STAT_PLAY_TYPES]).toEqual([...PLAY_TYPES]);
  });

  it("keeps every code a stats call can fail with", () => {
    for (const code of ["signed_out", "not_approved", "missing_key", "claude_timeout", "network", "bad_response"]) {
      expect(STATS_FAIL_CODES, code).toContain(code);
      expect(sanitizeProps("stats.call_failed", { code })).toEqual({ code });
    }
  });

  it("drops a code it does not know rather than send free text", () => {
    expect(sanitizeProps("stats.call_failed", { code: "Fennimore dropped it" })).toEqual({});
  });
});
