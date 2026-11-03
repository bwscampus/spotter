import { SPORTS, type Sport } from "@/lib/rosters/types";

// =============================================================================
// "About you" (Nov 3, Jed): asked once, right after the first sign-in, and
// editable in Settings. Two multi-select questions. Pure, shared by the page,
// the route that saves it and the tests; the database checks the same lists
// (db/migrations/0023_about_you.sql).
// =============================================================================

/** The kinds of announcing, in the order the question lists them. */
export const ANNOUNCER_ROLES = ["public_address", "tv_pbp", "tv_color", "radio_pbp", "radio_color"] as const;
export type AnnouncerRole = (typeof ANNOUNCER_ROLES)[number];

export const ROLE_LABELS: Record<AnnouncerRole, string> = {
  public_address: "Public address",
  tv_pbp: "TV / streaming play-by-play",
  tv_color: "TV / streaming color",
  radio_pbp: "Radio play-by-play",
  radio_color: "Radio color",
};

export function isAnnouncerRole(value: unknown): value is AnnouncerRole {
  return typeof value === "string" && (ANNOUNCER_ROLES as readonly string[]).includes(value);
}

/** What an account said about itself. Empty lists when it skipped or has not answered. */
export interface About {
  sports: Sport[];
  roles: AnnouncerRole[];
  /** Answered or skipped "About you". */
  onboarded: boolean;
}

/** A list of known values, each once, in the list's own order, whatever was sent. */
export function cleanList<T extends string>(values: readonly unknown[], known: readonly T[]): T[] {
  return known.filter((value) => values.includes(value));
}

export const cleanSports = (values: readonly unknown[]): Sport[] => cleanList(values, SPORTS);
export const cleanRoles = (values: readonly unknown[]): AnnouncerRole[] => cleanList(values, ANNOUNCER_ROLES);

/**
 * Where "About you" goes next: an account with fewer than two saved teams is
 * walked through setting up its next game; everyone else goes Home.
 */
export const WALKTHROUGH_PATH = "/onboarding/game";
export function afterAbout(teamCount: number): string {
  return teamCount < 2 ? WALKTHROUGH_PATH : "/home";
}
