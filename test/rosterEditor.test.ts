import { describe, expect, it } from "vitest";
import { sanitizeProps } from "@/lib/analytics/events";
import {
  applySport,
  editField,
  EMPTY_TEAM,
  freshRow,
  mergeTeam,
  replaceWithImport,
  saveBlocker,
  savedRosterProps,
  savedRow,
  setPronunciations,
  setSpotMode,
  toSaveArgs,
  type EditorRow,
  type TeamDraft,
} from "@/lib/rosters/editor";
import { reviewRoster } from "@/lib/rosters/reviewPlayers";
import type { RosterPlayer } from "@/lib/rosters/types";

const player = (over: Partial<RosterPlayer>): RosterPlayer => ({
  jersey: "22",
  first_name: "Sam",
  last_name: "Langan",
  position: "RB",
  grade: "11",
  height: "5-10",
  weight: "180",
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...over,
});

const TEAM: TeamDraft = { ...EMPTY_TEAM, school: "Estancia", mascot: "Eagles", sport: "football", level: "varsity", season: "26-27" };

describe("the offensive-line default", () => {
  it("starts an imported offensive lineman off and everyone else normal", () => {
    const rows = [player({ position: "OL" }), player({ position: "DL" }), player({ position: "OL/DE" })].map((p) =>
      freshRow(p, "football"),
    );
    expect(rows.map((row) => row.player.spot_mode)).toEqual(["off", "normal", "normal"]);
  });

  it("still saves the lineman who starts off", () => {
    const rows = [freshRow(player({ last_name: "Tackle", position: "OT" }), "football")];
    const args = toSaveArgs(TEAM, rows, null);
    expect(args.p_players).toHaveLength(1);
    expect(args.p_players[0].spot_mode).toBe("off");
  });

  it("only applies to football", () => {
    expect(freshRow(player({ position: "C" }), "baseball").player.spot_mode).toBe("normal");
  });

  it("follows a position typed by hand, until a mode is chosen", () => {
    let row = freshRow(player({ position: null }), "football");
    row = editField(row, "position", "OG", "football");
    expect(row.player.spot_mode).toBe("off");
    row = setSpotMode(row, "normal");
    row = editField(row, "position", "OT", "football");
    expect(row.player.spot_mode).toBe("normal");
  });

  it("catches up when the sport is picked after the import", () => {
    const rows = [freshRow(player({ position: "OL" }), null)];
    expect(rows[0].player.spot_mode).toBe("normal");
    expect(applySport(rows, "football")[0].player.spot_mode).toBe("off");
  });

  it("never overrides a saved player's setting when the sport changes", () => {
    const rows = [savedRow(player({ position: "OL", spot_mode: "normal" }), null)];
    expect(applySport(rows, "football")[0].player.spot_mode).toBe("normal");
  });
});

describe("re-importing a saved team", () => {
  const season = { season_stats: { rush_att: 64 }, season_lines: [], stats_as_of: "2026-09-25" };

  it("keeps pronunciations and spotting settings for the same surname and jersey, and drops stats", () => {
    const before: EditorRow[] = [
      savedRow(player({ jersey: "17", last_name: "Ossuetta", pronunciations: ["oh-soo-EH-tuh"], spot_mode: "exact_only" }), season),
      savedRow(player({ jersey: "44", last_name: "Aragon", spot_mode: "off" }), season),
    ];
    const after = replaceWithImport(
      before,
      [player({ jersey: "17", last_name: "OSSUETTA" }), player({ jersey: "4", last_name: "Aragon" }), player({ jersey: "9", last_name: "New" })],
      "football",
    );
    expect(after[0].player.pronunciations).toEqual(["oh-soo-EH-tuh"]);
    expect(after[0].player.spot_mode).toBe("exact_only");
    // Same surname, different jersey: not the same player as far as a re-import
    // can tell, so he starts as an import does. Aragon starts exact-only,
    // because "oregon" would put the card up (Oct 4).
    expect(after[1].player.spot_mode).toBe("exact_only");
    expect(after[1].spotModeChosen).toBe(false);
    expect(after[2].player.pronunciations).toEqual([]);
    expect(after.every((row) => row.season === null)).toBe(true);
    expect(toSaveArgs(TEAM, after, "r1").p_players.every((p) => p.season_stats === null)).toBe(true);
  });

  it("keeps season stats through an ordinary save", () => {
    const rows = [savedRow(player({}), season)];
    expect(toSaveArgs(TEAM, rows, "r1").p_players[0]).toMatchObject({ season_stats: { rush_att: 64 }, stats_as_of: "2026-09-25" });
  });
});

