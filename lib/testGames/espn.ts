import type { KeyedSource } from "@/lib/cards/playerKey";
import { withoutSuffix } from "@/lib/rosters/suffix";

// =============================================================================
// A college or NFL game's teams and rosters out of ESPN's public JSON, for
// `npm run make:game` (scripts/make-test-game.ts).
//
// Three places name players, and all three are read, merged by ESPN's athlete
// id (else side, jersey and surname):
//   - each team's roster (`teams/<id>/roster`), the only one with every
//     player and their position, which the stats checks lean on (the
//     quarterback on the field, the only kicker, the only punter);
//   - the summary's `rosters`, when ESPN includes it (it does for some games);
//   - the summary's box score, so everyone who did something that night is on
//     the roster even if they have since left the team's page.
// Home and away come from the header's competitors, the way truthFromEspn
// (lib/livestats/truth.ts) reads them, so the roster and the box score agree.
//
// Pure: the script fetches, this reads.
// =============================================================================

export type EspnLeague = "college-football" | "nfl";

export interface TestTeam {
  /** The school or city, "Georgia", "Pittsburgh": the team name a snapshot carries. */
  school: string;
  /** "Bulldogs", "Steelers", for the team cues. */
  mascot: string | null;
  players: KeyedSource[];
}

export interface EspnGame {
  league: EspnLeague;
  gameId: string;
  /** Kickoff, ms, when ESPN says it. */
  date: number | null;
  home: TestTeam & { teamId: string };
  away: TestTeam & { teamId: string };
}

/** Why ESPN's answer cannot be used, in words for the terminal. */
export class EspnError extends Error {}

/**
 * The game an ESPN link points at: a game page's URL (league and id) or just
 * the number (league unknown). Null when it is neither.
 */
