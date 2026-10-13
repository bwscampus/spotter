import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Shared game logs in pieces (db/migrations/0020_shared_log_pieces.sql) against
// a real, migrated Postgres, through the real routes as the app's own role:
// a share is made on its first piece, a part sent again replaces it, another
// account's share id is a 404, the limits hold, and deleting the account takes
// every piece with it. The session is stubbed; everything else is real.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { PUT as rate } from "@/app/api/game-logs/[shareId]/feedback/route";
import { POST as finish } from "@/app/api/game-logs/[shareId]/finish/route";
import { POST as sharePiece } from "@/app/api/game-logs/pieces/route";
import { getPool, query, queryOne } from "@/lib/server/db";

const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, body: unknown) =>
  new Request("https://spotter.test/api/game-logs/x", { method, headers: HEADERS, body: JSON.stringify(body) });
const params = (shareId: string) => ({ params: Promise.resolve({ shareId }) });
const piece = (shareId: string, part: number, log = "H4sIAAAA", records = 10) => ({
  share_id: shareId,
  part,
  sport: "football",
  stats_enabled: true,
  scrub_version: 3,
  records,
  masked: 1,
  log_gz_b64: log,
  app_commit: part === 0 ? "16aa014" : null,
  header: part === 0 ? { source: "room", keyterms: 120 } : null,
});

let alice: User;
let bob: User;

async function makeUser(label: string): Promise<User> {
  const row = await queryOne<{ id: string }>(
    "insert into users (google_sub, email, approved) values ($1, $2, true) returning id",
    [`${label}-${randomUUID()}`, `${label}-${randomUUID()}@example.com`],
  );
  return { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
}

type Header = { owner_hash: string; pieces: number; records: number; chars: string; complete: boolean; counts: unknown; rating: number | null; blockers: string[] | null; app_commit: string | null; header: unknown; expires_days: number };
const headerOf = (shareId: string) =>
  queryOne<Header>(
    `select owner_hash, pieces, records, chars, complete, counts, rating, blockers, app_commit, header,
            round(extract(epoch from expires_at - created_at) / 86400)::int as expires_days
     from shared_game_logs where share_id = $1`,
    [shareId],
  );

beforeAll(async () => {
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterEach(() => {
  current = null;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await query("delete from users where id = any($1::uuid[])", [[alice.id, bob.id]]);
  await getPool().end();
});

describe("a share in pieces", () => {
  it("is made by its first piece, kept a year, and counts what each piece adds", async () => {
    current = alice;
    const shareId = randomUUID();
    expect((await sharePiece(call("POST", piece(shareId, 0, "AAAA", 10)))).status).toBe(201);
    expect((await sharePiece(call("POST", piece(shareId, 1, "BBBBBB", 7)))).status).toBe(201);
    const header = await headerOf(shareId);
    expect(header).toMatchObject({ pieces: 2, records: 17, chars: "10", complete: false, app_commit: "16aa014", header: { source: "room", keyterms: 120 } });
    expect(header!.expires_days).toBe(365);
  });

  it("replaces a part sent again, rather than counting it twice", async () => {
    current = alice;
    const shareId = randomUUID();
    await sharePiece(call("POST", piece(shareId, 0, "AAAA", 10)));
    await sharePiece(call("POST", piece(shareId, 0, "AAAAAAAA", 12)));
    expect(await headerOf(shareId)).toMatchObject({ pieces: 1, records: 12, chars: "8" });
    const rows = await query<{ n: number }>("select count(*)::int as n from shared_game_log_pieces where share_id = $1", [shareId]);
    expect(rows[0].n).toBe(1);
  });

  it("is another account's to nobody: a piece, finish or rating on it is a 404 and changes nothing", async () => {
    current = alice;
    const shareId = randomUUID();
    await sharePiece(call("POST", piece(shareId, 0)));
    current = bob;
    expect((await sharePiece(call("POST", piece(shareId, 1)))).status).toBe(404);
    expect((await finish(call("POST", { counts: { cards_shown: 1 } }), params(shareId))).status).toBe(404);
    expect((await rate(call("PUT", { rating: 1, blockers: [] }), params(shareId))).status).toBe(404);
    expect(await headerOf(shareId)).toMatchObject({ pieces: 1, complete: false, counts: null, rating: null });
  });

  it("is finished with the game's counts and rated with its chips, never a note", async () => {
    current = alice;
    const shareId = randomUUID();
    await sharePiece(call("POST", piece(shareId, 0)));
    expect((await finish(call("POST", { counts: { cards_shown: 41, plays_applied: 0 } }), params(shareId))).status).toBe(200);
    expect((await rate(call("PUT", { rating: 4, blockers: ["slow"], note: "never stored" }), params(shareId))).status).toBe(200);
    expect(await headerOf(shareId)).toMatchObject({ complete: true, counts: { cards_shown: 41, plays_applied: 0 }, rating: 4, blockers: ["slow"] });
    expect((await finish(call("POST", {}), params(randomUUID()))).status).toBe(404);
  });

  it("holds an account to 20 shares a day", async () => {
    const carol = await makeUser("carol");
    current = carol;
    try {
      for (let index = 0; index < 20; index++) expect((await sharePiece(call("POST", piece(randomUUID(), 0)))).status).toBe(201);
      const response = await sharePiece(call("POST", piece(randomUUID(), 0)));
      expect(response.status).toBe(429);
      // More pieces of a share already made are still taken.
      const [{ share_id }] = await query<{ share_id: string }>(
        "select share_id from shared_game_logs where owner_hash = public.shared_log_owner_hash($1) limit 1",
        [carol.id],
      );
      expect((await sharePiece(call("POST", piece(share_id, 1)))).status).toBe(201);
    } finally {
      await query("select public.delete_my_account($1)", [carol.id]);
    }
  });

  it("goes, every piece of it, when the account is deleted", async () => {
    const dave = await makeUser("dave");
    current = dave;
    const shareId = randomUUID();
    await sharePiece(call("POST", piece(shareId, 0)));
    await sharePiece(call("POST", piece(shareId, 1)));
    await query("select public.delete_my_account($1)", [dave.id]);
    const rows = await query<{ n: number }>(
      "select (select count(*) from shared_game_log_pieces where share_id = $1)::int + (select count(*) from shared_game_logs where share_id = $1)::int as n",
      [shareId],
    );
    expect(rows[0].n).toBe(0);
  });
});
