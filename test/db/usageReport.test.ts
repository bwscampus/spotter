import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pacificMidnight } from "@/lib/report/pacificDay";
import { getPool, query, queryOne } from "@/lib/server/db";
import {
  checkUsageReport,
  claimReportDay,
  loadUsageReport,
  markReportSent,
  releaseReportDay,
  reportClaimed,
  type UsageReportDeps,
} from "@/lib/server/usageReport";

// The daily usage email (Nov 19) against a real database, as the app's role:
// the Pacific day's edges in SQL, drafts and preview events left out, admins
// marked, and the once-a-day claim in usage_reports. The admin flag is set as
// the owner (MIGRATION_DATABASE_URL), since the app can never set it. Made-up
// accounts on dates in 2020 that no other test writes.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
if (!ownerUrl) throw new Error("Set MIGRATION_DATABASE_URL to the owner of a migrated database (CI's db job does).");

const DAY = "2020-03-08"; // spring forward: 08:00Z to 07:00Z the next day
const CLAIM_DAYS = ["2020-01-01", "2020-01-02"];
const PREFIX = "usage-report-";
const tag = randomUUID().slice(0, 8);
const email = (label: string) => `${PREFIX}${label}-${tag}@example.com`;

let owner: pg.Client;

async function cleanUp() {
  await query("delete from users where email like $1", [`${PREFIX}%@example.com`]);
  await query("delete from usage_reports where report_date = any($1::date[])", [CLAIM_DAYS]);
}