export function parseEspnLink(text: string): { gameId: string; league: EspnLeague | null } | null {
  const trimmed = text.trim().replace(/^['"]|['"]$/g, "");
  if (/^\d{6,}$/.test(trimmed)) return { gameId: trimmed, league: null };
  const id = /gameId[/=](\d{6,})/i.exec(trimmed) ?? /\/game\/(?:_\/)?(\d{6,})/i.exec(trimmed);
  if (!id) return null;
  const league = /\/college-football\//i.test(trimmed) ? "college-football" : /\/nfl\//i.test(trimmed) ? "nfl" : null;
  return { gameId: id[1], league };
}

export function espnGameSummaryUrl(league: EspnLeague, gameId: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${encodeURIComponent(gameId)}`;
}

export function espnTeamRosterUrl(league: EspnLeague, teamId: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${league}/teams/${encodeURIComponent(teamId)}/roster`;
}

/** The two team ids in a summary, to fetch their rosters with. */
export function espnTeamIds(summary: unknown): { home: string; away: string } {
  const sides = competitors(summary);
  return { home: sides.home.id, away: sides.away.id };
}

/**
 * The game, from the summary and whatever team rosters were fetched (keyed by
 * team id; a missing one just means fewer players and no positions for them).
 */
export function gameFromEspn(summary: unknown, league: EspnLeague, gameId: string, teamRosters: ReadonlyMap<string, unknown>): EspnGame {
  const sides = competitors(summary);
  const sideOf = new Map([
    [sides.home.id, "home" as const],
    [sides.away.id, "away" as const],
  ]);
  const found = { home: new Players(), away: new Players() };

  for (const [teamId, roster] of teamRosters) {
    const side = sideOf.get(teamId);
    if (side) for (const athlete of rosterAthletes(roster)) found[side].add(athlete);
  }

  const root = isRecord(summary) ? summary : {};
  if (Array.isArray(root.rosters)) {
    for (const team of root.rosters) {
      if (!isRecord(team)) continue;
      const side = team.homeAway === "home" || team.homeAway === "away" ? team.homeAway : sideOf.get(String(isRecord(team.team) ? team.team.id ?? "" : ""));
      if (!side || !Array.isArray(team.roster)) continue;
      for (const entry of team.roster) {
        if (!isRecord(entry)) continue;
        // An entry is the athlete with the game's jersey and position beside it.
        const athlete = isRecord(entry.athlete) ? { ...entry.athlete } : null;
        if (!athlete) continue;
        athlete.jersey ??= entry.jersey;
        athlete.position ??= entry.position;
        found[side].add(athlete);
      }
    }
  }

  const boxscore = isRecord(root.boxscore) ? root.boxscore : null;
  for (const team of boxscore && Array.isArray(boxscore.players) ? boxscore.players : []) {
    if (!isRecord(team) || !isRecord(team.team)) continue;
    const side = sideOf.get(String(team.team.id ?? ""));
    if (!side || !Array.isArray(team.statistics)) continue;
    for (const section of team.statistics) {
      if (!isRecord(section) || !Array.isArray(section.athletes)) continue;
      for (const row of section.athletes) if (isRecord(row) && isRecord(row.athlete)) found[side].add(row.athlete);
    }
  }

  const header = isRecord(root.header) ? root.header : null;
  const competition = header && Array.isArray(header.competitions) && isRecord(header.competitions[0]) ? header.competitions[0] : null;
  const date = competition && typeof competition.date === "string" ? Date.parse(competition.date) : NaN;

  return {
    league,
    gameId,
    date: Number.isFinite(date) ? date : null,
    home: { teamId: sides.home.id, school: sides.home.school, mascot: sides.home.mascot, players: found.home.list() },
    away: { teamId: sides.away.id, school: sides.away.school, mascot: sides.away.mascot, players: found.away.list() },
  };
}

interface Side {
  id: string;
  school: string;
  mascot: string | null;
}

function competitors(summary: unknown): { home: Side; away: Side } {
  const root = isRecord(summary) ? summary : null;
  const header = root && isRecord(root.header) ? root.header : null;
  const competition = header && Array.isArray(header.competitions) && isRecord(header.competitions[0]) ? header.competitions[0] : null;
  const list = competition && Array.isArray(competition.competitors) ? competition.competitors : [];
  const sides: Partial<Record<"home" | "away", Side>> = {};
  for (const competitor of list) {
    if (!isRecord(competitor) || !isRecord(competitor.team)) continue;
    if (competitor.homeAway !== "home" && competitor.homeAway !== "away") continue;
    const team = competitor.team;
    const school = text(team.location) ?? text(team.displayName) ?? text(team.shortDisplayName) ?? text(team.abbreviation);
    if (!school) continue;
    sides[competitor.homeAway] = { id: String(team.id ?? ""), school, mascot: text(team.name) };
  }
  if (!sides.home || !sides.away) throw new EspnError("ESPN's page for this game does not say which team is home. Check the game link.");
  return { home: sides.home, away: sides.away };
}

/** A team roster's athletes, grouped (offense, defense, special teams) or flat. */
function rosterAthletes(roster: unknown): Record<string, unknown>[] {
  if (!isRecord(roster) || !Array.isArray(roster.athletes)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of roster.athletes) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item.items)) {
      for (const athlete of item.items) if (isRecord(athlete)) out.push(athlete);
    } else out.push(item);
  }
  return out;
}

/** One side's players, merged across the three sources. */
class Players {
  private byKey = new Map<string, KeyedSource>();
  private keyOfId = new Map<string, string>();

  add(athlete: Record<string, unknown>) {
    const display = text(athlete.displayName) ?? text(athlete.fullName) ?? "";
    if (display.toLowerCase() === "team") return;
    const rawLast = text(athlete.lastName) ?? lastWord(display);
    if (!rawLast) return;
    const rawFirst = text(athlete.firstName) ?? (display.split(/\s+/).length > 1 ? display.split(/\s+/).slice(0, -1).join(" ") : null);
    const { first_name, last_name } = withoutSuffix(rawFirst, rawLast);
    const jersey = jerseyOf(athlete.jersey);
    const position = positionOf(athlete.position);
    const id = athlete.id === undefined || athlete.id === null ? null : String(athlete.id);

    const key = (id !== null ? this.keyOfId.get(id) : undefined) ?? `${jersey ?? ""}|${last_name.toLowerCase()}`;
    if (id !== null) this.keyOfId.set(id, key);
    const known = this.byKey.get(key);
    if (known) {
      known.jersey ??= jersey;
      known.position ??= position;
      known.first_name ??= first_name;
      return;
    }
    this.byKey.set(key, { jersey, first_name, last_name, position });
  }

  list(): KeyedSource[] {
    return [...this.byKey.values()];
  }
}

function positionOf(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (isRecord(value)) return text(value.abbreviation) ?? text(value.name);
  return null;
}

function jerseyOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const trimmed = typeof value === "string" ? value.trim().replace(/^#/, "") : "";
  return trimmed.length > 0 ? trimmed : null;
}

function lastWord(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? null;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
