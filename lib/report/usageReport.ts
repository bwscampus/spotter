// The daily usage email's text (Nov 19). Pure: the rows go in, the subject, the
// plain text and an escaped HTML copy come out. The rows are read by
// lib/server/usageReport.ts.
//
// PRIVACY: this text holds account names and emails, so it goes only to
// STATS_REPORT_TO and is never logged. It holds no player names, rosters,
// transcripts or file contents: games are schools, times and counts.

import { ROLE_LABELS, isAnnouncerRole } from "@/lib/onboarding/about";
import { SPORT_LABELS, SPORTS, type Sport } from "@/lib/rosters/types";
import { dateLabel, pacificTime } from "./pacificDay";

export type ReportAccount = {
  name: string | null;
  email: string;
  isAdmin: boolean;
  google: boolean;
  password: boolean;
  emailConfirmed: boolean;
  onboarded: boolean;
  sports: string[];
  otherSports: string[];
  roles: string[];
};

export type ReportGame = {
  email: string;
  isAdmin: boolean;
  sport: string | null;
  homeSchool: string | null;
  awaySchool: string | null;
  startedAt: Date;
  endedAt: Date | null;
  micSeconds: number;
  cardsShown: number;
  boothGuest: boolean;
  rating: number | null;
};

export type ReportActive = { email: string; isAdmin: boolean };

export type UsageReportData = {
  date: string;
  newAccounts: ReportAccount[];
  games: ReportGame[];
  active: ReportActive[];
};

/** Text an account typed (a name, a school, a sport) on one short line: no control characters, no line breaks. */
export function oneLine(value: string | null | undefined, max = 80): string {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const who = (email: string, isAdmin: boolean) => `${oneLine(email, 320)}${isAdmin ? " (admin)" : ""}`;

const isSport = (value: string): value is Sport => (SPORTS as readonly string[]).includes(value);
const sportName = (code: string | null) => (code && isSport(code) ? SPORT_LABELS[code] : code ? oneLine(code, 40) : "No sport");

function signIn(account: ReportAccount): string {
  const ways = [account.google ? "Google" : null, account.password ? "Email/password" : null].filter(Boolean).join(" + ");
  return account.password && !account.google && !account.emailConfirmed ? `${ways} (not confirmed)` : ways || "no sign-in";
}

function about(account: ReportAccount): string {
  const sports = [
    ...account.sports.filter((s) => s !== "other").map(sportName),
    ...account.otherSports.map((s) => oneLine(s, 40)).filter(Boolean),
  ];
  if (!account.onboarded) return "Onboarding: not yet.";
  const roles = account.roles.map((r) => (isAnnouncerRole(r) ? ROLE_LABELS[r] : oneLine(r, 40)));
  if (sports.length === 0 && roles.length === 0) return "Onboarding: skipped.";
  return `Onboarding: done. Sports: ${sports.join(", ") || "none"}. Roles: ${roles.join(", ") || "none"}.`;
}

function gameLine(game: ReportGame, date: string): string[] {
  const away = oneLine(game.awaySchool) || "?";
  const home = oneLine(game.homeSchool) || "?";
  const booth = game.boothGuest ? " (booth partner)" : "";
  const start = pacificTime(game.startedAt, date);
  const when = game.endedAt ? `${start} to ${pacificTime(game.endedAt, date)}` : `${start}, not ended`;
  const minutes = Math.round(game.micSeconds / 60);
  const rating = game.rating === null ? "no rating" : `rated ${game.rating}/5`;
  return [
    `- ${who(game.email, game.isAdmin)}${booth}: ${sportName(game.sport)}, ${away} (away) at ${home} (home)`,
    `  ${when}, ${minutes} mic min, ${game.cardsShown} cards, ${rating}`,
  ];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const admins = (rows: { isAdmin: boolean }[]) => {
  const n = rows.filter((r) => r.isAdmin).length;
  return n ? ` (${n} admin)` : "";
};

/** The email for one day: subject and plain text. */
export function formatUsageReport(data: UsageReportData): { subject: string; text: string } {
  const { date, newAccounts, games, active } = data;
  const totals = [
    `${plural(newAccounts.length, "new account")}${admins(newAccounts)}`,
    `${plural(games.length, "game")} started${admins(games)}`,
    `${plural(active.length, "active account")}${admins(active)}`,
  ].join(", ");

  const lines = [`StatCast, ${dateLabel(date)} (Pacific)`, "", totals];

  lines.push("", `NEW ACCOUNTS (${newAccounts.length})`);
  if (newAccounts.length === 0) lines.push("None.");
  for (const account of newAccounts) {
    const name = oneLine(account.name) || "(no name)";
    lines.push(`- ${name}, ${who(account.email, account.isAdmin)}`, `  ${signIn(account)}. ${about(account)}`);
  }

  lines.push("", `GAMES STARTED (${games.length})`);
  if (games.length === 0) lines.push("None.");
  for (const game of games) lines.push(...gameLine(game, date));

  lines.push("", `ACTIVE ACCOUNTS (${active.length})`);
  if (active.length === 0) lines.push("None.");
  for (const account of active) lines.push(`- ${who(account.email, account.isAdmin)}`);

  const [, mon, day] = dateLabel(date).split(/,? /);
  const subject = `StatCast usage ${mon} ${day}: ${newAccounts.length} new, ${plural(games.length, "game")}, ${active.length} active`;
  return { subject, text: lines.join("\n") };
}

/** HTML for the same text, every character an account typed escaped. */
export function reportHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<pre style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; white-space: pre-wrap;">${escaped}</pre>`;
}