describe("toSaveArgs", () => {
  it("saves a typed suffix off the surname: \"Langan III\" is Langan", () => {
    const [saved] = toSaveArgs(TEAM, [freshRow(player({ last_name: "Langan III" }), "football")], null).p_players;
    expect(saved).toMatchObject({ first_name: "Sam", last_name: "Langan", spoken_forms: ["langan"] });
  });

  it("sends the roster id when editing, so a renamed team is updated in place", () => {
    expect(toSaveArgs(TEAM, [], "abc").p_roster.id).toBe("abc");
    expect("id" in toSaveArgs(TEAM, [], null).p_roster).toBe(false);
  });

  it("builds spoken forms from the surname and the pronunciations", () => {
    const row = setPronunciations(freshRow(player({ last_name: "Nguyen" }), "football"), ["win"]);
    expect(toSaveArgs(TEAM, [row], null).p_players[0].spoken_forms).toEqual(["nguyen", "win"]);
  });

  it("skips a row with no surname and turns blanks into nulls", () => {
    const rows = [freshRow(player({ last_name: "  " }), "football"), freshRow(player({ jersey: " ", grade: "" }), "football")];
    const { p_players, p_roster } = toSaveArgs({ ...TEAM, mascot: " ", gender: "" }, rows, null);
    expect(p_players).toHaveLength(1);
    expect(p_players[0].jersey).toBeNull();
    expect(p_players[0].grade).toBeNull();
    expect(p_roster.mascot).toBeNull();
    expect(p_roster.gender).toBeNull();
  });
});

describe("saveBlocker", () => {
  it("says what is missing", () => {
    expect(saveBlocker({ ...TEAM, school: "" }, [freshRow(player({}), "football")])).toBe("Add the school name.");
    expect(saveBlocker({ ...TEAM, sport: "" }, [freshRow(player({}), "football")])).toBe("Pick a sport.");
    expect(saveBlocker(TEAM, [])).toBe("Add at least one player.");
    expect(saveBlocker(TEAM, [freshRow(player({}), "football")])).toBeNull();
  });
});

describe("mergeTeam", () => {
  it("fills only the blanks from what the import found", () => {
    const merged = mergeTeam({ ...EMPTY_TEAM, school: "Estancia" }, { school: "Estancia High", sport: "football", season: " 26-27 " });
    expect(merged).toMatchObject({ school: "Estancia", sport: "football", season: "26-27" });
  });
});

describe("prep.roster_saved props", () => {
  const rows = [
    freshRow(player({ jersey: "8", last_name: "Bargas", position: "RB" }), "football"),
    freshRow(player({ jersey: "21", last_name: "Vargas", position: "WR" }), "football"),
    freshRow(player({ jersey: "0", last_name: "Wright", position: "OT" }), "football"),
    freshRow(player({ jersey: "5", last_name: "Longhi", position: "DB" }), "football"),
  ];
  rows[3] = setSpotMode(setPronunciations(rows[3], ["LONG-ee"]), "exact_only");
  const reviews = reviewRoster(
    rows.map((row) => row.player),
    "football",
  );

  it("counts what the announcer did", () => {
    const props = savedRosterProps(rows, reviews, 1_000_000, 1_000_000 + 7.5 * 60_000);
    expect(props).toMatchObject({
      players: 4,
      rows_edited: 1,
      exact_only_set: 1,
      spotting_off_set: 1,
      pronunciations_added: 1,
      heard_as_added: 0,
      minutes_from_first_import: 7.5,
    });
    expect(props.warn_look_alike).toBe(2);
    // Bargas #8, Wright #0 and Longhi #5.
    expect(props.warn_single_digit).toBe(3);
    expect(props.warn_common_phrase).toBeGreaterThanOrEqual(1);
  });

  it("never carries a name, jersey, position or pronunciation", () => {
    const props = sanitizeProps("prep.roster_saved", savedRosterProps(rows, reviews, null, 0));
    const text = JSON.stringify(props).toLowerCase();
    for (const secret of ["bargas", "vargas", "wright", "longhi", "long-ee", "sam", "rb", "wr", "ot", "db"]) {
      expect(text).not.toContain(`"${secret}"`);
      expect(Object.keys(props).join(" ")).not.toContain(secret === "ot" ? "_ot_" : secret);
    }
    expect(Object.values(props).every((value) => typeof value === "number")).toBe(true);
  });

  it("leaves minutes out when nothing was imported", () => {
    expect("minutes_from_first_import" in savedRosterProps(rows, reviews, null, 0)).toBe(false);
  });
});
