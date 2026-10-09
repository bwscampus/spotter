import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "./fakeServer";

// V3 stood a Supabase client in for the team reads. Here they are
// lib/server/repo/rosters.ts over the fake database from test/fakeServer.ts,
// for the signed-in user pageUser() hands the page.
const OWNER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
vi.mock("@/lib/server/pageUser", () => ({
  pageUser: async () => ({ id: OWNER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() }),
}));
let db = fakeDatabase();
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { editField, EMPTY_TEAM, freshRow, REIMPORT_STATS_NOTE, setPronunciations, setSplit, toSaveArgs } from "@/lib/rosters/editor";
import { MAX_IMAGE_BYTES, MAX_TEXT_CHARS, MAX_UPLOAD_BYTES, extractFailure } from "@/lib/rosters/extractErrors";
import { IMAGE_HEADROOM_BYTES, imageShare, pastedTextProblem, prepareImages } from "@/lib/rosters/importFiles";
import { loadRoster, loadRosterState, loadTeamList, RosterLoadError } from "@/lib/rosters/loadRosters";
import { noPlayersMessage, MAX_NO_PLAYERS_REASON } from "@/lib/rosters/noPlayers";
import { droppedLetters, reviewRoster } from "@/lib/rosters/reviewPlayers";
import { JERSEY_ZEROS_NOTE, jerseyZerosNote, rowsToText } from "@/lib/rosters/tableText";
import type { RosterPlayer } from "@/lib/rosters/types";
import { matchStats, type StatBlock, type StatsPlayer } from "@/lib/stats/matchStats";
import { playersSent, statsShortfall, toSetSeasonStatsArgs } from "@/lib/stats/review";

// =============================================================================
// The pre-launch audit's import and roster-safety findings (H11, M10 to M13,
// L9, L10, and F9's accent fold). Made-up teams and names throughout.
// =============================================================================

const rosterPlayer = (jersey: string | null, first_name: string | null, last_name: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey,
  first_name,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

const TEAM = { ...EMPTY_TEAM, school: "Harborview", sport: "football" as const };

describe("H11: one big photo fits what the server takes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never gives one image more than MAX_IMAGE_BYTES, and splits the upload between several", () => {
    expect(imageShare(1)).toBe(MAX_IMAGE_BYTES - IMAGE_HEADROOM_BYTES);
    expect(imageShare(1)).toBeLessThan(MAX_IMAGE_BYTES);
    expect(imageShare(2)).toBe(Math.floor(MAX_UPLOAD_BYTES / 2) - IMAGE_HEADROOM_BYTES);
    expect(imageShare(5) * 5).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it("shrinks a single 3.5 MB JPEG to under the server's 3 MB limit", async () => {
    // A canvas stand-in: each JPEG quality step makes a smaller file, the way a real encoder does.
    // Before the fix, the 3.4 MB first try fitted a 4 MB share and was sent, and the server refused it.
    const mb = (n: number) => Math.round(n * 1024 * 1024);
    const sizes: Record<string, number> = { "0.85": mb(3.4), "0.7": mb(2.6), "0.55": mb(1.9) };
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4032, height: 3024, close: () => undefined }));
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => undefined, drawImage: () => undefined }),
        toBlob: (done: (blob: Blob) => void, type: string, quality: number) => {
          done(new Blob([new Uint8Array(sizes[String(quality)])], { type }));
        },
      }),
    });

    const photo = new File([new Uint8Array(3.5 * 1024 * 1024)], "roster.jpg", { type: "image/jpeg" });
    const [sent] = await prepareImages([photo]);
    expect(sent.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(sent.size).toBe(sizes["0.7"]);
    expect(sent.type).toBe("image/jpeg");
  });

  it("sends a photo that already fits as it is", async () => {
    const photo = new File([new Uint8Array(2 * 1024 * 1024)], "roster.jpg", { type: "image/jpeg" });
    const [sent] = await prepareImages([photo]);
    expect(sent).toBe(photo);
  });
});

describe("M10: a photo's unreadable flag stays until the row is edited", () => {
  it("keeps Claude's flag while other rows change, and drops it when this row is edited", () => {
    const smudged = freshRow(rosterPlayer("12", "Ora", "Vellacourt", { flags: ["unreadable"] }), "football");
    const other = freshRow(rosterPlayer("4", "Ike", "Dunmore", { flags: ["unreadable"] }), "football");
    expect(reviewRoster([smudged.player, other.player], "football")[0].flags).toContain("unreadable");

    const edited = editField(smudged, "last_name", "Vellacort", "football");
    expect(edited.player.flags).not.toContain("unreadable");
    // A pronunciation is not a check of the printed name.
    expect(setPronunciations(other, ["vel-uh-KORT"]).player.flags).toContain("unreadable");
    expect(setSplit(other, "Ike", "Dunmore").player.flags).not.toContain("unreadable");
    expect(reviewRoster([edited.player, other.player], "football")[1].flags).toContain("unreadable");
  });
});

