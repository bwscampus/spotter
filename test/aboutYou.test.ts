import { describe, expect, it } from "vitest";
import { aboutSavedProps } from "@/components/onboarding/AboutYou";
import { sanitizeProps } from "@/lib/analytics/events";
import { afterAbout, ANNOUNCER_ROLES, cleanRoles, cleanSports, WALKTHROUGH_PATH } from "@/lib/onboarding/about";
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

  it("sends counts and one yes/no per kind of announcing, all of which survive the privacy filter", () => {
    const props = aboutSavedProps(["football", "basketball"], ["public_address"]);
    expect(props).toEqual({ sports: 2, roles: 1, public_address: true, tv_pbp: false, tv_color: false, radio_pbp: false, radio_color: false });
    expect(sanitizeProps("onboarding.about_saved", props)).toEqual(props);
    expect(Object.keys(props)).toEqual(["sports", "roles", ...ANNOUNCER_ROLES]);
  });
});
