import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { cleanFootballStats } from "@/lib/cards/statKeys";
import type { TeamCue } from "@/lib/matching/numbers";
import type { CardFace } from "@/lib/cards/cardFace";
import type { StatItem } from "@/lib/cards/lines";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";
import { onViewerChange, viewerId, visibleTo } from "./viewer";

// =============================================================================
// Everything a live game needs, written once at setup and read on the live
// screen. Nothing here is fetched during a game: after Start, only Deepgram
// needs the network.
//
// Kept in localStorage, as V2 did, so a reload mid-game comes straight back to
// the same game with no network at all. The browser log (lib/log/) is a
// different thing and lives in IndexedDB.
//
// Stamped with the account that started it (pre-launch audit M3): another
// account signed in on the same browser does not see it, and signing out
// clears it (components/auth/BrowserData.tsx).
// =============================================================================

const STORAGE_KEY = "spotter.v3.game";

export interface GameTeam {
  /** The saved roster this side was built from, so Refresh rosters can read it again. */
  id: string;
  name: string;
  /**
   * What the announcer says this side is wearing tonight, so "white 5" finds a
   * player. Optional: the school name and the mascot are cues on their own. A
   * fact about one night, so it lives here and never on the roster.
   */
  wearing: string | null;
  /**
   * The team's colour, "#rrggbb", or null: half of the live screen's diagonal
   * and the ink of this side's jersey numbers. Optional, so a game saved
   * before colours came back still opens, uncoloured.
   */
  color?: string | null;
}

export interface GameSnapshot {
  version: 1;
  builtAt: string;
  /**
   * The called_games row, and the key this game's browser log is kept under.
   * Made in the browser before the row is written, so the log always has a
   * game to belong to even when the row could not be saved.
   */
  gameId: string;
  /** False when the called_games row could not be written: the game is called the same, it just has no history. */
  recorded: boolean;
  home: GameTeam;
  away: GameTeam;
  watchlist: WatchlistEntry[];
  keyterms: string[];
  /** Which sport, because the vetoes that keep a number off the screen differ by sport. */
  sport: string | null;
  /** The words that name a team just before a number. Built once, at setup. */
  teamCues: TeamCue[];
  /** Live stats for this game: the switch on game setup, football only (docs/V3_DEFINITION.md 8.6). */
  statsEnabled: boolean;
  /**
   * Every play counts the moment it is read (Jed, Oct 8), unless the
   * announcer ticked "Check each play before it counts" at setup. Absent on a
   * game built before Oct 8, which keeps waiting for an OK on every play.
   */
  statsAuto?: boolean;
  /**
   * Both full saved rosters with their keys and season numbers, spotting-off
   * players included, for live stats (rule R9). The watchlist above has
   * dropped those players, so it cannot be used instead. Optional: a game
   * built before it existed still loads, and simply has no stats roster.
   */
  statsRoster?: KeyedPlayer[];
  /**
   * The account that started the game (lib/game/viewer.ts), stamped when it
   * is written. Optional: a game saved before owners were stamped opens for
   * whoever is signed in.
   */
  owner?: string;
}

/** Returns the saved game, or null when there isn't one or it is unreadable. */
export function readGameSnapshot(): GameSnapshot | null {
  try {
    return ownSnapshot(parseSnapshot(localStorage.getItem(STORAGE_KEY)), viewerId());
  } catch {
    // Storage blocked, or a half-written value: fall back to no game.
    return null;
  }
}

/** The id of the game stored in this browser, whoever started it: what signing out clears. */
export function storedGameId(): string | null {
  try {
    return parseSnapshot(localStorage.getItem(STORAGE_KEY))?.gameId ?? null;
  } catch {
    return null;
  }
}

export function parseSnapshot(raw: string | null): GameSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? withReadableStatsRoster(parsed) : null;
  } catch {
    return null;
  }
}

/** The snapshot when this account may see it, else null: another account's open game is not this one's. */
export function ownSnapshot(snapshot: GameSnapshot | null, viewer: string | null | undefined): GameSnapshot | null {
  return snapshot && visibleTo(snapshot.owner, viewer) ? snapshot : null;
}

