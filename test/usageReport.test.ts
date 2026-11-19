import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, isReportDate, pacificClock, pacificDayWindow, reportDue } from "@/lib/report/pacificDay";
import { formatUsageReport, oneLine, reportHtml, type UsageReportData } from "@/lib/report/usageReport";
import { checkUsageReport, reportRecipient, type UsageReportDeps } from "@/lib/server/usageReport";

// The daily usage email (Nov 19): the Pacific day it covers, when it is due, the
// text, and the once-a-day claim around the send. Made-up accounts and schools.

const HOUR = 60 * 60 * 1000;

describe("the Pacific day", () => {
  it("is midnight to midnight Pacific: 8:00 UTC in winter, 7:00 UTC in summer", () => {
    const winter = pacificDayWindow("2026-11-18");
    expect(winter.start.toISOString()).toBe("2026-11-18T08:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-11-19T08:00:00.000Z");
    const summer = pacificDayWindow("2026-07-04");
    expect(summer.start.toISOString()).toBe("2026-07-04T07:00:00.000Z");
    expect(summer.end.getTime() - summer.start.getTime()).toBe(24 * HOUR);
  });

  it("is 23 hours on the spring-forward Sunday (Mar 8, 2026)", () => {
    const { start, end } = pacificDayWindow("2026-03-08");
    expect(start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  it("is 25 hours on the fall-back Sunday (Nov 1, 2026)", () => {
    const { start, end } = pacificDayWindow("2026-11-01");
    expect(start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("days meet with no gap or overlap across a whole year", () => {
    let date = "2026-01-01";
    for (let i = 0; i < 366; i += 1) {
      const next = addDays(date, 1);
      expect(pacificDayWindow(date).end.getTime()).toBe(pacificDayWindow(next).start.getTime());
      expect(pacificClock(pacificDayWindow(date).start)).toEqual({ date, hour: 0, minute: 0 });
      date = next;
    }
  });

  it("reads dates strictly", () => {
    expect(isReportDate("2026-02-28")).toBe(true);
    expect(isReportDate("2026-02-29")).toBe(false);
    expect(isReportDate("2026-2-28")).toBe(false);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("when the report is due", () => {
  it("is nothing before 6:00 AM Pacific, and yesterday from then on", () => {
    expect(reportDue(new Date("2026-11-19T13:59:00Z"))).toBeNull(); // 5:59 AM PST
    expect(reportDue(new Date("2026-11-19T14:00:00Z"))).toBe("2026-11-18"); // 6:00 AM PST
    expect(reportDue(new Date("2026-11-20T07:59:00Z"))).toBe("2026-11-18"); // 11:59 PM PST
    expect(reportDue(new Date("2026-11-20T08:00:00Z"))).toBeNull(); // midnight
  });

  it("follows the clock on both change days", () => {
    // Mar 8 at 6 AM is 13:00 UTC (PDT); the day before is Mar 7.
    expect(reportDue(new Date("2026-03-08T12:59:00Z"))).toBeNull();
    expect(reportDue(new Date("2026-03-08T13:00:00Z"))).toBe("2026-03-07");
    // Mar 9 reports on the 23-hour Mar 8.
    expect(reportDue(new Date("2026-03-09T13:00:00Z"))).toBe("2026-03-08");
    // Nov 1 at 6 AM is 14:00 UTC (PST again).
    expect(reportDue(new Date("2026-11-01T13:59:00Z"))).toBeNull();
    expect(reportDue(new Date("2026-11-01T14:00:00Z"))).toBe("2026-10-31");
    expect(reportDue(new Date("2026-11-02T14:00:00Z"))).toBe("2026-11-01");
  });
});

const day: UsageReportData = {
  date: "2026-11-18",
  newAccounts: [
    {
      name: "Pat Quillon",
      email: "pat@example.com",
      isAdmin: false,
      google: true,
      password: false,
      emailConfirmed: true,
      onboarded: true,
      sports: ["football", "other"],
      otherSports: ["Wrestling"],
      roles: ["public_address", "radio_pbp"],
    },
    {
      name: null,
      email: "sam@example.com",
      isAdmin: false,
      google: false,
      password: true,
      emailConfirmed: false,
      onboarded: false,
      sports: [],
      otherSports: [],
      roles: [],
    },
    {
      name: "Owner\nTwo",
      email: "owner@example.com",
      isAdmin: true,
      google: true,
      password: true,
      emailConfirmed: true,
      onboarded: true,
      sports: [],
      otherSports: [],
      roles: [],
    },
  ],
  games: [
    {
      email: "pat@example.com",
      isAdmin: false,
      sport: "football",
      homeSchool: "Harborview",
      awaySchool: "Cedar <Ridge>",
      startedAt: new Date("2026-11-19T02:58:00Z"),
      endedAt: new Date("2026-11-19T08:10:00Z"),
      micSeconds: 8530,
      cardsShown: 87,
      boothGuest: false,
      rating: 4,
    },
    {
      email: "owner@example.com",
      isAdmin: true,
      sport: "basketball",
      homeSchool: "Mesa",
      awaySchool: "Pine",
      startedAt: new Date("2026-11-18T20:05:00Z"),
      endedAt: null,
      micSeconds: 0,
      cardsShown: 0,
      boothGuest: true,
      rating: null,
    },
  ],
  active: [
    { email: "owner@example.com", isAdmin: true },
    { email: "pat@example.com", isAdmin: false },
  ],
};

describe("the report's text", () => {
  const { subject, text } = formatUsageReport(day);

  it("leads with the totals, admins counted out", () => {
    expect(subject).toBe("StatCast usage Nov 18: 3 new, 2 games, 2 active");
    expect(text.split("\n").slice(0, 3)).toEqual([
      "StatCast, Wed, Nov 18, 2026 (Pacific)",
      "",
      "3 new accounts (1 admin), 2 games started (1 admin), 2 active accounts (1 admin)",
    ]);
  });

  it("lists new accounts with sign-in, onboarding, sports and roles", () => {
    expect(text).toContain("- Pat Quillon, pat@example.com\n  Google. Onboarding: done. Sports: Football, Wrestling. Roles: Public address, Radio play-by-play.");
    expect(text).toContain("- (no name), sam@example.com\n  Email/password (not confirmed). Onboarding: not yet.");
    expect(text).toContain("- Owner Two, owner@example.com (admin)\n  Google + Email/password. Onboarding: skipped.");
  });

  it("lists games in Pacific time with their counts and rating", () => {
    expect(text).toContain(
      "- pat@example.com: Football, Cedar <Ridge> (away) at Harborview (home)\n  6:58 PM to Nov 19 12:10 AM, 142 mic min, 87 cards, rated 4/5",
    );
    expect(text).toContain("- owner@example.com (admin) (booth partner): Basketball, Pine (away) at Mesa (home)\n  12:05 PM, not ended, 0 mic min, 0 cards, no rating");
  });

  it("lists active accounts and says None for an empty section", () => {
    expect(text).toContain("ACTIVE ACCOUNTS (2)\n- owner@example.com (admin)\n- pat@example.com");
    const one = formatUsageReport({ ...day, games: day.games.slice(0, 1) });
    expect(one.subject).toBe("StatCast usage Nov 18: 3 new, 1 game, 2 active");
    const empty = formatUsageReport({ date: "2026-11-18", newAccounts: [], games: [], active: [] }).text;
    expect(empty).toContain("0 new accounts, 0 games started, 0 active accounts");
    expect(empty.match(/None\./g)).toHaveLength(3);
  });

  it("escapes everything an account typed in the HTML copy, and keeps typed text on one line", () => {
    const html = reportHtml(text);
    expect(html).toContain("Cedar &lt;Ridge&gt;");
    expect(html).not.toContain("<Ridge>");
    expect(oneLine("a b\r\n\tc")).toBe("a b c");
    expect(oneLine("x".repeat(100), 10)).toHaveLength(10);
  });
});

describe("STATS_REPORT_TO", () => {
  it("takes one address and nothing else", () => {
    expect(reportRecipient({ STATS_REPORT_TO: " me@example.com " })).toBe("me@example.com");
    expect(reportRecipient({})).toBeNull();
    expect(reportRecipient({ STATS_REPORT_TO: "a@example.com, b@example.com" })).toBeNull();
    expect(reportRecipient({ STATS_REPORT_TO: "not an address" })).toBeNull();
  });
});

describe("the once-a-day check", () => {
  const ADDRESS = "owner-inbox@example.com";
  afterEach(() => vi.restoreAllMocks());

  function fakes(overrides: Partial<UsageReportDeps> = {}) {
    const claims = new Set<string>();
    const sent: string[] = [];
    const deps: UsageReportDeps = {
      now: () => new Date("2026-11-19T15:00:00Z"), // 7:00 AM PST
      env: { RAILWAY_ENVIRONMENT_NAME: "production", STATS_REPORT_TO: ADDRESS },
      claimed: async (date) => claims.has(date),
      load: async (date) => ({ ...day, date }),
      claim: async (date) => (claims.has(date) ? false : (claims.add(date), true)),
      release: async (date) => void claims.delete(date),
      markSent: async () => {},
      send: async (message) => (sent.push(message.to), { sent: true }),
      ...overrides,
    };
    return { deps, claims, sent };
  }

  it("does nothing outside production, without STATS_REPORT_TO, or before 6 AM", async () => {
    const { deps, sent } = fakes();
    expect(await checkUsageReport({ ...deps, env: { STATS_REPORT_TO: ADDRESS } })).toBe("off");
    expect(await checkUsageReport({ ...deps, env: { RAILWAY_ENVIRONMENT_NAME: "testrun2", STATS_REPORT_TO: ADDRESS } })).toBe("off");
    expect(await checkUsageReport({ ...deps, env: { RAILWAY_ENVIRONMENT_NAME: "production" } })).toBe("off");
    expect(await checkUsageReport({ ...deps, now: () => new Date("2026-11-19T13:45:00Z") })).toBe("not_due");
    expect(sent).toEqual([]);
  });

  it("sends yesterday's report once, however many checks run", async () => {
    const { deps, sent, claims } = fakes();
    const load = vi.fn(deps.load);
    const outcomes = await Promise.all([1, 2, 3].map(() => checkUsageReport({ ...deps, load })));
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_sent")).toHaveLength(2);
    expect(await checkUsageReport(deps)).toBe("already_sent");
    expect(sent).toEqual([ADDRESS]);
    expect([...claims]).toEqual(["2026-11-18"]);
    expect(load).toHaveBeenCalledWith("2026-11-18");
  });

  it("releases the claim when the send fails, so the next check retries; logs no address or body", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const { deps, sent, claims } = fakes({
      send: async (message) => (fail ? { sent: false, code: "send_failed" } : (sent.push(message.to), { sent: true })),
    });
    expect(await checkUsageReport(deps)).toBe("failed");
    expect(claims.size).toBe(0);
    fail = false;
    expect(await checkUsageReport(deps)).toBe("sent");
    expect(sent).toEqual([ADDRESS]);
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("2026-11-18");
    expect(logged).not.toMatch(/@|Quillon|Harborview/);
  });

  it("a send that throws is a failed send; a database that cannot answer claims nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = fakes({ send: async () => Promise.reject(new Error(`no route to ${ADDRESS}`)) });
    expect(await checkUsageReport(throwing.deps)).toBe("failed");
    expect(throwing.claims.size).toBe(0);
    const down = fakes({ load: async () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" })) });
    expect(await checkUsageReport(down.deps)).toBe("failed");
    expect(down.claims.size).toBe(0);
    expect(errors.mock.calls.flat().join("\n")).not.toContain("@");
  });

  it("a bad STATS_REPORT_TO is refused without being logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, sent } = fakes();
    expect(await checkUsageReport({ ...deps, env: { RAILWAY_ENVIRONMENT_NAME: "production", STATS_REPORT_TO: "a@x.com;b@y.com" } })).toBe("off");
    expect(sent).toEqual([]);
    expect(errors.mock.calls.flat().join("\n")).not.toContain("x.com");
  });

  it("a sent report whose mark fails is still not sent again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, sent } = fakes({ markSent: async () => Promise.reject(new Error("x")) });
    expect(await checkUsageReport(deps)).toBe("sent");
    expect(await checkUsageReport(deps)).toBe("already_sent");
    expect(sent).toHaveLength(1);
  });
});

describe("the cross-account read stays server-side", () => {
  const ROOT = path.resolve(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it("no route, page or component imports lib/server/usageReport", () => {
    const importers = ["app", "components"]
      .flatMap((dir) => files(path.join(ROOT, dir)))
      .filter((file) => /server\/usageReport/.test(readFileSync(file, "utf8")));
    expect(importers).toEqual([]);
  });
});
