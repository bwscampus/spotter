// The daily usage email (Nov 19, Jed): every morning the app emails
// STATS_REPORT_TO yesterday's activity, in Pacific time. Run every 15 minutes by
// lib/server/housekeeping.ts; also `npm run report:usage -- --date YYYY-MM-DD`,
// which prints it instead.
//
// This is the one place the app reads across accounts on purpose: it is never
// reachable from a route or a page (test/usageReport.test.ts holds app/ and
// components/ to that), and only the server's own clock and variables start it.
//
// PRIVACY: the report holds account names and emails. It is built in memory,
// emailed to one address and dropped. Nothing here logs the body, an address or
// a name: log lines carry the report date and a code. No player names, rosters,
// transcripts or file contents are read.

import { sendEmail, type EmailMessage, type SendResult } from "@/lib/server/email";
import { query, queryOne, type Queryable } from "@/lib/server/db";
import { pacificDayWindow, reportDue } from "@/lib/report/pacificDay";
import { formatUsageReport, reportHtml, type UsageReportData } from "@/lib/report/usageReport";

const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "unknown";
};

/** Reads one Pacific day's report. Never selects a sign-in secret: only whether each way exists. */
export async function loadUsageReport(date: string, client?: Queryable): Promise<UsageReportData> {
  const { start, end } = pacificDayWindow(date);
  const window = [start.toISOString(), end.toISOString()];

  const accounts = await query<{
    name: string | null;
    email: string;
    is_admin: boolean;
    google: boolean;
    password: boolean;
    confirmed: boolean;
    onboarded: boolean;
    sports: string[];
    other_sports: string[];
    announcer_roles: string[];
  }>(
    `select name, email, is_admin,
            google_sub is not null as google, password_hash is not null as password,
            email_verified_at is not null as confirmed, onboarded_at is not null as onboarded,
            sports, other_sports, announcer_roles
       from users
      where created_at >= $1 and created_at < $2
      order by created_at, id`,
    window,
    client,
  );

  const games = await query<{
    email: string;
    is_admin: boolean;
    sport: string | null;
    home_school: string | null;
    away_school: string | null;
    started_at: Date;
    ended_at: Date | null;
    mic_seconds: number;
    cards_shown: number;
    booth_guest: boolean;
    rating: number | null;
  }>(
    `select u.email, u.is_admin, g.sport, g.home_school, g.away_school, g.started_at, g.ended_at,
            g.mic_seconds, g.cards_shown, g.booth_guest, f.rating
       from called_games g
       join users u on u.id = g.owner_id
       left join game_feedback f on f.game_id = g.id
      where g.status <> 'draft' and g.started_at >= $1 and g.started_at < $2
      order by g.started_at, g.id`,
    window,
    client,
  );

  // received_at is the server's clock; an event's own `at` comes from the browser.
  const active = await query<{ email: string; is_admin: boolean }>(
    `select u.email, u.is_admin
       from users u
      where exists (
        select 1 from app_events e
         where e.owner_id = u.id and e.env = 'production' and e.received_at >= $1 and e.received_at < $2
      )
      order by lower(u.email)`,
    window,
    client,
  );

  return {
    date,
    newAccounts: accounts.map((a) => ({
      name: a.name,
      email: a.email,
      isAdmin: a.is_admin,
      google: a.google,
      password: a.password,
      emailConfirmed: a.confirmed,
      onboarded: a.onboarded,
      sports: a.sports,
      otherSports: a.other_sports,
      roles: a.announcer_roles,
    })),
    games: games.map((g) => ({
      email: g.email,
      isAdmin: g.is_admin,
      sport: g.sport,
      homeSchool: g.home_school,
      awaySchool: g.away_school,
      startedAt: g.started_at,
      endedAt: g.ended_at,
      micSeconds: g.mic_seconds,
      cardsShown: g.cards_shown,
      boothGuest: g.booth_guest,
      rating: g.rating === null ? null : Number(g.rating),
    })),
    active: active.map((a) => ({ email: a.email, isAdmin: a.is_admin })),
  };
}

/** Whether a day's report has been claimed (sent, or being sent). */
export async function reportClaimed(date: string, client?: Queryable): Promise<boolean> {
  return (await queryOne("select 1 from usage_reports where report_date = $1", [date], client)) !== null;
}