/** The snapshot as it is written: stamped with the signed-in account when it has no owner yet. */
export function stampOwner(snapshot: GameSnapshot, viewer: string | null | undefined): GameSnapshot {
  if (snapshot.owner !== undefined || typeof viewer !== "string") return snapshot;
  return { ...snapshot, owner: viewer };
}

export function writeGameSnapshot(snapshot: GameSnapshot): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stampOwner(snapshot, viewerId())));
    notify();
    return true;
  } catch (err) {
    console.warn("[Spotter] Could not save the game:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

export function clearGameSnapshot() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    notify();
  } catch {
    // Nothing to do: the live screen falls back to no game.
  }
}

// -----------------------------------------------------------------------------
// The live screen reads the game through useSyncExternalStore, so React knows
// the value comes from outside it and there is no hydration mismatch: the
// server renders "no game", the browser swaps in the real one on first paint.
//
// getSnapshot must return the same object every call until the stored value
// actually changes, or React re-renders forever. So the parse is cached and
// only redone when the raw string differs. A refresh that writes a new string
// is what hands the live screen a new watchlist, and with it a new engine.
// -----------------------------------------------------------------------------

let cachedRaw: string | null = null;
let cachedViewer: string | null | undefined;
let cachedSnapshot: GameSnapshot | null = null;
let hasRead = false;
const listeners = new Set<() => void>();
let viewerSubscribed = false;

export function getGameSnapshot(): GameSnapshot | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  const viewer = viewerId();
  if (!hasRead || raw !== cachedRaw || viewer !== cachedViewer) {
    cachedRaw = raw;
    cachedViewer = viewer;
    cachedSnapshot = ownSnapshot(parseSnapshot(raw), viewer);
    hasRead = true;
  }
  return cachedSnapshot;
}

/** There is no game on the server: localStorage lives in the browser. */
export function getServerGameSnapshot(): GameSnapshot | null {
  return null;
}

export function subscribeGameSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  // A different account signing in reads the game again.
  if (!viewerSubscribed) {
    viewerSubscribed = true;
    onViewerChange(notify);
  }
  // Another tab starting a game should reach this one too.
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", notify);
  };
}

function notify() {
  hasRead = false;
  for (const listener of listeners) listener();
}

/** "Estancia at Brentwood": away first, the way a scoreboard reads. */
export function gameTitle(snapshot: Pick<GameSnapshot, "home" | "away">): string {
  return `${snapshot.away.name} at ${snapshot.home.name}`;
}

/**
 * Checked rather than trusted: this value survives deploys, so an older or
 * hand-edited shape must not reach the matcher.
 */
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Partial<GameSnapshot>;
  return (
    snapshot.version === 1 &&
    typeof snapshot.builtAt === "string" &&
    typeof snapshot.gameId === "string" &&
    snapshot.gameId.length > 0 &&
    typeof snapshot.recorded === "boolean" &&
    isTeam(snapshot.home) &&
    isTeam(snapshot.away) &&
    Array.isArray(snapshot.keyterms) &&
    snapshot.keyterms.every((term) => typeof term === "string") &&
    Array.isArray(snapshot.watchlist) &&
    snapshot.watchlist.length > 0 &&
    snapshot.watchlist.every(isEntry) &&
    (snapshot.sport === null || typeof snapshot.sport === "string") &&
    (snapshot.owner === undefined || (typeof snapshot.owner === "string" && snapshot.owner.length > 0)) &&
    Array.isArray(snapshot.teamCues) &&
    snapshot.teamCues.every(isCue) &&
    typeof snapshot.statsEnabled === "boolean" &&
    (snapshot.statsAuto === undefined || typeof snapshot.statsAuto === "boolean")
  );
}

/**
 * Live stats can never cost a game its names: a stats roster that does not
 * read is dropped, and the game goes on names only, with the strip saying the
 * game has no stats roster. Season numbers are cleaned the way the database
 * cleans them, so nothing but finite numbers on known keys reaches a card.
 */
function withReadableStatsRoster(snapshot: GameSnapshot): GameSnapshot {
  const roster: unknown = snapshot.statsRoster;
  if (roster === undefined) return snapshot;
  if (!Array.isArray(roster) || !roster.every(isKeyedPlayer)) {
    const namesOnly = { ...snapshot };
    delete namesOnly.statsRoster;
    return namesOnly;
  }
  return {
    ...snapshot,
    statsRoster: roster.map((player) =>
      player.season === undefined ? player : { ...player, season: cleanFootballStats(player.season) },
    ),
  };
}