describe("M11: a surname Spotter cannot hear", () => {
  const flagsFor = (last: string, extra: Partial<RosterPlayer> = {}) =>
    reviewRoster([rosterPlayer("9", "Kai", last, extra)], "football")[0];

  it("flags a name with no a to z letters, and says to add a pronunciation", () => {
    for (const name of ["王", "Иванов", "김"]) {
      const review = flagsFor(name);
      expect(review.forms).toEqual([]);
      expect(review.flags).toContain("no_spoken_forms");
      expect(review.reasons[review.flags.indexOf("no_spoken_forms")]).toBe("StatCast can't listen for this spelling. Add a pronunciation.");
    }
  });

  it("flags letters the matcher drops, naming them", () => {
    const review = flagsFor("Ødegård");
    expect(droppedLetters("Ødegård")).toEqual(["ø"]);
    expect(review.flags).toContain("letters_dropped");
    expect(review.reasons[review.flags.indexOf("letters_dropped")]).toBe(
      'StatCast can\'t hear "ø" in this spelling and listens for "degard". Add a pronunciation.',
    );
    expect(flagsFor("Strøm").flags).toContain("letters_dropped");
  });

  it("is cleared by a pronunciation", () => {
    expect(flagsFor("王", { pronunciations: ["wong"] }).flags).not.toContain("no_spoken_forms");
    expect(flagsFor("Ødegård", { pronunciations: ["OH-deh-gord"] }).flags).not.toContain("letters_dropped");
  });

  it("leaves accented Latin names, punctuation and suffixes alone", () => {
    for (const name of ["García", "Núñez", "Müller", "Beyoncé-Lopez", "O'Brien", "Smith Jr."]) {
      const review = flagsFor(name);
      expect(review.flags).not.toContain("no_spoken_forms");
      expect(review.flags).not.toContain("letters_dropped");
    }
    expect(flagsFor("García").forms[0]).toBe("garcia");
  });
});

describe("M12: a failed read is never an empty team", () => {
  /** The database's three reads answer as given: rows, or an Error to throw. */
  function client(rosters: unknown[] | Error, players: unknown[] | Error, list: unknown[] | Error = []) {
    const answer = (result: unknown[] | Error) => {
      if (result instanceof Error) throw result;
      return result;
    };
    db = fakeDatabase((text) => {
      if (text.includes("from rosters r")) return answer(list);
      if (text.includes("from rosters where id")) return answer(rosters);
      return answer(players);
    });
  }

  const ROSTER_ROW = { id: "r1", school: "Harborview", mascot: null, sport: "football", gender: null, level: null, season: null, primary_color: null };
  const network = () => new Error("network");

  it("says the players' read failed rather than handing the editor nobody", async () => {
    client([ROSTER_ROW], network());
    expect(await loadRosterState("r1")).toEqual({ status: "error" });
    await expect(loadRoster("r1")).rejects.toBeInstanceOf(RosterLoadError);
  });

  it("says the team's read failed, and tells a missing team apart", async () => {
    client(network(), []);
    expect(await loadRosterState("r1")).toEqual({ status: "error" });
    client([], []);
    expect(await loadRosterState("r1")).toEqual({ status: "missing" });
    expect(await loadRoster("r1")).toBeNull();
  });

  it("loads a team whose reads both worked", async () => {
    client([ROSTER_ROW], []);
    const load = await loadRosterState("r1");
    expect(load.status).toBe("ok");
  });

  // V3 left this to row level security; here every read names the owner.
  it("reads only the signed-in account's team and players", async () => {
    client([ROSTER_ROW], []);
    await loadRosterState("r1");
    expect(db.statements).toHaveLength(2);
    for (const statement of db.statements) {
      expect(statement.text).toContain("owner_id = $2");
      expect(statement.params).toEqual(["r1", OWNER]);
    }
  });

  it("says the team list failed rather than showing no teams", async () => {
    client([], [], network());
    expect(await loadTeamList()).toEqual({ status: "error" });
    client([], [], []);
    expect(await loadTeamList()).toEqual({ status: "ok", teams: [] });
    expect(db.statements[0].text).toContain("where r.owner_id = $1");
    expect(db.statements[0].params).toEqual([OWNER]);
  });

  it("shows the error and no editor on the team page and the teams page", () => {
    const team = readFileSync("app/teams/[id]/page.tsx", "utf8");
    expect(team).toContain("loadRosterState");
    expect(team).toContain("TEAM_LOAD_ERROR");
    const teams = readFileSync("app/teams/page.tsx", "utf8");
    expect(teams).toContain("loadTeamList");
    expect(teams).toContain("TEAMS_LOAD_ERROR");
  });
});

