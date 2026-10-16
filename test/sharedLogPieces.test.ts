import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";

// Shared game logs in pieces (Oct 12, db/migrations/0020_shared_log_pieces.sql):
// what the browser may send (lib/log/sharedLogWire.ts), the three routes that
// take it, and joining the pieces back into one log (lib/log/sharedPull.ts,
// the pull script's pure part). The database functions themselves run against
// a real Postgres in test/db/sharedLogs.test.ts and scripts/check-app-role.mjs.

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
const SHARE = "3b8d6a1e-2f4c-4e8a-9b61-0c5e7a1d2f40";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({
  readSession: async () => ({ id: USER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() }),
}));
let refuse: { code: string; message: string } | null = null;
const db = fakeDatabase(() => {
  if (refuse) throw Object.assign(new Error(refuse.message), refuse);
  return [];
});
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { flatValues, MAX_PIECE_CHARS, MAX_PIECES, readPiece, readShareId } from "@/lib/log/sharedLogWire";
import { joinShare, sharedFileBase, shareMeta, type PulledShare } from "@/lib/log/sharedPull";
import { isSport } from "@/lib/rosters/types";

const PIECE = {
  share_id: SHARE,
  part: 0,
  sport: "football",
  stats_enabled: true,
  scrub_version: 3,
  records: 120,
  masked: 4,
  log_gz_b64: "H4sIAAAA",
  app_commit: "16aa014",
  header: { source: "room", keyterms: 210, trimmed: false, stats_auto: true },
};

const MIGRATION = readFileSync(new URL("../db/migrations/0020_shared_log_pieces.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("a piece the browser sends", () => {
  it("is read whole when every field is right", () => {
    expect(readPiece(PIECE, isSport)).toEqual(PIECE);
    expect(readPiece({ ...PIECE, app_commit: null, header: null, sport: null }, isSport)).toMatchObject({ app_commit: null, header: null, sport: null });
    expect(readPiece({ ...PIECE, share_id: SHARE.toUpperCase() }, isSport)!.share_id).toBe(SHARE);
  });

  it("is refused when anything is off", () => {
    const bad = [
      { share_id: "not-a-uuid" },
      { part: -1 },
      { part: MAX_PIECES },
      { part: 1.5 },
      { sport: "curling" },
      { stats_enabled: "yes" },
      { scrub_version: 0 },
      { records: -1 },
      { log_gz_b64: "" },
      { log_gz_b64: "not base64!" },
      { log_gz_b64: "A".repeat(MAX_PIECE_CHARS + 1) },
      { app_commit: "main" },
      { header: { said: "x".repeat(41) } },
      { header: { nested: { a: 1 } } },
      { header: { "Bad Key": 1 } },
      { header: [1, 2] },
    ];
    for (const change of bad) expect(readPiece({ ...PIECE, ...change }, isSport), JSON.stringify(change).slice(0, 60)).toBeNull();
    expect(readPiece(null, isSport)).toBeNull();
  });

  it("carries settings and numbers only, never text anybody said", () => {
    expect(flatValues({ cards_shown: 41, source: "room", ok: true, none: null })).toEqual({ cards_shown: 41, source: "room", ok: true, none: null });
    expect(flatValues({ transcript: "fennimore up the middle for six brought down by quillon" })).toBeNull();
    expect(flatValues({ n: Number.NaN })).toBeNull();
    expect(flatValues(Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, i])))).toBeNull();
  });

  it("names a share by a uuid only", () => {
    expect(readShareId(SHARE)).toBe(SHARE);
    expect(readShareId("../etc")).toBeNull();
  });

  it("is held to the same limits the database holds", () => {
    expect(MIGRATION).toMatch(new RegExp(`char_length\\(log_gz_b64\\) between 1 and ${MAX_PIECE_CHARS}`));
    expect(MIGRATION).toMatch(new RegExp(`part between 0 and ${MAX_PIECES - 1}`));
    expect(MIGRATION).toMatch(/pieces between 0 and 300/);
  });
});

