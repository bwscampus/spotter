import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { calls, usageAnswer } from "./fakeUsage";

// Ported from V3. There the route's requireUser was replaced by a signed-in
// Supabase client whose rpc allowed every usage check; here the session is
// stubbed (a confirmed, approved account) and the spend guard talks to the fake
// database from test/fakeServer.ts, which allows every call.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({
  readSession: async () => ({
    id: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10",
    email: "a@example.com",
    name: null,
    approved: true,
    emailVerified: true,
    isAdmin: false,
    signedInAt: new Date(),
  }),
}));
let db = fakeDatabase(usageAnswer());
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { MAX_FIT_PROBES, POST } from "@/app/api/deepgram/check-keyterms/route";

// POST /api/deepgram/check-keyterms finding how many names Deepgram takes
// from the front of a list (Jed, Oct 3: over the limit, the most called keep
// the boost). Deepgram is faked: it refuses any request with more than `limit`
// keyterms, the way the real one refuses past 500 tokens.

const names = (count: number) => Array.from({ length: count }, (_, i) => `Name${i}`);

function deepgram(limit: number, { failAfter = Infinity } = {}) {
  let calls = 0;
  const fetch = vi.fn(async (url: string) => {
    calls++;
    if (calls > failAfter) throw new TypeError("network");
    const count = new URL(url).searchParams.getAll("keyterm").length;
    if (count <= limit) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ err_msg: "Keyterm limit exceeded." }), { status: 400 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const ask = (keyterms: string[], fit = true) =>
  POST(
    new Request("https://spotter.test/api/deepgram/check-keyterms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ keyterms, fit }),
    }),
  ).then((response) => response.json());

beforeEach(() => {
  db = fakeDatabase(usageAnswer());
  vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fitting the name list to Deepgram's limit", () => {
  it("says a list that fits is fine, in one call", async () => {
    const fetch = deepgram(200);
    expect(await ask(names(150))).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("finds exactly how many from the front Deepgram takes", async () => {
    const fetch = deepgram(137);
    expect(await ask(names(190))).toMatchObject({ ok: false, fits: 137 });
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(1 + MAX_FIT_PROBES);
  });

  it("only searches when asked, as before", async () => {
    const fetch = deepgram(10);
    const answer = await ask(names(40), false);
    expect(answer.ok).toBe(false);
    expect(answer.fits).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops at what is known to fit when Deepgram stops answering", async () => {
    // The whole list is refused, the first half (100) is taken, then nothing answers.
    deepgram(120, { failAfter: 2 });
    expect(await ask(names(200))).toMatchObject({ ok: false, fits: 100 });
  });

  it("counts the whole search as one keyterm check on the spend guard", async () => {
    deepgram(137);
    await ask(names(190));
    expect(calls(db.statements, "usage_begin")).toHaveLength(1);
    expect(calls(db.statements, "usage_finish")).toHaveLength(1);
  });
});
