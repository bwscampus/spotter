import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerTable } from "@/components/rosters/PlayerTable";
import { COMMON_PHRASES } from "@/lib/rosters/commonPhrases";
import { editField, freshRow, savedRow, setSpotMode } from "@/lib/rosters/editor";
import { defaultSpotMode, firesOn, reviewRoster } from "@/lib/rosters/reviewPlayers";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { RosterPlayer } from "@/lib/rosters/types";

// Common-word names start exact-only at import (Oct 4: "for the" put up
// Worthy 44 times), and the review says why. Made-up names where a name is
// needed; "Ward" is the roster review's own example of a surname that fires
// on an everyday word.

const player = (extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey: "48",
  first_name: "Sam",
  last_name: "Ward",
  position: "WR",
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

describe("the seed list", () => {
  it.each(["for the", "early", "create", "finally", "change", "hard", "price", "risk", "not on", "back here", "here is", "however", "very well", "all her"])(
    "has %s",
    (phrase) => expect(COMMON_PHRASES).toContain(phrase),
  );
});

describe("exact-only by default", () => {
  it("a surname that fires on an everyday word starts exact-only; one that does not starts normal; a lineman still starts off", () => {
    expect(firesOn(spokenForms("Ward"))).toBeTruthy();
    expect(firesOn(spokenForms("Quillon"))).toBeNull();
    expect(defaultSpotMode("WR", "football", spokenForms("Ward"))).toBe("exact_only");
    expect(defaultSpotMode("WR", "football", spokenForms("Quillon"))).toBe("normal");
    expect(defaultSpotMode("OL", "football", spokenForms("Ward"))).toBe("off");
    expect(defaultSpotMode("WR", "football")).toBe("normal");
    expect(freshRow(player(), "football").player.spot_mode).toBe("exact_only");
    expect(freshRow(player({ last_name: "Quillon" }), "football").player.spot_mode).toBe("normal");
  });

  it("follows a surname typed into a row nobody has set, and leaves a chosen setting alone", () => {
    const typed = editField(freshRow(player({ last_name: "Quillon" }), "football"), "last_name", "Ward", "football");
    expect(typed.player.spot_mode).toBe("exact_only");
    const back = editField(typed, "last_name", "Quillon", "football");
    expect(back.player.spot_mode).toBe("normal");
    const chosen = editField(setSpotMode(freshRow(player({ last_name: "Quillon" }), "football"), "normal"), "last_name", "Ward", "football");
    expect(chosen.player.spot_mode).toBe("normal");
    expect(savedRow(player({ spot_mode: "normal" }), null).player.spot_mode).toBe("normal");
  });

  it("the review says why, and only while the setting is the automatic one", () => {
    const rows = [freshRow(player(), "football")];
    const reviews = reviewRoster(rows.map((row) => row.player), "football");
    expect(reviews[0].exactOnlyBecause).toBeTruthy();
    const html = renderToStaticMarkup(createElement(PlayerTable, { rows, reviews, sport: "football", onChange: () => undefined }));
    expect(html).toContain("Exact only by default, because");
    const chosen = [setSpotMode(rows[0], "exact_only")];
    const again = renderToStaticMarkup(createElement(PlayerTable, { rows: chosen, reviews, sport: "football", onChange: () => undefined }));
    expect(again).not.toContain("Exact only by default");
  });
});