describe("the database's side", () => {
  it("keeps new shares a year and leaves the ones already shared at their 90 days", () => {
    expect(MIGRATION).toMatch(/alter column expires_at set default now\(\) \+ interval '365 days'/);
    expect(MIGRATION).not.toMatch(/update shared_game_logs set expires_at/);
  });

  it("joins no share to an owner, a game or a school", () => {
    // The table's comments say so in words; the columns and functions must not.
    const code = MIGRATION.replace(/comment on table \w+ is\s*'(?:[^']|'')*';/g, "");
    expect(code).not.toMatch(/owner_id|game_id|school/);
  });

  it("takes the end-of-game chips from the same list as game_feedback", () => {
    const chips = (sql: string) => /blockers <@ array\[([^\]]+)\]/.exec(sql)![1].replace(/\s+/g, "");
    const feedback = readFileSync(new URL("../db/migrations/0003_called_games.sql", import.meta.url), "utf8");
    expect(chips(MIGRATION)).toBe(chips(feedback));
  });

  it("deletes pieces with their share, so account deletion and expiry need no change", () => {
    expect(MIGRATION).toMatch(/references shared_game_logs \(share_id\) on delete cascade/);
  });
});

describe("the routes", () => {
  const call = (method: string, path: string, body: unknown) =>
    new Request(`https://spotter.example${path}`, {
      method,
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const params = (shareId: string) => ({ params: Promise.resolve({ shareId }) });

  beforeEach(() => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    db.statements.length = 0;
    refuse = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores a piece under the session's account, argument for argument", async () => {
    const { POST } = await import("@/app/api/game-logs/pieces/route");
    const response = await POST(call("POST", "/api/game-logs/pieces", { ...PIECE, owner_hash: "f".repeat(64), owner: "someone-else" }));
    expect(response.status).toBe(201);
    const [statement] = db.statements;
    expect(statement.text).toContain("public.share_game_log_piece($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)");
    expect(statement.params).toEqual([USER, SHARE, 0, "football", true, 3, 120, 4, "H4sIAAAA", "16aa014", JSON.stringify(PIECE.header)]);
  });

  it("sends exactly share_game_log_piece's arguments", () => {
    const args = /create function public\.share_game_log_piece\(([^)]+)\)/.exec(MIGRATION)![1]
      .split(",")
      .map((arg) => arg.trim().split(/\s+/)[0].replace(/^p_/, ""));
    expect(args).toEqual(["owner", ...Object.keys(PIECE)]);
  });

  it("refuses a bad piece before the database, and says what the database refused", async () => {
    const { POST } = await import("@/app/api/game-logs/pieces/route");
    expect((await POST(call("POST", "/api/game-logs/pieces", { ...PIECE, part: -1 }))).status).toBe(400);
    expect(db.statements).toHaveLength(0);
    const answers: Array<[{ code: string; message: string }, number, string]> = [
      [{ code: "P0002", message: "share_not_found" }, 404, "not_found"],
      [{ code: "P0001", message: "shared_log_daily_limit" }, 429, "shared_log_daily_limit"],
      [{ code: "P0001", message: "shared_log_too_large" }, 413, "too_large"],
      [{ code: "42501", message: "not_approved" }, 403, "not_approved"],
    ];
    for (const [error, status, code] of answers) {
      refuse = error;
      const response = await POST(call("POST", "/api/game-logs/pieces", PIECE));
      expect(response.status).toBe(status);
      expect(((await response.json()) as { code: string }).code).toBe(code);
    }
  });

  it("keeps nothing anywhere but production", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "testrun2");
    const { POST } = await import("@/app/api/game-logs/pieces/route");
    const finish = (await import("@/app/api/game-logs/[shareId]/finish/route")).POST;
    const rate = (await import("@/app/api/game-logs/[shareId]/feedback/route")).PUT;
    expect((await POST(call("POST", "/api/game-logs/pieces", PIECE))).status).toBe(204);
    expect((await finish(call("POST", "/x", {}), params(SHARE))).status).toBe(204);
    expect((await rate(call("PUT", "/x", { rating: 4, blockers: [] }), params(SHARE))).status).toBe(204);
    expect(db.statements).toHaveLength(0);
  });

  it("finishes a share with the game's counts", async () => {
    const { POST } = await import("@/app/api/game-logs/[shareId]/finish/route");
    const counts = { cards_shown: 41, cards_removed: 3, plays_applied: 0 };
    expect((await POST(call("POST", "/x", { counts }), params(SHARE))).status).toBe(200);
    expect(db.statements[0].params).toEqual([USER, SHARE, JSON.stringify(counts)]);
    expect((await POST(call("POST", "/x", { counts: { said: "fennimore up the middle for six, brought down by quillon" } }), params(SHARE))).status).toBe(400);
    expect((await POST(call("POST", "/x", {}), params("nope"))).status).toBe(404);
    refuse = { code: "P0002", message: "share_not_found" };
    expect((await POST(call("POST", "/x", {}), params(SHARE))).status).toBe(404);
  });

  it("lays the rating and chips on a share, and never reads the note", async () => {
    const { PUT } = await import("@/app/api/game-logs/[shareId]/feedback/route");
    const response = await PUT(call("PUT", "/x", { rating: 4, blockers: ["slow", "slow", "wrong_names"], note: "Langan was never spotted" }), params(SHARE));
    expect(response.status).toBe(200);
    expect(db.statements[0].params).toEqual([USER, SHARE, 4, ["slow", "wrong_names"]]);
    expect(JSON.stringify(db.statements)).not.toContain("Langan");
    for (const body of [{ rating: 0, blockers: [] }, { rating: 4.5, blockers: [] }, { rating: 4, blockers: ["boring"] }, { rating: 4 }]) {
      expect((await PUT(call("PUT", "/x", body), params(SHARE))).status).toBe(400);
    }
  });

  it("refuses a request from another site", async () => {
    const { POST } = await import("@/app/api/game-logs/pieces/route");
    const request = new Request("https://spotter.example/api/game-logs/pieces", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify(PIECE),
    });
    expect((await POST(request)).status).toBe(403);
    expect(db.statements).toHaveLength(0);
  });
});