describe("M12: one save, one transaction", () => {
  it("sends the team colour and every player's heard-as forms to save_roster", () => {
    const rows = [freshRow(rosterPlayer("7", "Noah", "Vexley", { heard_as: ["vecksley"] }), "football")];
    const args = toSaveArgs({ ...TEAM, color: "#0B2A5B" }, rows, null);
    expect(args.p_roster.primary_color).toBe("#0b2a5b");
    expect(args.p_players[0].heard_as).toEqual(["vecksley"]);
    expect(toSaveArgs(TEAM, rows, null).p_roster.primary_color).toBeNull();
  });

  // V3's migration was security invoker with grants to authenticated; here the
  // function takes the owner first and there are no grants to keep (the app's
  // role runs every function), so those two checks are dropped.
  it("has a migration that writes both, with the caps, scoped to the owner it is given", () => {
    const sql = readFileSync("db/migrations/0012_save_roster_whole.sql", "utf8");
    expect(sql).toContain("create or replace function public.save_roster(p_owner uuid, p_roster jsonb, p_players jsonb)");
    expect(sql).toMatch(/language plpgsql\s+set search_path = ''/);
    expect(sql).not.toContain("auth.uid()");
    expect(sql).toContain("p_roster ? 'primary_color'");
    expect(sql).toContain("entry ? 'heard_as'");
    expect(sql).toContain("c_max_players constant int := 300");
    expect(sql).toContain("c_max_name_chars constant int := 80");
    expect(sql).toContain("c_max_rosters constant int := 60");
    // The same shape the column's check constraint takes.
    expect(sql).toContain("'^#[0-9a-f]{6}$'");
    expect(readFileSync("db/migrations/0006_stats_keys_color_heard_as.sql", "utf8")).toContain("primary_color ~ '^#[0-9a-f]{6}$'");
  });

  it("is sent whole by PUT /api/rosters to save_roster, under the session's account", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
    vi.doMock("@/lib/server/session", () => ({
      readSession: async () => ({ id: OWNER, email: "a@example.com", name: null, approved: true, emailVerified: true, isAdmin: false, signedInAt: new Date() }),
    }));
    try {
      db = fakeDatabase(() => [{ id: "6c1f6f9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e" }]);
      const { PUT } = await import("@/app/api/rosters/route");
      const rows = [freshRow(rosterPlayer("7", "Noah", "Vexley", { heard_as: ["vecksley"] }), "football")];
      const args = toSaveArgs({ ...TEAM, color: "#0B2A5B" }, rows, null);
      const response = await PUT(
        new Request("https://spotter.example/api/rosters", {
          method: "PUT",
          headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
          body: JSON.stringify(args),
        }),
      );
      expect(response.status).toBe(200);
      expect(db.statements).toHaveLength(1);
      const [statement] = db.statements;
      expect(statement.text).toContain("public.save_roster($1, $2::jsonb, $3::jsonb)");
      expect(statement.params[0]).toBe(OWNER);
      expect(JSON.parse(statement.params[1] as string).primary_color).toBe("#0b2a5b");
      expect(JSON.parse(statement.params[2] as string)[0].heard_as).toEqual(["vecksley"]);
    } finally {
      vi.doUnmock("next/headers");
      vi.doUnmock("@/lib/server/session");
    }
  });

  it("no longer writes the colour or the heard-as forms in calls of their own", () => {
    const editor = readFileSync("components/rosters/RosterEditor.tsx", "utf8");
    // V3 checked for a Supabase update on rosters; here that would be a PATCH.
    expect(editor).not.toMatch(/api\(\s*"PATCH"/);
    expect(editor).not.toContain("/api/players/");
    expect(editor).not.toContain("writeHeardAs");
    expect(editor.match(/api(<[^>]*>)?\(\s*"PUT"/g)).toHaveLength(1);
    expect(editor).toContain("toSaveArgs(team, rows, rosterId, reviews)");
  });
});

describe("M13: both re-import prompts say the stats go", () => {
  it("is in the import's confirm and the save-over-a-saved-team confirm", () => {
    const editor = readFileSync("components/rosters/RosterEditor.tsx", "utf8");
    expect(REIMPORT_STATS_NOTE).toBe("Season stats will need importing again.");
    expect(editor.match(/\$\{REIMPORT_STATS_NOTE\}/g)).toHaveLength(2);
  });
});

describe("L9: Excel jerseys that lost a leading zero", () => {
  it("warns when the jersey column holds a single-digit number", () => {
    const rows = [["Varsity Roster"], ["No.", "Name", "Pos"], [0, "Tamsin Hale", "QB"], [12, "Rory Penn", "WR"]];
    expect(jerseyZerosNote(rows)).toBe(JERSEY_ZEROS_NOTE);
    expect(jerseyZerosNote([["Jersey #", "Name"], [7, "Ada Brill"]])).toBe(JERSEY_ZEROS_NOTE);
  });

  it("says nothing when jerseys are text, or none are single digits", () => {
    expect(jerseyZerosNote([["#", "Name"], ["00", "Tamsin Hale"], ["07", "Rory Penn"]])).toBeNull();
    expect(jerseyZerosNote([["#", "Name"], [12, "Tamsin Hale"], [44, "Rory Penn"]])).toBeNull();
    expect(jerseyZerosNote([["Name", "Grade"], ["Tamsin Hale", 9]])).toBeNull();
  });

  it("keeps a text jersey's zeros in the rows Claude reads", () => {
    expect(rowsToText([["#", "Name"], ["00", "Tamsin Hale"]])).toBe("# | Name\n00 | Tamsin Hale");
  });
});

describe("L10: long pastes and Claude's own reason", () => {
  it("refuses a paste over the limit in words instead of cutting it", () => {
    expect(pastedTextProblem("", "roster")).toBe("Paste the roster first.");
    expect(pastedTextProblem("x".repeat(MAX_TEXT_CHARS), "roster")).toBeNull();
    expect(pastedTextProblem("x".repeat(MAX_TEXT_CHARS + 1), "roster")).toBe(
      "That paste is 50,001 characters, and StatCast reads up to 50,000. Paste just the roster table.",
    );
  });

  it("no longer cuts the paste box at MAX_TEXT_CHARS", () => {
    expect(readFileSync("components/rosters/ImportPanel.tsx", "utf8")).not.toContain("maxLength");
  });

  it("shows Claude's reason when it found nobody", () => {
    expect(noPlayersMessage([])).toBe(extractFailure("no_players").message);
    expect(noPlayersMessage(["This looks like a game schedule, not a roster."])).toBe(
      "StatCast found no players in this. The reader said: This looks like a game schedule, not a roster.",
    );
    expect(noPlayersMessage(["x".repeat(1000)]).length).toBeLessThan(MAX_NO_PLAYERS_REASON + 60);
  });
});

describe("F9: stats sheets and the saved roster", () => {
  const player = (id: string, jersey: string | null, last_name: string): StatsPlayer => ({ id, jersey, last_name });
  const block = (jersey: string | null, last_name: string): StatBlock => ({ jersey, last_name, lines: ["1 line"] });

  it("matches a sheet's Garcia to the roster's García, by surname and without a name warning", () => {
    const roster = [player("g", "21", "García"), player("n", "3", "Núñez")];
    const { matched, unmatched } = matchStats(roster, [block(null, "Garcia"), block("3", "Nunez")]);
    expect(unmatched).toEqual([]);
    expect(matched.map((match) => match.player.id)).toEqual(["g", "n"]);
    expect(matched[1].mismatchedName).toBeUndefined();
  });

  it("warns when set_season_stats wrote fewer players than it was sent", () => {
    const args = toSetSeasonStatsArgs("r1", "lines", [
      { player: player("a", "1", "Hale"), stats: {}, lines: ["10 kills"] },
      { player: player("b", "2", "Penn"), stats: {}, lines: ["4 aces"] },
    ], "2026-10-01");
    expect(playersSent(args)).toBe(2);
    expect(statsShortfall(2, 2)).toBeNull();
    expect(statsShortfall(2, 1)).toBe(
      "Saved stats for 1 of 2 players. One is no longer on this team's saved roster, probably because the roster was saved again. Import the stats again to place them.",
    );
    expect(statsShortfall(2, null)).toBeNull();
  });
});