/** Claims a day. True for exactly one caller, however many servers ask at once. */
export async function claimReportDay(date: string, client?: Queryable): Promise<boolean> {
  const row = await queryOne(
    "insert into usage_reports (report_date) values ($1) on conflict (report_date) do nothing returning report_date",
    [date],
    client,
  );
  return row !== null;
}

/** Gives a claim back after a failed send, so the next check retries. A sent day is never released. */
export async function releaseReportDay(date: string, client?: Queryable): Promise<void> {
  await query("delete from usage_reports where report_date = $1 and sent_at is null", [date], client);
}

export async function markReportSent(date: string, client?: Queryable): Promise<void> {
  await query("update usage_reports set sent_at = now() where report_date = $1", [date], client);
}

export function usageReportMessage(to: string, data: UsageReportData): EmailMessage {
  const { subject, text } = formatUsageReport(data);
  return { kind: "usage_report", to, subject, text, html: reportHtml(text) };
}

/** The two variables the check reads. */
export type ReportEnv = { RAILWAY_ENVIRONMENT_NAME?: string; STATS_REPORT_TO?: string };

/** A plausible single address. The value itself is never logged. */
export function reportRecipient(env: ReportEnv): string | null {
  const to = env.STATS_REPORT_TO?.trim();
  if (!to) return null;
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) && to.length <= 320 ? to : null;
}

export type UsageReportDeps = {
  now: () => Date;
  env: ReportEnv;
  claimed: (date: string) => Promise<boolean>;
  load: (date: string) => Promise<UsageReportData>;
  claim: (date: string) => Promise<boolean>;
  release: (date: string) => Promise<void>;
  markSent: (date: string) => Promise<void>;
  send: (message: EmailMessage) => Promise<SendResult>;
};

const defaultDeps = (): UsageReportDeps => ({
  now: () => new Date(),
  env: { RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME, STATS_REPORT_TO: process.env.STATS_REPORT_TO },
  claimed: (date) => reportClaimed(date),
  load: (date) => loadUsageReport(date),
  claim: (date) => claimReportDay(date),
  release: (date) => releaseReportDay(date),
  markSent: (date) => markReportSent(date),
  send: (message) => sendEmail(message),
});

export type UsageReportOutcome = "off" | "not_due" | "already_sent" | "sent" | "failed";

/**
 * One check: off outside production or with no STATS_REPORT_TO; nothing before
 * 6:00 AM Pacific; otherwise yesterday's report, once. The day is claimed before
 * the send, and released if the send fails, so the next check retries. Never throws.
 */
export async function checkUsageReport(deps: UsageReportDeps = defaultDeps()): Promise<UsageReportOutcome> {
  if (deps.env.RAILWAY_ENVIRONMENT_NAME !== "production") return "off";
  if (!deps.env.STATS_REPORT_TO?.trim()) return "off";
  const to = reportRecipient(deps.env);
  if (!to) {
    console.error("[Spotter] Usage report not sent (bad_recipient): STATS_REPORT_TO is not one email address");
    return "off";
  }
  const date = reportDue(deps.now());
  if (!date) return "not_due";

  let data: UsageReportData;
  try {
    if (await deps.claimed(date)) return "already_sent";
    // Read before claiming: a database that cannot answer leaves the day unclaimed for the next check.
    data = await deps.load(date);
    if (!(await deps.claim(date))) return "already_sent";
  } catch (error) {
    console.error(`[Spotter] Usage report for ${date} not built (${errorCode(error)}).`);
    return "failed";
  }

  let result: SendResult;
  try {
    result = await deps.send(usageReportMessage(to, data));
  } catch {
    result = { sent: false, code: "send_failed" };
  }
  if (!result.sent) {
    console.error(`[Spotter] Usage report for ${date} not sent (${result.code}); will retry.`);
    try {
      await deps.release(date);
    } catch (error) {
      console.error(`[Spotter] Usage report for ${date}: claim not released (${errorCode(error)}).`);
    }
    return "failed";
  }

  try {
    await deps.markSent(date);
  } catch (error) {
    // The email went; the claim stays, so it is not sent again.
    console.error(`[Spotter] Usage report for ${date} sent, not marked (${errorCode(error)}).`);
  }
  return "sent";
}
