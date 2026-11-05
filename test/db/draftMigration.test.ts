import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 0025_draft_games.sql on a database that already has games (Nov 3): a game
// never ended becomes 'live', an ended one 'ended', and the old insert path
// (no status, no started_at) still works. Run on a throwaway database made
// from every migration before it, as the owner (MIGRATION_DATABASE_URL, which
// CI sets for the whole db job), and dropped afterwards.

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
if (!ownerUrl) throw new Error("Set MIGRATION_DATABASE_URL to the owner of a migrated database (CI's db job does).");

const DIR = new URL("../../db/migrations/", import.meta.url);
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const DRAFTS = FILES.find((file) => file.startsWith("0025_"))!;
const BEFORE = FILES.filter((file) => file < DRAFTS);
const name = `spotter_backfill_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
let admin: pg.Client;
let copy: pg.Client;

const run = async (file: string) => {
  await copy.query("begin");
  await copy.query(readFileSync(new URL(file, DIR), "utf8"));
  await copy.query("commit");
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${name}`;
  copy = new pg.Client({ connectionString: url.toString() });
  await copy.connect();
  // 0001's trigger names the app role, which already exists on this server.
  for (const file of BEFORE) await run(file);
}, 60_000);

afterAll(async () => {
  await copy?.end();
  if (admin) {
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
});

describe("0025_draft_games.sql on existing games", () => {
  it("backfills live and ended, keeps the old insert path, and checks drafts", async () => {
    const {
      rows: [{ id: owner }],
    } = await copy.query("insert into users (google_sub, email, approved) values ('sub-backfill', 'backfill@example.com', true) returning id");
    const {
      rows: [{ id: open }],
    } = await copy.query("insert into called_games (owner_id, home_school, away_school, sport) values ($1, 'Harborview', 'Millbrook', 'football') returning id", [owner]);
    const {
      rows: [{ id: ended }],
    } = await copy.query(
      "insert into called_games (owner_id, home_school, away_school, ended_at, mic_seconds) values ($1, 'Harborview', 'Millbrook', now(), 600) returning id",
      [owner],
    );

    await run(DRAFTS);

    const { rows } = await copy.query("select id, status, started_at is not null as started from called_games where owner_id = $1", [owner]);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[open]).toMatchObject({ status: "live", started: true });
    expect(byId[ended]).toMatchObject({ status: "ended", started: true });

    // The insert a replica still running the old code makes: no status, no started_at.
    const {
      rows: [old],
    } = await copy.query("insert into called_games (owner_id, home_school, away_school) values ($1, 'A', 'B') returning status, started_at is not null as started", [owner]);
    expect(old).toEqual({ status: "live", started: true });

    // A draft: a date, no start, no schools needed.
    const {
      rows: [draft],
    } = await copy.query("insert into called_games (owner_id, status, started_at, game_date) values ($1, 'draft', null, '2026-11-06') returning status", [owner]);
    expect(draft.status).toBe("draft");
    await expect(copy.query("insert into called_games (owner_id, status, started_at) values ($1, 'draft', null)", [owner])).rejects.toMatchObject({ code: "23514" });
    await expect(copy.query("insert into called_games (owner_id, status, home_school, away_school) values ($1, 'ended', 'A', 'B')", [owner])).rejects.toMatchObject({ code: "23514" });
  });
});
