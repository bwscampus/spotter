import { describe, expect, it } from "vitest";
import {
  canStart,
  comingFriday,
  datePassed,
  draftStatus,
  draftTitle,
  gameDay,
  isTonight,
  nextDraft,
  statusText,
  toDraft,
  type Draft,
} from "@/lib/game/drafts";
import { isDraftBody } from "@/lib/server/validate";

// Draft games (Nov 3): where a draft stands, in plain words, from what the page
// already has. Made-up schools.

const AWAY = "0f8b7c3a-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const HOME = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: "d1",
  gameDate: "2026-11-06",
  sport: "football",
  awayId: AWAY,
  homeId: HOME,
  awaySchool: "Millbrook",
  homeSchool: "Harborview",
  wearing: { away: null, home: null },
  share: true,
  ...overrides,
});
const teams = (awayAsOf: string | null = null, homeAsOf: string | null = null) => [
  { id: AWAY, statsAsOf: awayAsOf },
  { id: HOME, statsAsOf: homeAsOf },
];

describe("a draft's status line", () => {
  it("is Ready with both teams and stats under a week old", () => {
    expect(statusText(draftStatus(draft(), teams("2026-11-01", null), "2026-11-03"))).toBe("Ready");
  });

  it("needs the away team first, then the home team, and only that stops Start", () => {
    const noAway = draftStatus(draft({ awayId: null, awaySchool: null }), teams(), "2026-11-03");
    expect(statusText(noAway)).toBe("Needs the away team");
    expect(canStart(noAway)).toBe(false);
    const noHome = draftStatus(draft({ homeId: null, homeSchool: null }), teams(), "2026-11-03");
    expect(statusText(noHome)).toBe("Needs the home team");
    expect(canStart(noHome)).toBe(false);
  });

  it("needs a team that was deleted since the draft was saved", () => {
    expect(statusText(draftStatus(draft(), [{ id: HOME, statsAsOf: null }], "2026-11-03"))).toBe("Needs the away team");
  });

  it("says the older team's stats age in weeks, as a heads-up that still allows Start", () => {
    const stale = draftStatus(draft(), teams("2026-10-12", "2026-10-27"), "2026-11-03");
    expect(statusText(stale)).toBe("Stats 3 weeks old");
    expect(canStart(stale)).toBe(true);
    expect(statusText(draftStatus(draft(), teams(null, "2026-10-27"), "2026-11-03"))).toBe("Stats 1 week old");
  });
});

describe("a draft's dates", () => {
  it("defaults to the coming Friday, today on a Friday", () => {
    expect(comingFriday("2026-11-03")).toBe("2026-11-06");
    expect(comingFriday("2026-11-06")).toBe("2026-11-06");
    expect(comingFriday("2026-11-07")).toBe("2026-11-13");
    expect(comingFriday("2026-12-31")).toBe("2027-01-01");
  });

  it("reads Fri Nov 6, and knows tonight and a passed date", () => {
    expect(gameDay("2026-11-06")).toBe("Fri Nov 6");
    expect(isTonight(draft(), "2026-11-06")).toBe(true);
    expect(datePassed(draft(), "2026-11-07")).toBe(true);
    expect(datePassed(draft(), "2026-11-06")).toBe(false);
  });

  it("picks the soonest draft dated today or later for Home", () => {
    const drafts = [draft({ id: "past", gameDate: "2026-10-30" }), draft({ id: "later", gameDate: "2026-11-13" }), draft({ id: "soon", gameDate: "2026-11-06" })];
    expect(nextDraft(drafts, "2026-11-03")?.id).toBe("soon");
    expect(nextDraft([draft({ gameDate: "2026-10-30" })], "2026-11-03")).toBeNull();
  });

  it("names a missing side with a question mark", () => {
    expect(draftTitle(draft())).toBe("Millbrook at Harborview");
    expect(draftTitle(draft({ awaySchool: null }))).toBe("? at Harborview");
  });

  it("reads a row whose team was deleted as no team", () => {
    const row = toDraft({
      id: "d1",
      game_date: "2026-11-06",
      sport: "football",
      home_roster_id: null,
      away_roster_id: AWAY,
      home_school: "Ghost High",
      away_school: "Millbrook",
      wearing_home: null,
      wearing_away: "white",
      share_log: false,
    });
    expect(row).toMatchObject({ homeId: null, homeSchool: null, awaySchool: "Millbrook", wearing: { away: "white", home: null }, share: false });
  });
});

describe("what a draft route accepts", () => {
  it("needs a real date to create one, and only a draft's own fields", () => {
    expect(isDraftBody({ game_date: "2026-11-06", sport: "football" }, "create")).toBe(true);
    expect(isDraftBody({ sport: "football" }, "create")).toBe(false);
    expect(isDraftBody({ game_date: "2026-02-30" }, "create")).toBe(false);
    expect(isDraftBody({ game_date: "2026-11-06", owner_id: HOME }, "create")).toBe(false);
    expect(isDraftBody({ game_date: "2026-11-06", status: "live" }, "create")).toBe(false);
  });

  it("takes roster ids as uuids or null, never the same team twice", () => {
    expect(isDraftBody({ away_roster_id: AWAY, home_roster_id: null }, "update")).toBe(true);
    expect(isDraftBody({ away_roster_id: "1; drop table rosters" }, "update")).toBe(false);
    expect(isDraftBody({ away_roster_id: AWAY, home_roster_id: AWAY }, "update")).toBe(false);
    expect(isDraftBody({ wearing_home: "x".repeat(41) }, "update")).toBe(false);
    expect(isDraftBody({ sport: "curling" }, "update")).toBe(false);
    expect(isDraftBody({ share_log: "yes" }, "update")).toBe(false);
  });
});
