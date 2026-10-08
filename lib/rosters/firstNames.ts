import { compileWatchlist, normalizeWord, phoneticKeys, scoreAgainst, type CompiledEntry } from "@/lib/matching/matcher";
import { CLOSE_RATIO, type HitVerdict } from "./commonWordHits";
import { spokenForms } from "./spokenForms";

// =============================================================================
// A first name that is another player's surname (Oct 4: "tyler" put up Taylor
// in both college games, and "lee" put up Lee twelve times). The card matcher
// listens for surnames, and a first name said before a different surname is
// one of them to it. This only warns, in prep and at setup; the matcher is
// not changed (CLAUDE.md: matcher.ts is never edited).
//
// Scored with the real matcher and the real thresholds, the way the
// common-word check is, so a hit here is a card that would go up.
// =============================================================================

/** Shorter first names are initials and nicknames the matcher would not hear as a surname anyway. */
const MIN_FIRST_LETTERS = 3;

export interface FirstNamePlayer {
  first_name: string | null;
  last_name: string;
  jersey: string | null;
  side?: "H" | "A";
  spot_mode?: string;
  pronunciations?: readonly string[];
}

export interface FirstNameCollision {
  /** Index of the player whose first name it is, in the list given. */
  index: number;
  first: string;
  /** The surname it sounds like, as printed, and that player's jersey and side. */
  surname: string;
  jersey: string | null;
  side: "H" | "A" | null;
  score: number;
  verdict: HitVerdict;
}

/**
 * Every first name on the list that the matcher would hear as another player's
 * surname, best score first. Players set to "off" put no card up, so their
 * surnames are left out; a first name that is the player's own surname is not
 * a collision.
 */
export function firstNameCollisions(players: readonly FirstNamePlayer[]): FirstNameCollision[] {
  const compiled = new Map<string, { entry: CompiledEntry; owners: number[] }>();
  players.forEach((player, index) => {
    if (player.spot_mode === "off") return;
    const forms = spokenForms(player.last_name, player.pronunciations ?? []);
    const primary = forms[0];
    if (!primary) return;
    const existing = compiled.get(primary);
    if (existing) existing.owners.push(index);
    else compiled.set(primary, { entry: compileWatchlist([{ name: primary, aliases: forms.slice(1) }])[0], owners: [index] });
  });

  const collisions: FirstNameCollision[] = [];
  players.forEach((player, index) => {
    const first = (player.first_name ?? "").trim();
    const text = normalizeWord(first);
    if (text.length < MIN_FIRST_LETTERS) return;
    const own = spokenForms(player.last_name)[0];
    const keys = phoneticKeys(text);
    for (const [primary, { entry, owners }] of compiled) {
      if (primary === own) continue;
      const { score, minScore } = scoreAgainst(text, keys, entry);
      const verdict: HitVerdict | null = score >= minScore ? "would_fire" : score >= minScore * CLOSE_RATIO ? "close" : null;
      if (!verdict) continue;
      const owner = players[owners[0]];
      collisions.push({ index, first, surname: owner.last_name, jersey: owner.jersey, side: owner.side ?? null, score, verdict });
    }
  });
  return collisions.sort((a, b) => b.score - a.score);
}
