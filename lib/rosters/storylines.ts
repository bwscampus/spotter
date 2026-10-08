import { MAX_STORYLINE_CHARS } from "@/lib/cards/cardFace";
import type { EditorRow } from "./editor";
import type { ImportFormat, ReadRoute } from "./types";

// =============================================================================
// "Other info" (Jed, Oct 8): any file or text about the team, read by Claude
// for one storyline per player it says something about. Recent-game stats
// count as storylines. Pure, so the browser and the route share it: what the
// page sends about each player, how Claude's answer is cleaned, and how the
// announcer's picks land in the table. Nothing is saved until the team is.
//
// Storylines are roster content: none of this goes to analytics, and the
// route logs counts only.
// =============================================================================

/** The most players one read is sent: a roster's cap (save_roster refuses more). */
export const MAX_STORYLINE_PLAYERS = 300;

/** What the page sends about one player. `id` is the table row's key, which Claude hands back. */
export interface StorylinePlayer {
  id: string;
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  /** The storyline the player already has, so Claude can leave a better one alone. */
  storyline: string;
}

/** One storyline Claude wrote, for the player whose row key is `id`. */
export interface StorylineSuggestion {
  id: string;
  storyline: string;
}

/** What POST /api/storylines/extract answers. No file bytes, no text from the file but the storylines. */
export interface StorylinesResponse {
  suggestions: StorylineSuggestion[];
  /** Things Claude could not place, in its words, for the review only. They can name a player: never analytics. */
  notes: string[];
  format: ImportFormat;
  route: ReadRoute;
  pages: number;
}

/** The table as the read needs it, in table order. Rows with no surname have nobody to write about. */
export function storylinePlayers(rows: readonly EditorRow[]): StorylinePlayer[] {
  return rows
    .filter((row) => row.player.last_name.trim().length > 0)
    .slice(0, MAX_STORYLINE_PLAYERS)
    .map((row) => ({
      id: row.key,
      jersey: row.player.jersey?.trim() || null,
      first_name: row.player.first_name?.trim() || null,
      last_name: row.player.last_name.trim(),
      position: row.player.position?.trim() || null,
      storyline: (row.player.storyline ?? "").trim(),
    }));
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const FIELD_CHARS = 80;

/**
 * The `players` form field, checked on the server: the page is the part a user
 * controls. Null when it is not a list of players this route can use.
 */
export function readStorylinePlayers(raw: unknown): StorylinePlayer[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_STORYLINE_PLAYERS) return null;

  const players: StorylinePlayer[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== "string" || !ID.test(value.id) || seen.has(value.id)) return null;
    const lastName = short(value.last_name);
    if (!lastName) return null;
    seen.add(value.id);
    players.push({
      id: value.id,
      jersey: short(value.jersey),
      first_name: short(value.first_name),
      last_name: lastName,
      position: short(value.position),
      storyline: short(value.storyline) ?? "",
    });
  }
  return players;
}

function short(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 && trimmed.length <= FIELD_CHARS ? trimmed : null;
}

/**
 * A storyline that fits the card: whitespace folded, and one over
 * MAX_STORYLINE_CHARS cut at the last whole word that fits rather than
 * mid-word, with any dangling separator taken off.
 */
export function fitStoryline(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= MAX_STORYLINE_CHARS) return clean;
  const cut = chars.slice(0, MAX_STORYLINE_CHARS + 1).join("");
  const space = cut.lastIndexOf(" ");
  const kept = space > 0 ? cut.slice(0, space) : chars.slice(0, MAX_STORYLINE_CHARS).join("");
  return kept.replace(/[\s;,:.\-–—]+$/u, "");
}

/**
 * Claude's answer, trusted for shape and nothing else: a storyline for a
 * player the page did not send, an empty one, one the player already has, or
 * a second one for the same player is dropped. Throws nothing; a reply that is
 * not the expected shape is no suggestions.
 */
export function normalizeStorylines(
  raw: unknown,
  players: readonly StorylinePlayer[],
): { suggestions: StorylineSuggestion[]; notes: string[] } {
  const byId = new Map(players.map((player) => [player.id, player]));
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const suggestions: StorylineSuggestion[] = [];
  const taken = new Set<string>();
  for (const entry of Array.isArray(value.players) ? value.players : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, storyline } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof storyline !== "string") continue;
    const player = byId.get(id);
    if (!player || taken.has(id)) continue;
    const fitted = fitStoryline(storyline);
    if (fitted.length === 0 || fitted === player.storyline) continue;
    taken.add(id);
    suggestions.push({ id, storyline: fitted });
  }

  const notes = (Array.isArray(value.notes) ? value.notes : [])
    .filter((note): note is string => typeof note === "string")
    .map((note) => note.replace(/\s+/g, " ").trim())
    .filter((note) => note.length > 0)
    .map((note) => (note.length > 200 ? `${note.slice(0, 199)}…` : note))
    .slice(0, 10);

  return { suggestions, notes };
}

/** Whether a 200 body is this route's answer. */
export function isStorylinesResponse(body: unknown): body is StorylinesResponse {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as { suggestions?: unknown; notes?: unknown };
  return (
    Array.isArray(candidate.suggestions) &&
    candidate.suggestions.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as StorylineSuggestion).id === "string" &&
        typeof (entry as StorylineSuggestion).storyline === "string",
    ) &&
    Array.isArray(candidate.notes)
  );
}

/**
 * The announcer's picks, written into the table: each picked row's storyline
 * replaced, marked edited, everything else untouched. A row deleted while the
 * file was being read is simply not there to write to.
 */
export function applyStorylines(rows: readonly EditorRow[], picks: ReadonlyMap<string, string>): EditorRow[] {
  return rows.map((row) => {
    const storyline = picks.get(row.key);
    if (storyline === undefined) return row;
    const fitted = fitStoryline(storyline);
    if (fitted === (row.player.storyline ?? "")) return row;
    return { ...row, player: { ...row.player, storyline: fitted }, edited: true };
  });
}
