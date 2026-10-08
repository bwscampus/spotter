import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieJar, fakeDatabase } from "./fakeServer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

// The account routes below run with a stubbed session, the cookie jar and the
// fake database from test/fakeServer.ts. V3 did all of this in the browser
// through Supabase RPCs; here the browser calls a route that calls the function
// with the session's id.
// A plain function, not a spy, so each test can say who is signed in.
let session: () => Promise<unknown> = async () => null;
let jar = fakeCookieJar();
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/server/session", async (original) => ({
  ...(await original<typeof import("@/lib/server/session")>()),
  readSession: () => session(),
}));
let db = fakeDatabase();
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { UploadTermsProvider } from "@/components/auth/UploadTerms";
import { RosterImport } from "@/components/rosters/RosterImport";
import { POST as acceptTerms } from "@/app/api/upload-terms/route";
import { DELETE as deleteMe } from "@/app/api/me/route";
import { hashPassword } from "@/lib/server/password";
import { SESSION_COOKIE } from "@/lib/server/session";

// Audit M5: before the first import, an account says it has the right to use
// what it uploads. Until it ticks the box, nothing can be read.

const CONSENT = "I have the right to use this roster or stats sheet for my broadcast";
const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function signedIn(fields: Record<string, unknown> = {}) {
  const user = { id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date(), ...fields };
  session = async () => user;
}

function render(accepted: boolean): string {
  return renderToStaticMarkup(
    createElement(
      UploadTermsProvider,
      // children arrives as the third argument; the cast only satisfies the prop type.
      { accepted } as ComponentProps<typeof UploadTermsProvider>,
      createElement(RosterImport, { onImported: () => undefined, open: true }),
    ),
  );
}

describe("the upload consent", () => {
  it("asks before the first import, with every import button off until it is ticked", () => {
    const html = render(false);
    expect(html).toContain(CONSENT);
    expect(html).toMatch(/<input type="checkbox"/);
    expect(html).toMatch(/href="\/terms"/);
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
  });

  it("is gone once given", () => {
    const html = render(true);
    expect(html).not.toContain(CONSENT);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });
});

