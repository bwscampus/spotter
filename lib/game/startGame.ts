import { setGameId, track } from "@/lib/analytics/track";
import { buildSnapshot, loadGame, type LoadedGame, type Wearing } from "@/lib/game/buildGame";
import { beginDraftGame, beginGame, endGame } from "@/lib/game/calledGames";
import type { Draft } from "@/lib/game/drafts";
import { getGameSnapshot, writeGameSnapshot } from "@/lib/game/snapshot";
import { setShareChoice } from "@/lib/log/shareLog";
import { isSport } from "@/lib/rosters/types";

// =============================================================================
// Start (Nov 3: one place for it, so game setup, a draft's row on the Games
// page and Home's next game all start a game the same way). What setup's
// Start always did: end the game still open in this browser, record the row,
// build the snapshot, save it in this browser, and say game.started. A draft
// keeps its own id: its row becomes the live game.
//
// No live stats on this branch: every caller passes statsEnabled false
// (test/noLiveStatsOnMain.test.ts holds setup to it).
// =============================================================================

export const SNAPSHOT_FAILED = "Could not save the game in this browser. Check that site storage is allowed, then try again.";

export type StartResult = { ok: true; gameId: string } | { ok: false; error: string };

export interface StartChoices {
  loaded: LoadedGame;
  wearing: Wearing;
  share: boolean;
  keytermBoost: boolean;
  statsEnabled: boolean;
  /** The draft being started, whose id becomes the game's. */
  draftId?: string | null;
  /** Where the announcer pressed Start, for game.draft_started. */
  from?: "setup" | "games" | "home";
  /** The draft's date had passed ("Start anyway"). */
  datePassed?: boolean;
}

export async function startGame(choices: StartChoices): Promise<StartResult> {
  const { loaded, wearing, share, keytermBoost, statsEnabled, draftId = null } = choices;

  // One game at a time. Starting another ends the one still open, with the
  // counts it reached, so its row is not left without an end.
  const current = getGameSnapshot();
  if (current) await endGame(current, undefined, { shareInBackground: true });

  // Made here rather than by the database, so the browser log has a game to
  // belong to even if the row cannot be written. A draft brings its own.
  const gameId = draftId ?? crypto.randomUUID();
  setShareChoice(gameId, share);
  const recorded = draftId ? await beginDraftGame(loaded, gameId, statsEnabled) : await beginGame(loaded, gameId, statsEnabled);
  const snapshot = buildSnapshot(loaded, { wearing, keytermBoost, gameId, recorded, statsEnabled });

  if (!writeGameSnapshot(snapshot)) return { ok: false, error: SNAPSHOT_FAILED };

  setGameId(gameId);
  track("game.started", {
    sport: isSport(snapshot.sport) ? snapshot.sport : null,
    stats: snapshot.statsEnabled,
    stats_auto: snapshot.statsEnabled && snapshot.statsAuto === true,
    setup_warnings: loaded.teamSounds.length,
    keyterms: snapshot.keyterms.length,
  });
  if (draftId) track("game.draft_started", { from: choices.from ?? "setup", date_passed: choices.datePassed === true });
  return { ok: true, gameId };
}

/**
 * Starts a draft straight from a list (the Games page, Home): reads both
 * rosters as they are now and runs the same name check setup runs, then
 * starts it. A draft missing a team cannot start.
 */
export async function startDraftGame(draft: Draft, from: "games" | "home", today: string): Promise<StartResult> {
  if (!draft.awayId || !draft.homeId) return { ok: false, error: "Pick both teams first." };
  const result = await loadGame(draft.homeId, draft.awayId);
  if (!result.ok) return result;
  // No live stats on this branch (Nov 1 on main, Nov 3 on testrun2).
  const statsEnabled = false;
  return startGame({
    loaded: result.loaded,
    wearing: { away: draft.wearing.away, home: draft.wearing.home },
    share: draft.share,
    keytermBoost: result.loaded.keyterm.kind !== "too_many",
    statsEnabled,
    draftId: draft.id,
    from,
    datePassed: draft.gameDate < today,
  });
}
