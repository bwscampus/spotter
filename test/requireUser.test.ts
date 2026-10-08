import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { ALLOWED, calls, USAGE_ID, USAGE_NONCE, usageAnswer } from "./fakeUsage";

// Ported from V3's test/requireUser.test.ts. There the gate read Supabase's
// claims; here it reads the session (lib/server/session.ts), stubbed so each
// account state can be set up exactly, and the spend guard sends SQL to the
// fake database from test/fakeServer.ts.
//
// test/requireApprovedUser.test.ts already covers requireApprovedUser and the
// first four paid routes refusing a switched-off or signed-out caller. This
// file adds what V3's version added: requireUser itself, the live stats and
// Other info routes behind the gate, unconfirmed email accounts on every paid
// route, and the spend guard running after the gate on every paid route.

// A plain function, not a vi.fn spy, so it can throw for the outage case.
let session: () => Promise<SessionUser | null> = async () => null;
// Outside a request there is no cookie store; the session itself is stubbed below.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));

let db = fakeDatabase(usageAnswer());
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { requireUser, VERIFY_NOTE } from "@/lib/server/auth";
import type { SessionUser } from "@/lib/server/session";
import { SWITCHED_OFF_NOTE, USAGE_MESSAGES } from "@/lib/usage/limits";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function signedIn(fields: Partial<SessionUser> = {}) {
  const user: SessionUser = {
    id: USER,
    email: "a@example.com",
    name: null,
    approved: true,
    emailVerified: true,
    isAdmin: false,
    signedInAt: new Date(),
    ...fields,
  };
  session = async () => user;
}

async function body(response: Response) {
  return (await response.json()) as { code: string; error: string };
}

/** Records every outgoing request; answers like Deepgram's token grant. */
function stubFetch() {
  const fetch = vi.fn(async () => Response.json({ access_token: "t" }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  session = async () => null;
  db = fakeDatabase(usageAnswer());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireUser", () => {
  it("returns 401 when nobody is signed in, never cached", async () => {
    const gate = await requireUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(401);
    expect((await body(gate.response)).code).toBe("signed_out");
    expect(gate.response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets any signed-in account through, unconfirmed or switched off, without another database read", async () => {
    // Free routes (saving a roster, recording a crash) are open to every account.
    for (const fields of [{}, { approved: false }, { emailVerified: false }]) {
      signedIn(fields);
      const gate = await requireUser();
      if (!gate.ok) throw new Error("expected the account through");
      expect(gate.user.id).toBe(USER);
    }
    expect(db.statements).toEqual([]);
  });

  it("fails closed with 503 when the session cannot be read", async () => {
    session = async () => {
      throw new Error("connection refused");
    };
    const gate = await requireUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(503);
    expect((await body(gate.response)).code).toBe("approval_unavailable");
  });
});

type Route = { POST: (request: Request) => Promise<Response> };

const PAID = [
  ["deepgram/token", "deepgram_token", () => import("@/app/api/deepgram/token/route")],
  ["deepgram/check-keyterms", "deepgram_keyterms", () => import("@/app/api/deepgram/check-keyterms/route")],
  ["rosters/extract", "roster_import", () => import("@/app/api/rosters/extract/route")],
  ["stats/extract", "stats_import", () => import("@/app/api/stats/extract/route")],
  ["livestats/extract", "livestats", () => import("@/app/api/livestats/extract/route")],
  // Counted as a stats import: a new route name would mean changing usage_begin's check.
  ["storylines/extract", "stats_import", () => import("@/app/api/storylines/extract/route")],
] as const;

async function call(name: string, load: () => Promise<Route>) {
  const fetch = stubFetch();
  const { POST } = await load();
  const response = await POST(
    new Request(`https://spotter.example/api/${name}`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ keyterms: ["Ossuetta"] }),
    }),
  );
  return { response, fetched: fetch.mock.calls.length };
}

