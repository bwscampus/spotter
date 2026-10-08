import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanMessage, cleanPath, cleanReport, LIMITS, MAX_REPORT_BYTES as MAX_BODY_BYTES } from "@/lib/errors/clean";
import { fakeDatabase } from "./fakeServer";

// Audit H5: crash reports carry the error's name, the first line of its
// message, the path without its query, and Next's digest. Nothing a page holds.

describe("what a crash report may carry", () => {
  it("keeps only the first line of the message, cut to its limit", () => {
    expect(cleanMessage("TypeError at x\n    at foo (bar.js:1:2)")).toBe("TypeError at x");
    expect(cleanMessage("a".repeat(1000))).toHaveLength(LIMITS.message);
    expect(cleanMessage(undefined)).toBe("");
  });

  it("blanks free text in quotes and email addresses, and keeps property names", () => {
    expect(cleanMessage("Cannot read properties of undefined (reading 'map')")).toBe(
      "Cannot read properties of undefined (reading 'map')",
    );
    expect(cleanMessage('No player named "Sam Langan" on the roster')).toBe('No player named "..." on the roster');
    expect(cleanMessage("Could not load coach@school.org")).toBe("Could not load [email]");
  });

  it("drops the query, the fragment and the origin from the path", () => {
    expect(cleanPath("/games/new?away=abc&home=def")).toBe("/games/new");
    expect(cleanPath("https://thespottingboard.com/teams/1#x")).toBe("/teams/1");
    expect(cleanPath("/" + "a".repeat(500))).toHaveLength(LIMITS.path);
  });

  it("keeps a name or digest only when it looks like a code", () => {
    expect(cleanReport({ name: "TypeError", digest: "1234567890" })).toMatchObject({ name: "TypeError", digest: "1234567890" });
    expect(cleanReport({ name: "<script>", digest: { a: 1 } })).toMatchObject({ name: "Error", digest: "" });
  });
});

// The route: signed in, same origin, production, small, and through
// public.record_client_error(p_owner, ...). V3 called the RPC through a
// Supabase client; here the session is stubbed and the SQL goes to the fake
// database from test/fakeServer.ts.
const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
const SIGNED_IN = { id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() };

// A plain function, not a spy, so each test can sign in or out.
let session: () => Promise<unknown> = async () => SIGNED_IN;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));

let db = fakeDatabase(() => [{ recorded: true }]);
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

const { POST } = await import("@/app/api/client-errors/route");

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://thespottingboard.com/api/client-errors", {
      method: "POST",
      headers: { host: "thespottingboard.com", "sec-fetch-site": "same-origin", ...headers },
      body,
    }),
  );
}

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    session = async () => SIGNED_IN;
    db = fakeDatabase(() => [{ recorded: true }]);
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("NEXT_PUBLIC_GIT_COMMIT", "abc1234");
  });

  it("records a cleaned report through record_client_error, for the session's account", async () => {
    const response = await post(JSON.stringify({ path: "/teams?x=1", name: "TypeError", message: "boom\nstack", digest: "42" }));
    expect(response.status).toBe(204);
    expect(db.statements).toHaveLength(1);
    const [statement] = db.statements;
    expect(statement.text).toContain("public.record_client_error($1, 'production', $2, $3, $4, $5, $6)");
    // owner, app version, path, name, message, digest
    expect(statement.params[0]).toBe(USER);
    expect(statement.params.slice(2)).toEqual(["/teams", "TypeError", "boom", "42"]);
  });

  it("takes the owner from the session, never from the report", async () => {
    await post(JSON.stringify({ path: "/teams", name: "TypeError", message: "boom", owner: "someone-else", p_owner: "x" }));
    expect(db.statements[0].params[0]).toBe(USER);
  });

  it("refuses another site, a signed-out caller and an oversized body, and records nothing", async () => {
    expect((await post("{}", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    session = async () => null;
    expect((await post("{}")).status).toBe(401);
    session = async () => SIGNED_IN;
    expect((await post("x".repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
    expect(db.statements).toEqual([]);
  });

  it("records nothing off Railway, from a non-production environment or from a development machine", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "");
    expect((await post("{}")).status).toBe(204);
    // Another environment is not production, so it does not count either (Jed, Oct 7).
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    expect((await post(JSON.stringify({ path: "/teams", name: "TypeError", message: "boom" }))).status).toBe(204);
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    expect((await post("{}", { host: "localhost:3000" })).status).toBe(204);
    expect(db.statements).toEqual([]);
  });

  it("says 502 and logs only a code when the database will not take it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = fakeDatabase(() => {
      throw Object.assign(new Error("secret detail"), { code: "57P01" });
    });
    expect((await post(JSON.stringify({ path: "/teams", name: "TypeError", message: "boom" }))).status).toBe(502);
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret detail");
    expect(error.mock.calls.flat().join(" ")).not.toContain("boom");
    error.mockRestore();
  });
});
