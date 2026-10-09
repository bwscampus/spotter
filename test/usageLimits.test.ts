import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";
import { ALLOWED, calls, USAGE_ID, USAGE_NONCE, usageAnswer } from "./fakeUsage";

// The spend guard every paid route runs after the sign-in gate (lib/server/usage.ts,
// V3's lib/usage/server.ts; V3's docs/PRE_LAUNCH_AUDIT.md B1 and H15). Ported
// from V3: there the guard called Supabase's rpc; here it sends SQL to the
// fake database from test/fakeServer.ts, so these check what is sent and how
// each answer is read. What the function decides lives in its SQL.

let db = fakeDatabase();
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { EXTRACT_FAILURE_CODES, extractFailure } from "@/lib/rosters/extractErrors";
import { IMPORT_FAIL_CODES, sanitizeProps, STATS_FAIL_CODES } from "@/lib/analytics/events";
import { limitResponse, readBeginReply, USAGE_MESSAGES, USAGE_ROUTES, usageUnavailableResponse } from "@/lib/usage/limits";
import { FALLBACK_PRICES, meterOpenRouter, UsageMeter } from "@/lib/usage/prices";
import { beginUsage, finishUsage } from "@/lib/server/usage";

const OWNER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

const SQL = readFileSync(new URL("../db/migrations/0009_usage_limits.sql", import.meta.url), "utf8");
const RAISED = readFileSync(new URL("../db/migrations/0017_spend_limits.sql", import.meta.url), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("reading usage_begin's answer", () => {
  it("takes a reservation with a real id and nonce", () => {
    expect(readBeginReply(ALLOWED, null)).toEqual({ kind: "ok", id: USAGE_ID, nonce: USAGE_NONCE });
  });

  it("reads each limit with its wait, rounded up and at least a second", () => {
    expect(readBeginReply({ ok: false, code: "rate_limited", retry_after_s: 2.2 }, null)).toEqual({
      kind: "limited",
      code: "rate_limited",
      retryAfterS: 3,
    });
    expect(readBeginReply({ ok: false, code: "daily_cap", retry_after_s: 0 }, null)).toMatchObject({ retryAfterS: 1 });
    expect(readBeginReply({ ok: false, code: "global_cap" }, null)).toMatchObject({ code: "global_cap", retryAfterS: 1 });
  });

  it("never asks anyone to wait more than a day", () => {
    expect(readBeginReply({ ok: false, code: "daily_cap", retry_after_s: 1e9 }, null)).toMatchObject({ retryAfterS: 86_400 });
  });

  it("passes the function's own account refusals on", () => {
    expect(readBeginReply({ ok: false, code: "not_approved" }, null)).toEqual({ kind: "refused", code: "not_approved" });
    expect(readBeginReply({ ok: false, code: "signed_out" }, null)).toEqual({ kind: "refused", code: "signed_out" });
  });

  it("treats an error, a strange answer or a bad id as the check being unavailable", () => {
    expect(readBeginReply(null, { code: "PGRST000" })).toEqual({ kind: "unavailable" });
    expect(readBeginReply(ALLOWED, { code: "PGRST000" })).toEqual({ kind: "unavailable" });
    expect(readBeginReply("yes", null)).toEqual({ kind: "unavailable" });
    expect(readBeginReply({ ok: true, id: "1", nonce: USAGE_NONCE }, null)).toEqual({ kind: "unavailable" });
    expect(readBeginReply({ ok: false, code: "unknown_route" }, null)).toEqual({ kind: "unavailable" });
    expect(readBeginReply({ ok: "maybe" }, null)).toEqual({ kind: "unavailable" });
  });
});

describe("the 429 a refused call gets", () => {
  it.each([
    ["rate_limited", "Slow down a moment and try again."],
    ["daily_cap", "You've hit today's limit. It resets at midnight UTC."],
    ["global_cap", "StatCast has hit its daily limit for everyone. Try again tomorrow."],
  ] as const)("%s says, in plain English, %s", async (code, sentence) => {
    const response = limitResponse(code, 30);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code, error: sentence, retryAfterS: 30 });
  });

  it("a check that could not run is a 503 with its own code", async () => {
    const response = usageUnavailableResponse();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("usage_unavailable");
  });

  it("the import panel and the stats strip get the same sentences through extractErrors", () => {
    for (const code of ["rate_limited", "daily_cap", "global_cap", "usage_unavailable"] as const) {
      expect(EXTRACT_FAILURE_CODES).toContain(code);
      expect(extractFailure(code).message).toBe(USAGE_MESSAGES[code]);
    }
    expect(extractFailure("rate_limited").status).toBe(429);
    expect(extractFailure("usage_unavailable").status).toBe(503);
  });

  it("the codes survive the analytics filter for import and stats failures", () => {
    for (const code of ["rate_limited", "daily_cap", "global_cap", "usage_unavailable"]) {
      expect(IMPORT_FAIL_CODES).toContain(code);
      expect(STATS_FAIL_CODES).toContain(code);
      expect(sanitizeProps("stats.call_failed", { code })).toEqual({ code });
    }
  });
});