function isKeyedPlayer(value: unknown): value is KeyedPlayer {
  if (typeof value !== "object" || value === null) return false;
  const player = value as Partial<KeyedPlayer>;
  return (
    typeof player.playerId === "string" &&
    (player.side === "home" || player.side === "away") &&
    typeof player.last === "string" &&
    (player.jersey === null || typeof player.jersey === "string") &&
    (player.first === null || typeof player.first === "string") &&
    (player.position === null || typeof player.position === "string") &&
    (player.aliases === undefined || (Array.isArray(player.aliases) && player.aliases.every((form) => typeof form === "string")))
  );
}

function isTeam(value: unknown): value is GameTeam {
  if (typeof value !== "object" || value === null) return false;
  const team = value as Partial<GameTeam>;
  return (
    typeof team.id === "string" &&
    typeof team.name === "string" &&
    (team.wearing === null || typeof team.wearing === "string") &&
    (team.color === undefined || team.color === null || (typeof team.color === "string" && /^#[0-9a-f]{6}$/.test(team.color)))
  );
}

function isCue(value: unknown): value is TeamCue {
  if (typeof value !== "object" || value === null) return false;
  const cue = value as Partial<TeamCue>;
  return (
    Array.isArray(cue.words) &&
    cue.words.every((word) => typeof word === "string") &&
    (cue.side === "H" || cue.side === "A")
  );
}

function isEntry(value: unknown): value is WatchlistEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<WatchlistEntry>;
  return (
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    Array.isArray(entry.aliases) &&
    entry.aliases.every((alias) => typeof alias === "string") &&
    (entry.label === undefined || typeof entry.label === "string") &&
    (entry.keyterm === undefined || typeof entry.keyterm === "string") &&
    (entry.exactOnly === undefined || typeof entry.exactOnly === "boolean") &&
    Array.isArray(entry.players) &&
    entry.players.every(isPlayer)
  );
}

function isPlayer(value: unknown): value is WatchlistPlayer {
  if (typeof value !== "object" || value === null) return false;
  const player = value as Partial<WatchlistPlayer>;
  const optionalText = (field: unknown) => field === null || typeof field === "string";
  return (
    typeof player.last_name === "string" &&
    player.last_name.length > 0 &&
    optionalText(player.jersey) &&
    optionalText(player.first_name) &&
    optionalText(player.position) &&
    optionalText(player.grade) &&
    optionalText(player.height) &&
    optionalText(player.weight) &&
    (player.side === "H" || player.side === "A") &&
    Array.isArray(player.stat_lines) &&
    player.stat_lines.every((line) => typeof line === "string") &&
    (player.pronunciation === undefined || optionalText(player.pronunciation)) &&
    (player.as_of === undefined || optionalText(player.as_of)) &&
    (player.priority === undefined || (typeof player.priority === "number" && Number.isFinite(player.priority))) &&
    (player.hasStats === undefined || typeof player.hasStats === "boolean") &&
    (player.face === undefined || isFace(player.face))
  );
}

const FACE_TEXT = [
  "jersey",
  "position",
  "plain",
  "before",
  "stressed",
  "after",
  "smallFirst",
  "smallLast",
  "seasonText",
] as const satisfies ReadonlyArray<keyof CardFace>;

/** The strings a card copies. Anything else would reach the screen as junk rather than as an error. */
function isFace(value: unknown): value is CardFace {
  if (typeof value !== "object" || value === null) return false;
  const face = value as Partial<CardFace>;
  return (
    FACE_TEXT.every((field) => typeof face[field] === "string") &&
    typeof face.longJersey === "boolean" &&
    Array.isArray(face.season) &&
    face.season.every(isItem) &&
    (face.storyline === undefined || typeof face.storyline === "string")
  );
}

function isItem(value: unknown): value is StatItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<StatItem>;
  return (
    typeof item.value === "string" &&
    typeof item.label === "string" &&
    typeof item.estimated === "boolean" &&
    (item.labelFirst === undefined || typeof item.labelFirst === "boolean") &&
    (item.rank === undefined || typeof item.rank === "number") &&
    (item.group === undefined || typeof item.group === "number")
  );
}