async function user(label: string, createdAt: string, extra: { password?: boolean; onboarded?: boolean } = {}) {
  const row = await queryOne<{ id: string }>(
    `insert into users (google_sub, password_hash, email, name, created_at, sports, announcer_roles, onboarded_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      extra.password ? null : `${label}-${randomUUID()}`,
      extra.password ? "scrypt$probe" : null,
      email(label),
      `Probe ${label}`,
      createdAt,
      extra.onboarded ? ["football"] : [],
      extra.onboarded ? ["public_address"] : [],
      extra.onboarded ? createdAt : null,
    ],
  );
  return row!.id;
}

const game = (ownerId: string, startedAt: string, endedAt: string | null = null) =>
  queryOne<{ id: string }>(
    `insert into called_games (owner_id, home_school, away_school, sport, started_at, ended_at, status, mic_seconds, cards_shown)
     values ($1, 'Harborview', 'Cedar Ridge', 'football', $2, $3, $4, 600, 12) returning id`,
    [ownerId, startedAt, endedAt, endedAt ? "ended" : "live"],
  );

// The daily-cap trigger stamps received_at with now() on insert, so the test moves it afterwards.
async function event(ownerId: string, env: string, receivedAt: string) {
  const row = await queryOne<{ id: string }>(
    `insert into app_events (owner_id, name, env, app_version, session_id)
     values ($1, 'game.started', $2, 'abc1234', gen_random_uuid()) returning id`,
    [ownerId, env],
  );
  await query("update app_events set received_at = $2 where id = $1", [row!.id, receivedAt]);
}

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await cleanUp();

  await user("before", "2020-03-08T07:59:59Z");
  const first = await user("first", "2020-03-08T08:00:00Z", { onboarded: true });
  const last = await user("last", "2020-03-09T06:59:59Z", { password: true });
  const after = await user("after", "2020-03-09T07:00:00Z");
  const boss = await user("boss", "2020-03-08T20:00:00Z");
  // A superuser passes pg_has_role(.., 'app_rw', ..), so the admin guard refuses even the owner; skip triggers for this one write.
  await owner.query("begin");
  await owner.query("set local session_replication_role = replica");
  await owner.query("update users set is_admin = true where id = $1", [boss]);
  await owner.query("commit");

  const rated = await game(first, "2020-03-09T03:00:00Z", "2020-03-09T05:30:00Z");
  await query("insert into game_feedback (game_id, owner_id, rating) values ($1, $2, 5)", [rated!.id, first]);
  await game(boss, "2020-03-08T19:00:00Z");
  await game(first, "2020-03-09T07:00:00Z"); // the next day
  await query(`insert into called_games (owner_id, status, started_at, game_date) values ($1, 'draft', null, $2)`, [first, DAY]);

  await event(first, "production", "2020-03-08T08:00:00Z");
  await event(boss, "production", "2020-03-09T06:59:59Z");
  await event(last, "preview", "2020-03-08T12:00:00Z");
  await event(after, "production", "2020-03-09T07:00:00Z");
});

afterAll(async () => {
  await cleanUp();
  await owner.end();
  await getPool().end();
});

describe("the report's queries", () => {
  it("cover midnight to midnight Pacific exactly, the way Postgres reads the zone", async () => {
    for (const date of ["2020-03-08", "2020-11-01", "2026-03-08", "2026-11-01", "2026-07-04"]) {
      const row = await queryOne<{ start: Date }>(`select ($1::date)::timestamp at time zone 'America/Los_Angeles' as start`, [date]);
      expect(pacificMidnight(date).getTime()).toBe(row!.start.getTime());
    }
  });

  it("list the day's new accounts, games (no drafts) and production-active accounts, admins marked", async () => {
    const report = await loadUsageReport(DAY);
    const mine = <T extends { email: string }>(rows: T[]) => rows.filter((r) => r.email.endsWith(`-${tag}@example.com`));

    const accounts = mine(report.newAccounts);
    expect(accounts.map((a) => a.email)).toEqual([email("first"), email("boss"), email("last")]);
    expect(accounts[0]).toMatchObject({ name: "Probe first", google: true, password: false, onboarded: true, sports: ["football"], roles: ["public_address"], isAdmin: false });
    expect(accounts[1].isAdmin).toBe(true);
    expect(accounts[2]).toMatchObject({ google: false, password: true, emailConfirmed: false, onboarded: false });
    expect(Object.keys(accounts[0])).not.toContain("passwordHash");

    const games = mine(report.games);
    expect(games.map((g) => [g.email, g.isAdmin, g.rating])).toEqual([
      [email("boss"), true, null],
      [email("first"), false, 5],
    ]);
    expect(games[1]).toMatchObject({ sport: "football", homeSchool: "Harborview", awaySchool: "Cedar Ridge", micSeconds: 600, cardsShown: 12 });
    expect(games[1].endedAt?.toISOString()).toBe("2020-03-09T05:30:00.000Z");

    expect(mine(report.active)).toEqual([
      { email: email("boss"), isAdmin: true },
      { email: email("first"), isAdmin: false },
    ]);
  });
});

describe("the once-a-day claim", () => {
  const [day, other] = CLAIM_DAYS;

  it("is won by exactly one of many servers at once", async () => {
    const wins = await Promise.all(Array.from({ length: 6 }, () => claimReportDay(day)));
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await reportClaimed(day)).toBe(true);
  });

  it("is given back after a failed send, and never once sent", async () => {
    await releaseReportDay(day);
    expect(await reportClaimed(day)).toBe(false);
    expect(await claimReportDay(day)).toBe(true);
    await markReportSent(day);
    await releaseReportDay(day);
    expect(await claimReportDay(day)).toBe(false);
    const row = await queryOne<{ sent_at: Date | null }>("select sent_at from usage_reports where report_date = $1", [day]);
    expect(row!.sent_at).not.toBeNull();
  });

  it("sends once through the real table, retrying after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sends: string[] = [];
    let fail = true;
    const deps: UsageReportDeps = {
      now: () => new Date("2020-01-03T15:00:00Z"), // 7 AM PST on Jan 3: Jan 2 is due
      env: { RAILWAY_ENVIRONMENT_NAME: "production", STATS_REPORT_TO: "inbox@example.com" },
      claimed: reportClaimed,
      load: (date) => loadUsageReport(date),
      claim: claimReportDay,
      release: releaseReportDay,
      markSent: markReportSent,
      send: async (message) => (fail ? { sent: false, code: "send_failed" } : (sends.push(message.subject), { sent: true })),
    };
    expect(await checkUsageReport(deps)).toBe("failed");
    expect(await reportClaimed(other)).toBe(false);
    fail = false;
    const outcomes = await Promise.all([checkUsageReport(deps), checkUsageReport(deps), checkUsageReport(deps)]);
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(await checkUsageReport(deps)).toBe("already_sent");
    expect(sends).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