describe("beginUsage", () => {
  /** usage_begin answers `begin`; a throw stands for the database being unreachable. */
  const answering = (begin: () => unknown) => {
    db = fakeDatabase(usageAnswer(begin));
  };

  beforeEach(() => answering(() => ALLOWED));

  it("asks usage_begin for the owner from the session and the route, as parameters", async () => {
    const start = await beginUsage(OWNER, "livestats", () => 1000);
    expect(db.statements).toEqual([{ text: "select public.usage_begin($1, $2) as reply", params: [OWNER, "livestats"] }]);
    expect(start).toEqual({ ok: true, ticket: { id: USAGE_ID, nonce: USAGE_NONCE, route: "livestats", startedAt: 1000 } });
  });

  it("answers a limit with a 429", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    answering(() => ({ ok: false, code: "daily_cap", retry_after_s: 60 }));
    const start = await beginUsage(OWNER, "roster_import");
    if (start.ok) throw new Error("expected a refusal");
    expect(start.response.status).toBe(429);
    expect(start.response.headers.get("retry-after")).toBe("60");
    expect((await start.response.json()).code).toBe("daily_cap");
  });

  it("answers the function's own refusals as the gate would: switched off is 403, signed out 401", async () => {
    answering(() => ({ ok: false, code: "not_approved" }));
    let start = await beginUsage(OWNER, "stats_import");
    if (start.ok) throw new Error("expected a refusal");
    expect(start.response.status).toBe(403);
    expect((await start.response.json()).code).toBe("not_approved");

    answering(() => ({ ok: false, code: "signed_out" }));
    start = await beginUsage(OWNER, "stats_import");
    if (start.ok) throw new Error("expected a refusal");
    expect(start.response.status).toBe(401);
  });

  it.each(["deepgram_keyterms", "livestats", "roster_import", "stats_import"] as const)(
    "%s fails closed when the check cannot run",
    async (route) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      answering(() => null);
      const start = await beginUsage(OWNER, route);
      if (start.ok) throw new Error("expected a refusal");
      expect(start.response.status).toBe(503);
      expect((await start.response.json()).code).toBe("usage_unavailable");
    },
  );

  it("a Deepgram token fails open, with no reservation to finish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    answering(() => {
      throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    });
    expect(await beginUsage(OWNER, "deepgram_token")).toEqual({ ok: true, ticket: null });
  });

  it("a thrown query is the check being unavailable, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    answering(() => {
      throw new TypeError("fetch failed");
    });
    const start = await beginUsage(OWNER, "livestats");
    if (start.ok) throw new Error("expected a refusal");
    expect(start.response.status).toBe(503);
  });

  it("an empty answer (no row) is the check being unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = fakeDatabase(() => []);
    const start = await beginUsage(OWNER, "roster_import");
    if (start.ok) throw new Error("expected a refusal");
    expect(start.response.status).toBe(503);
  });
});