describe("pulling a share back out", () => {
  const gz = (value: unknown) => gzipSync(JSON.stringify(value)).toString("base64");
  const gunzip = (base64: string) => gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
  const share: PulledShare = {
    id: "5d6b19c4-0000-4000-8000-000000000000",
    shareId: SHARE,
    createdAt: new Date("2026-10-12T19:31:07Z"),
    sport: "football",
    statsEnabled: true,
    scrubVersion: 3,
    complete: false,
    pieces: 3,
    records: 3,
    appCommit: "16aa014",
    header: { source: "room" },
    counts: null,
    rating: 4,
    blockers: ["slow"],
    wholeLog: null,
  };

  it("joins the pieces in part order into one log the replays read, and says which never arrived", () => {
    const pieces = [
      { part: 3, logGzB64: gz({ format: "spotter-v3-shared-log", scrubVersion: 3, records: [{ n: 4 }] }) },
      { part: 0, logGzB64: gz({ format: "spotter-v3-shared-log", scrubVersion: 3, records: [{ n: 1 }, { n: 2 }] }) },
      { part: 1, logGzB64: gz({ format: "spotter-v3-shared-log", scrubVersion: 3, records: [{ n: 3 }] }) },
    ];
    const { log, missingParts } = joinShare(share, pieces, gunzip);
    expect(log).toEqual({ format: "spotter-v3-shared-log", scrubVersion: 3, records: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
    expect(missingParts).toEqual([2]);
  });

  it("reads a share from before pieces as the whole log it was", () => {
    const whole = { format: "spotter-v3-shared-log", scrubVersion: 2, records: [{ n: 1 }] };
    expect(joinShare({ ...share, shareId: null, wholeLog: gz(whole) }, [], gunzip)).toEqual({ log: whole, missingParts: [] });
  });

  it("names the file by when it was shared and its row, and writes what is known beside it", () => {
    expect(sharedFileBase(share)).toBe("shared-20261012-1931-5d6b19c4");
    expect(shareMeta(share, [2])).toEqual({
      createdAt: "2026-10-12T19:31:07.000Z",
      sport: "football",
      statsEnabled: true,
      scrubVersion: 3,
      complete: false,
      pieces: 3,
      missingParts: [2],
      records: 3,
      appCommit: "16aa014",
      header: { source: "room" },
      counts: null,
      rating: 4,
      blockers: ["slow"],
    });
  });
});