// The gate only protects a route that runs it before spending anything.
describe("the live stats and Other info routes run the gate first", () => {
  const routes = PAID.filter(([name]) => name === "livestats/extract" || name === "storylines/extract");

  for (const [name, , load] of routes) {
    it(`${name} refuses a signed-out visitor with 401 before calling anything`, async () => {
      const { response, fetched } = await call(name, load);
      expect(response.status).toBe(401);
      expect((await body(response)).code).toBe("signed_out");
      expect(fetched).toBe(0);
      expect(db.statements).toEqual([]);
    });

    it(`${name} refuses a switched-off account with 403 before calling anything`, async () => {
      signedIn({ approved: false });
      const { response, fetched } = await call(name, load);
      expect(response.status).toBe(403);
      expect((await body(response)).code).toBe("not_approved");
      expect(fetched).toBe(0);
      expect(db.statements).toEqual([]);
    });

    it(`${name} refuses another site`, async () => {
      signedIn();
      const fetch = stubFetch();
      const { POST } = await load();
      const response = await POST(
        new Request(`https://spotter.example/api/${name}`, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
      );
      expect(response.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
      expect(db.statements).toEqual([]);
    });
  }
});

// AUTH-2: an email and password account that has not opened its confirmation
// link can use everything free, and nothing that spends money.
describe("every paid route refuses an unconfirmed email", () => {
  for (const [name, , load] of PAID) {
    it(`${name} answers 403 email_not_verified before the spend guard or any call out`, async () => {
      signedIn({ emailVerified: false });
      const { response, fetched } = await call(name, load);
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ code: "email_not_verified", error: VERIFY_NOTE });
      expect(fetched).toBe(0);
      expect(db.statements).toEqual([]);
    });
  }
});

// Right after the gate, every paid route asks public.usage_begin whether this
// account may make the call now (lib/server/usage.ts, B1). These hold a
// signed-in account and change only what usage_begin answers.
describe("every paid route runs the spend guard after the gate", () => {
  function usageBeginAnswers(begin: () => unknown) {
    signedIn();
    db = fakeDatabase(usageAnswer(begin));
  }

  for (const [name, route, load] of PAID) {
    it(`${name} asks usage_begin for "${route}", for the session's account`, async () => {
      usageBeginAnswers(() => ({ ok: false, code: "rate_limited", retry_after_s: 2 }));
      await call(name, load);
      expect(calls(db.statements, "usage_begin").map((s) => s.params)).toEqual([[USER, route]]);
    });

    for (const code of ["rate_limited", "daily_cap", "global_cap"] as const) {
      it(`${name} answers 429 ${code} without calling Anthropic, OpenRouter or Deepgram`, async () => {
        usageBeginAnswers(() => ({ ok: false, code, retry_after_s: 42 }));
        const { response, fetched } = await call(name, load);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("42");
        expect(response.headers.get("cache-control")).toBe("no-store");
        const refusal = await body(response);
        expect(refusal.code).toBe(code);
        expect(refusal.error).toBe(USAGE_MESSAGES[code]);
        expect(fetched).toBe(0);
        expect(calls(db.statements, "usage_finish")).toEqual([]);
      });
    }

    it(`${name} answers 403 for an account switched off after the gate read it`, async () => {
      usageBeginAnswers(() => ({ ok: false, code: "not_approved" }));
      const { response, fetched } = await call(name, load);
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ code: "not_approved", error: SWITCHED_OFF_NOTE });
      expect(fetched).toBe(0);
    });

    if (route === "deepgram_token") {
      it(`${name} still mints a token when the usage check cannot run, so a database blip never stops a game`, async () => {
        usageBeginAnswers(() => {
          throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
        });
        const { response, fetched } = await call(name, load);
        expect(response.status).toBe(200);
        expect(fetched).toBe(1);
        // No reservation, so nothing to finish.
        expect(calls(db.statements, "usage_finish")).toEqual([]);
      });
    } else {
      it(`${name} fails closed with 503 usage_unavailable when the usage check cannot run`, async () => {
        usageBeginAnswers(() => {
          throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
        });
        const { response, fetched } = await call(name, load);
        expect(response.status).toBe(503);
        expect((await body(response)).code).toBe("usage_unavailable");
        expect(fetched).toBe(0);
      });
    }

    it(`${name} records how the call went on its reservation`, async () => {
      usageBeginAnswers(() => ALLOWED);
      await call(name, load);
      const finish = calls(db.statements, "usage_finish");
      expect(finish, "usage_finish was not called").toHaveLength(1);
      expect(finish[0].params.slice(0, 3)).toEqual([USER, USAGE_ID, USAGE_NONCE]);
    });
  }

  it("deepgram/token records a minted token as ok, from deepgram, at $0", async () => {
    usageBeginAnswers(() => ALLOWED);
    const { response } = await call("deepgram/token", PAID[0][2]);
    expect(response.status).toBe(200);
    const [finish] = calls(db.statements, "usage_finish");
    // owner, id, nonce, ok, provider, input, output, cached, cost, ms
    expect(finish.params.slice(0, 9)).toEqual([USER, USAGE_ID, USAGE_NONCE, true, "deepgram", 0, 0, 0, 0]);
  });
});