describe("finishUsage", () => {
  const ticket = { id: USAGE_ID, nonce: USAGE_NONCE, route: "livestats" as const, startedAt: 1000 };

  beforeEach(() => {
    db = fakeDatabase(usageAnswer());
  });

  it("sends the owner, the reservation, the counts and dollars, whole and never negative, with the time taken", async () => {
    await finishUsage(
      OWNER,
      ticket,
      {
        ok: true,
        provider: "openrouter",
        inputTokens: 1234.6,
        outputTokens: -5,
        cachedTokens: Number.NaN,
        costUsd: 0.0012345678,
      },
      () => 1750,
    );
    const [finish] = calls(db.statements, "usage_finish");
    expect(finish.text).toBe("select public.usage_finish($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)");
    expect(finish.params).toEqual([OWNER, USAGE_ID, USAGE_NONCE, true, "openrouter", 1235, 0, 0, 0.00123, 750]);
  });

  it("sends an empty provider and zeros when none are known", async () => {
    await finishUsage(OWNER, ticket, { ok: false, provider: null }, () => 1000);
    expect(calls(db.statements, "usage_finish")[0].params).toEqual([OWNER, USAGE_ID, USAGE_NONCE, false, "", 0, 0, 0, 0, 0]);
  });

  it("does nothing without a reservation", async () => {
    await finishUsage(OWNER, null, { ok: true, provider: "deepgram" });
    expect(db.statements).toEqual([]);
  });

  it("never throws, whatever the database does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = fakeDatabase(() => {
      throw Object.assign(new Error("down"), { code: "57P01" });
    });
    await expect(finishUsage(OWNER, ticket, { ok: false, provider: null })).resolves.toBeUndefined();
    db = fakeDatabase(() => {
      throw "not even an Error";
    });
    await expect(finishUsage(OWNER, ticket, { ok: false, provider: null })).resolves.toBeUndefined();
  });
});

describe("what an import cost", () => {
  it("is what OpenRouter says it charged, with the reply's token counts", () => {
    const usage = meterOpenRouter({
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      cost: 0.42,
      prompt_tokens_details: { cached_tokens: 250_000 },
    });
    expect(usage).toEqual({ calls: 1, inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 250_000, costUsd: 0.42 });
  });

  it("is worked out from Gemini's rates when a reply carries no cost, cached input as a cache read", () => {
    const usage = meterOpenRouter({ prompt_tokens: 2_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 1_000_000 } });
    expect(usage.inputTokens).toBe(2_000_000);
    expect(usage.cachedTokens).toBe(1_000_000);
    expect(usage.costUsd).toBeCloseTo(FALLBACK_PRICES.input + FALLBACK_PRICES.output + FALLBACK_PRICES.cacheRead, 9);
  });

  it("never records a reply as free unless it said so", () => {
    expect(meterOpenRouter({ prompt_tokens: 1_000_000 }).costUsd).toBeGreaterThan(0);
    expect(meterOpenRouter({ prompt_tokens: 1_000_000, cost: -1 }).costUsd).toBeGreaterThan(0);
  });

  it("adds up every reply a route got, failed ones included", () => {
    const meter = new UsageMeter();
    meter.add({ prompt_tokens: 500_000, cost: 1 });
    meter.add({ prompt_tokens: 500_000, cost: 1 });
    meter.add(undefined);
    expect(meter.usage).toEqual({ calls: 3, inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, costUsd: 2 });
  });
});


