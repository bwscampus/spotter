// =============================================================================
// Adding a team from game setup (docs/V3_DEFINITION.md 7.1): New game, then
// the new team's roster, then its season stats, then back to New game with the
// team picked on the side it was added for. The same way back serves "Update
// stats" on a stale-stats warning.
//
// The way back rides in the URL, so each step is the ordinary teams page it
// always was, and a reload in the middle loses nothing. A draft game (Nov 3)
// rides along too, so setup reopens that draft with the new team on it. Pure, so the round trip
// can be tested without a browser.
// =============================================================================

export type SetupSide = "away" | "home";

/** The teams setup has picked, and the draft game it is editing, if any. */
export interface SetupPicks {
  away: string | null;
  home: string | null;
  /** The draft game (called_games, status draft) setup was opened on: /games/new?draft=… */
  draft?: string | null;
}

/** Where game setup was when the announcer left it: the side being filled, both picks so far, and the draft. */
export interface SetupReturn extends SetupPicks {
  side: SetupSide;
}

/** A page's search params, as Next hands them over. */
export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The way back to setup, or null when the page was not reached from setup. */
export function readSetupReturn(params: SearchParams): SetupReturn | null {
  if (first(params.for) !== "game") return null;
  const side = first(params.side);
  if (side !== "away" && side !== "home") return null;
  return { side, ...readSetupPicks(params) };
}

/** The teams setup opens with already picked, and its draft: /games/new?away=…&home=…&draft=… */
export function readSetupPicks(params: SearchParams): { away: string | null; home: string | null; draft: string | null } {
  return { away: teamId(params.away), home: teamId(params.home), draft: teamId(params.draft) };
}

/** Setup's own address with the picks it had, and the new team on its side when there is one. */
export function setupHref(back: SetupReturn, newTeamId?: string): string {
  const picks = { away: back.away, home: back.home };
  if (newTeamId) picks[back.side] = newTeamId;
  return withQuery("/games/new", { ...picks, draft: back.draft ?? null });
}

/** Setup's Names page for these two picks (docs/UI_STYLE.md, A7). Back to setup keeps both. */
export function namesHref(picks: SetupPicks): string {
  return withQuery("/games/new/names", { away: picks.away, home: picks.home, draft: picks.draft ?? null });
}

/** The sound check for these two picks. Back to setup keeps both. */
export function soundCheckHref(picks: SetupPicks): string {
  return withQuery("/games/sound-check", { away: picks.away, home: picks.home, draft: picks.draft ?? null });
}

/** A step of adding a team (the roster, then the stats), carrying the way back. */
export function stepHref(path: string, back: SetupReturn): string {
  return withQuery(path, { for: "game", side: back.side, away: back.away, home: back.home, draft: back.draft ?? null });
}

function withQuery(path: string, values: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function teamId(value: string | string[] | undefined): string | null {
  const id = first(value);
  return id && UUID.test(id) ? id : null;
}