describe("POST /api/upload-terms", () => {
  const post = (headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
    acceptTerms(new Request("https://spotter.example/api/upload-terms", { method: "POST", headers }));

  beforeEach(() => {
    session = async () => null;
    db = fakeDatabase();
  });

  it("stamps the time through accept_upload_terms, for the session's account only", async () => {
    signedIn();
    const response = await post();
    expect(response.status).toBe(200);
    expect(db.statements).toEqual([{ text: "select public.accept_upload_terms($1)", params: [USER] }]);
  });

  it("refuses a signed-out caller and another site, and stamps nothing", async () => {
    expect((await post()).status).toBe(401);
    signedIn();
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(db.statements).toEqual([]);
  });
});

describe("whether the consent was given, for the layout", () => {
  beforeEach(() => vi.resetModules());

  it("reads the session's own row, and asks again when signed out or when the read fails", async () => {
    signedIn();
    db = fakeDatabase(() => [{ accepted: true }]);
    let { getUploadTermsAccepted } = await import("@/lib/auth/viewer");
    expect(await getUploadTermsAccepted()).toBe(true);
    expect(db.statements[0].text).toContain("accepted_upload_terms_at is not null");
    expect(db.statements[0].params).toEqual([USER]);

    vi.resetModules();
    session = async () => null;
    db = fakeDatabase(() => [{ accepted: true }]);
    ({ getUploadTermsAccepted } = await import("@/lib/auth/viewer"));
    expect(await getUploadTermsAccepted()).toBe(false);
    expect(db.statements).toEqual([]);

    vi.resetModules();
    signedIn();
    db = fakeDatabase(() => {
      throw new Error("down");
    });
    ({ getUploadTermsAccepted } = await import("@/lib/auth/viewer"));
    expect(await getUploadTermsAccepted()).toBe(false);
  });
});

describe("DELETE /api/me", () => {
  const PASSWORD = "correct horse battery";
  let stored: string;

  const del = (body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
    deleteMe(
      new Request("https://spotter.example/api/me", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  const deleted = () => db.statements.filter((s) => s.text.includes("public.delete_my_account("));

  beforeEach(async () => {
    session = async () => null;
    jar = fakeCookieJar({ [SESSION_COOKIE]: "raw-session-token" });
    stored ??= await hashPassword(PASSWORD);
  });

  describe("a password account", () => {
    beforeEach(() => {
      signedIn();
      db = fakeDatabase((text) => (text.includes("select password_hash") ? [{ password_hash: stored }] : []));
    });

    it("needs the current password, and deletes nothing without it", async () => {
      for (const body of [{}, { password: "wrong password" }, { password: 12345678 }]) {
        const response = await del(body);
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe("wrong_password");
      }
      expect(deleted()).toEqual([]);
      expect(jar.store.get(SESSION_COOKIE)?.value).toBe("raw-session-token");
    });

    it("with it, deletes the session's own account and signs this browser out", async () => {
      const response = await del({ password: PASSWORD });
      expect(response.status).toBe(200);
      expect(deleted().map((s) => s.params)).toEqual([[USER]]);
      expect(jar.store.get(SESSION_COOKIE)?.value).toBe("");
    });
  });

  describe("a Google account", () => {
    beforeEach(() => {
      db = fakeDatabase((text) => (text.includes("select password_hash") ? [{ password_hash: null }] : []));
    });

    it("needs a sign-in within the last ten minutes", async () => {
      signedIn({ signedInAt: new Date(Date.now() - 11 * 60_000) });
      const response = await del({});
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("reauth_required");
      expect(deleted()).toEqual([]);
    });

    it("deletes after a fresh sign-in", async () => {
      signedIn({ signedInAt: new Date(Date.now() - 2 * 60_000) });
      expect((await del({})).status).toBe(200);
      expect(deleted().map((s) => s.params)).toEqual([[USER]]);
    });
  });

  it("refuses a signed-out caller and another site", async () => {
    db = fakeDatabase();
    expect((await del({})).status).toBe(401);
    signedIn({ signedInAt: new Date() });
    expect((await del({}, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(deleted()).toEqual([]);
  });
});

// V3 read four Supabase migrations here. Their grants, row level security and
// security definer checks are dropped: this repo has none of them (the app's
// role has rows on every public table, and each function takes p_owner from
// the route). What the TypeScript relies on is held below.
describe("the migrations behind it", () => {
  const sql = ["0008_shared_game_logs.sql", "0010_accounts_and_errors.sql", "0011_delete_my_account.sql"]
    .map((file) => readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"))
    .join("\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("sets the time only through a function that takes the owner and keeps the first time", () => {
    expect(sql).toMatch(/add column accepted_upload_terms_at timestamptz/);
    const body = /create function public\.accept_upload_terms\(p_owner uuid\)[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(body).toContain("coalesce(accepted_upload_terms_at, now())");
    expect(body).toContain("where id = p_owner");
  });

  it("works a shared log's owner hash out inside the database, never from what the browser sends", () => {
    const body = /create function public\.share_game_log\([\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(body).toContain("public.shared_log_owner_hash(p_owner)");
    expect(body).not.toMatch(/p_owner_hash/);
    expect(sql).toMatch(/encode\(sha256\(convert_to\(p_owner::text, 'UTF8'\)\), 'hex'\)/);
  });

  it("caps a shared log at what the browser can send", async () => {
    const { MAX_SHARE_CHARS } = await import("@/lib/log/shareLog");
    const cap = /check \(char_length\(log_gz_b64\) between 1 and (\d+)\)/.exec(sql);
    expect(Number(cap?.[1])).toBe(MAX_SHARE_CHARS);
  });

  it("deletes an account's shared logs by its hash, then the account, and only the one it is given", () => {
    const body = /create function public\.delete_my_account\(p_owner uuid\)[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(body).toContain("set search_path = ''");
    expect(body).toMatch(/delete from public\.shared_game_logs\s+where owner_hash = public\.shared_log_owner_hash\(p_owner\)/);
    expect(body).toMatch(/delete from public\.users where id = p_owner/);
    expect(body.indexOf("shared_game_logs")).toBeLessThan(body.indexOf("public.users"));
  });

  it("keeps client errors to 20 an hour per account, production and preview only", () => {
    const body = /create function public\.record_client_error\([\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(body).toContain("where owner_id = p_owner and at > now() - interval '1 hour'");
    expect(body).toContain(">= 20");
    expect(body).toContain("p_env not in ('production', 'preview')");
  });

  it("grants nothing on the admin views", () => {
    expect(sql).toMatch(/create view admin\.pending_approvals/);
    expect(sql).toMatch(/create view admin\.recent_client_errors/);
    expect(sql).toMatch(/revoke all on admin\.pending_approvals from public;/);
    expect(sql).toMatch(/revoke all on admin\.recent_client_errors from public;/);
    expect(sql).not.toMatch(/grant [^;]* on admin\./i);
  });
});

describe("the account deletion in the browser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("names the same IndexedDB database the game log uses", async () => {
    const { GAME_LOG_DB } = await import("@/lib/auth/deleteAccount");
    const source = readFileSync(new URL("../lib/log/gameLog.ts", import.meta.url), "utf8");
    expect(source).toContain(`const DB_NAME = "${GAME_LOG_DB}"`);
  });

  it("asks DELETE /api/me with the password, and clears this browser's copy only once the server has deleted", async () => {
    const { deleteMyAccount, GAME_LOG_DB } = await import("@/lib/auth/deleteAccount");
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const deleteDatabase = vi.fn();
    const cleared = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("indexedDB", { deleteDatabase });
    vi.stubGlobal("localStorage", { clear: cleared });
    vi.stubGlobal("sessionStorage", { clear: cleared });

    expect(await deleteMyAccount("hunter22")).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ password: "hunter22" }) }));
    expect(deleteDatabase).toHaveBeenCalledWith(GAME_LOG_DB);
    expect(cleared).toHaveBeenCalledTimes(2);
  });

  it("passes the server's own sentence on, and keeps everything, when the server says no", async () => {
    const { deleteMyAccount } = await import("@/lib/auth/deleteAccount");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "wrong_password", error: "That password is not right. Nothing was deleted." }, { status: 403 })),
    );
    expect(await deleteMyAccount("nope")).toEqual({ ok: false, message: "That password is not right. Nothing was deleted." });
    expect(deleteDatabase).not.toHaveBeenCalled();
  });
});