// The SQL is applied by scripts/migrate.mjs on deploy; these hold the
// decisions in it that the TypeScript relies on.
describe("the migration", () => {
  const code = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

  it("allows exactly the routes the code names", () => {
    const check = code.match(/route in \(([^)]*)\)/)?.[1] ?? "";
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort()).toEqual([...USAGE_ROUTES].sort());
    for (const route of USAGE_ROUTES) expect(code).toContain(`when '${route}' then`);
  });

  it("caps an account at $3 a day and everyone at $50 a day, until 0017 raises them", () => {
    expect(code).toMatch(/c_user_daily_usd\s+constant numeric := 3\.00;/);
    expect(code).toMatch(/c_global_daily_usd constant numeric := 50\.00;/);
  });

  it("answers with the codes the code reads", () => {
    for (const answer of ["rate_limited", "daily_cap", "global_cap", "signed_out", "not_approved"]) {
      expect(code).toContain(`'${answer}'`);
    }
  });

  // V3's "row level security on, no policy, no grants" check is dropped: there is
  // no RLS here, and the app's role has rows on every public table by design
  // (scripts/migrate.mjs). Owner scoping rests on the functions taking p_owner.
  it("takes the owner as the first argument of both functions, with an empty search path", () => {
    expect(code).toContain("create function public.usage_begin(p_owner uuid, p_route text)");
    expect(code).toMatch(/create function public\.usage_finish\(\s*p_owner uuid,\s*p_id uuid,\s*p_nonce uuid,/);
    expect(code).not.toContain("auth.uid()");
    // V3 needed security definer to get past row level security; nothing here does.
    expect(code).not.toMatch(/security definer/);
    expect(code.match(/set search_path = ''/g)?.length).toBe(3);
  });

  it("finishes only the caller's own unfinished row with the matching nonce", () => {
    expect(code).toMatch(/where u\.id = p_id\s+and u\.nonce = p_nonce\s+and u\.owner_id = p_owner\s+and u\.finished_at is null/);
  });

  it("puts the dashboard view in admin and grants it to nobody", () => {
    expect(code).toMatch(/create view admin\.usage_by_user as/);
    expect(code).toMatch(/revoke all on admin\.usage_by_user from public;/);
    expect(code).not.toMatch(/grant [a-z, ]+ on admin\./i);
  });

  it("caps app_events at 5,000 rows per account per day, counted by when the database got them", () => {
    expect(code).toMatch(/c_max_per_day constant int := 5000;/);
    expect(code).toMatch(/new\.received_at := now\(\);/);
    expect(code).toMatch(/before insert on app_events/);
  });
});

// 0017 replaces usage_begin (Jed, Oct 8): $8 and $1,000 a day, no wait between
// calls, and dollars as the only limit on the routes the dollar caps stop.
describe("the raised limits", () => {
  const code = RAISED.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

  it("caps an account at $8 a day and everyone at $1,000 a day", () => {
    expect(code).toMatch(/c_user_daily_usd\s+constant numeric := 8\.00;/);
    expect(code).toMatch(/c_global_daily_usd constant numeric := 1000\.00;/);
  });

  it("replaces usage_begin with the same arguments, an empty search path and no security definer", () => {
    expect(code).toContain("create or replace function public.usage_begin(p_owner uuid, p_route text)");
    expect(code).toContain("set search_path = ''");
    expect(code).not.toMatch(/security definer/);
    expect(code).not.toContain("auth.uid()");
  });

  it("has no wait between two calls", () => {
    expect(code).not.toContain("v_gap");
  });

  it("still names every route, counts only the Deepgram ones, and stops the rest by dollars", () => {
    for (const route of USAGE_ROUTES) expect(code).toContain(`when '${route}' then`);
    expect(code).toMatch(/when 'deepgram_token' then\s+v_window_max := 180;\s+v_window := interval '1 hour'; v_dollars := false;/);
    expect(code).toMatch(/when 'deepgram_keyterms' then\s+v_window_max := 60;\s+v_window := null;\s+v_dollars := false;/);
    for (const route of ["livestats", "roster_import", "stats_import"]) {
      expect(code).toMatch(new RegExp(`when '${route}' then\\s+v_window_max := null; v_window := null;\\s+v_dollars := true;`));
    }
  });

  it("answers with the codes the code reads", () => {
    for (const answer of ["rate_limited", "daily_cap", "global_cap", "signed_out", "not_approved"]) {
      expect(code).toContain(`'${answer}'`);
    }
  });
});
