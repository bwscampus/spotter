import { describe, expect, it } from "vitest";
import { aboutSavedProps } from "@/components/onboarding/AboutYou";
import { sanitizeProps } from "@/lib/analytics/events";
import {
  afterAbout,
  ANNOUNCER_ROLES,
  cleanOtherSport,
  cleanRoles,
  cleanSports,
  listedSportNamed,
  MAX_OTHER_SPORTS,
  MAX_SUGGESTIONS,
  normalizeAbout,
  suggestSports,
  WALKTHROUGH_PATH,
} from "@/lib/onboarding/about";
import { SPORT_LABELS, type Sport } from "@/lib/rosters/types";
import { isAboutBody } from "@/lib/server/validate";

// "About you" (Nov 3): what the route accepts, where Continue goes, and what
// analytics may carry.

describe("About you", () => {
  it("accepts the two answers as known codes, each once, or a skip, and nothing else", () => {
    expect(isAboutBody({ sports: ["football"], roles: ["public_address", "radio_pbp"] })).toBe(true);
    expect(isAboutBody({ sports: [], roles: [] })).toBe(true);
    expect(isAboutBody({ skip: true })).toBe(true);
    expect(isAboutBody({ sports: ["curling"], roles: [] })).toBe(false);
    expect(isAboutBody({ sports: ["football", "football"], roles: [] })).toBe(false);
    expect(isAboutBody({ sports: [], roles: ["announcer"] })).toBe(false);
    expect(isAboutBody({ sports: [], roles: [], owner_id: "someone-else" })).toBe(false);
    expect(isAboutBody({ skip: true, sports: [] })).toBe(false);
    expect(isAboutBody({ skip: "yes" })).toBe(false);
    expect(isAboutBody(null)).toBe(false);
  });

  it("keeps known values in the lists' own order", () => {
    expect(cleanSports(["basketball", "nope", "football"])).toEqual(["football", "basketball"]);
    expect(cleanRoles(["radio_color", "public_address"])).toEqual(["public_address", "radio_color"]);
  });

  it("walks an account with fewer than two teams through its next game, and sends the rest Home", () => {
    expect(afterAbout(0)).toBe(WALKTHROUGH_PATH);
    expect(afterAbout(1)).toBe(WALKTHROUGH_PATH);
    expect(afterAbout(2)).toBe("/home");
  });

  it("sends counts and one yes/no per kind of announcing, all of which survive the privacy filter, and never a typed sport", () => {
    const props = aboutSavedProps(["football", "basketball", "other"], ["public_address"], ["Wrestling", "Curling"]);
    expect(props).toEqual({ sports: 3, other_sports: 2, roles: 1, public_address: true, tv_pbp: false, tv_color: false, radio_pbp: false, radio_color: false });
    expect(sanitizeProps("onboarding.about_saved", props)).toEqual(props);
    expect(Object.keys(props)).toEqual(["sports", "other_sports", "roles", ...ANNOUNCER_ROLES]);
    expect(JSON.stringify(props)).not.toMatch(/Wrestling|Curling/);
  });
});

// "Other" sports, typed (Nov 4, Jed: "Make other autofill suggestion based on
// what they are typing").
describe("Other sports as they type", () => {
  const labels = (list: ReturnType<typeof suggestSports>) => list.map((suggestion) => suggestion.label);
  const none = { sports: [] as Sport[], others: [] as string[] };

  it("suggests nothing until something is typed", () => {
    expect(suggestSports("", none, SPORT_LABELS)).toEqual([]);
    expect(suggestSports("   ", none, SPORT_LABELS)).toEqual([]);
  });

  it("puts a name that starts with what was typed first, then a word that does, then one that contains it", () => {
    expect(labels(suggestSports("wre", none, SPORT_LABELS))).toEqual(["Wrestling"]);
    expect(labels(suggestSports("hock", none, SPORT_LABELS))).toEqual(["Ice hockey", "Field hockey"]);
    expect(labels(suggestSports("vol", none, SPORT_LABELS))).toEqual(["Volleyball", "Beach volleyball"]);
    expect(labels(suggestSports("TRACK", none, SPORT_LABELS))).toEqual(["Track and field"]);
  });

  it("offers a listed sport as ticking its own box, and never one already picked", () => {
    const [first] = suggestSports("socc", none, SPORT_LABELS);
    expect(first).toEqual({ kind: "listed", sport: "soccer", label: "Soccer" });
    expect(suggestSports("socc", { sports: ["soccer"], others: [] }, SPORT_LABELS)).toEqual([]);
    expect(labels(suggestSports("wre", { sports: [], others: ["wrestling"] }, SPORT_LABELS))).toEqual([]);
  });

  it("shows at most six, the listed sports before the rest", () => {
    const many = labels(suggestSports("ball", none, SPORT_LABELS));
    expect(many).toHaveLength(MAX_SUGGESTIONS);
    expect(many.slice(0, 5)).toEqual(["Volleyball", "Football", "Basketball", "Baseball", "Softball"]);
  });

  it("keeps what was typed when it reads as a sport's name, in a known sport's own spelling", () => {
    expect(cleanOtherSport("  wrestling ")).toBe("Wrestling");
    expect(cleanOtherSport("Quidditch  league")).toBe("Quidditch league");
    expect(cleanOtherSport("")).toBeNull();
    expect(cleanOtherSport("<script>")).toBeNull();
    expect(cleanOtherSport("x".repeat(41))).toBeNull();
    expect(listedSportNamed("water polo", SPORT_LABELS)).toBe("water_polo");
    expect(listedSportNamed("Other", SPORT_LABELS)).toBeNull();
  });

  it("saves a listed sport typed under Other as its box, and keeps other only when something else was typed", () => {
    expect(normalizeAbout(["football"], ["Volleyball", "wrestling", "Wrestling"], ["radio_pbp"], SPORT_LABELS)).toEqual({
      sports: ["volleyball", "football", "other"],
      otherSports: ["Wrestling"],
      roles: ["radio_pbp"],
    });
    expect(normalizeAbout(["football", "other"], [], [], SPORT_LABELS)).toEqual({ sports: ["football"], otherSports: [], roles: [] });
    const eleven = Array.from({ length: 11 }, (_, at) => `Sport ${at}`);
    expect(normalizeAbout([], eleven, [], SPORT_LABELS).otherSports).toHaveLength(MAX_OTHER_SPORTS);
  });

  it("lets PATCH /api/me carry them, each a short name, at most ten", () => {
    expect(isAboutBody({ sports: ["other"], roles: [], other_sports: ["Wrestling", "Curling"] })).toBe(true);
    expect(isAboutBody({ sports: [], roles: [], other_sports: ["<b>"] })).toBe(false);
    expect(isAboutBody({ sports: [], roles: [], other_sports: Array.from({ length: 11 }, (_, at) => `Sport ${at}`) })).toBe(false);
    expect(isAboutBody({ sports: [], roles: [], other_sports: "Wrestling" })).toBe(false);
  });
});
