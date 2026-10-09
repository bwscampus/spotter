import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import { playerLabel, STRIP_LABELS } from "./describe";
import type { StatsRosterPlayer } from "./types";

// =============================================================================
// What a correction box offers as it is typed in (docs/V3_DEFINITION.md 8.6;
// Jed, Oct 8). Each word of a counted play (the player, the stat, the number)
// opens a box filled with what Spotter read, so a fix is typing over it: these
// put the prediction first while the box is untouched, then whatever the typing
// matches, best first. A player is picked whole, name and number together,
// never one without the other. Pure, so a test can type into it.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Players offered at most. Both college rosters fit. */
export const PLAYERS_OFFERED = 400;

/** Words an announcer might type for a stat, beside its strip label and key. */
const STAT_WORDS: Partial<Record<FootballStatKey, string[]>> = {
  rush_att: ["carry", "carries", "rush", "run"],
  rush_yds: ["rushing yards", "run yards"],
  rush_td: ["rushing touchdown", "run td"],
  pass_cmp: ["completion", "complete"],
  pass_att: ["attempt", "pass attempt", "incomplete"],
  pass_yds: ["passing yards", "throw yards"],
  pass_td: ["passing touchdown", "throw td"],
  pass_int: ["interception thrown", "picked off"],
  rec: ["reception", "catch", "catches"],
  rec_yds: ["receiving yards", "catch yards"],
  rec_td: ["receiving touchdown", "catch td"],
  tkl: ["tackle", "tackles", "stop"],
  sacks: ["sack"],
  sack_yds: ["sack yards"],
  def_int: ["interception", "pick"],
  int_ret_yds: ["interception return yards", "pick yards"],
  int_td: ["pick six", "interception touchdown"],
  pbu: ["pass breakup", "breakup", "deflection"],
  ff: ["forced fumble"],
  fr: ["fumble recovery", "recovered"],
  fr_ret_yds: ["fumble return yards"],
  fr_td: ["fumble return touchdown"],
  fum: ["fumble"],
  fum_lost: ["fumble lost"],
  kr: ["kick return", "kickoff return"],
  kr_yds: ["kick return yards"],
  kr_td: ["kick return touchdown"],
  pr: ["punt return"],
  pr_yds: ["punt return yards"],
};

// =============================================================================

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/#/g, " ")
    .split(/[\s,]+/)
    .filter((word) => word.length > 0);
}

const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The players a player box offers for what is typed in it. Untouched (still
 * the prediction, or empty), it offers the predicted player first and then
 * everyone, their side first. Typed, every word must match: a number is the
 * jersey, exactly, and a word is the start of the surname or first name, or
 * anywhere in the surname. "22" offers both teams' 22s, the predicted side's
 * first; "22 lan" offers only Langan.
 */
export function suggestPlayers(
  roster: readonly StatsRosterPlayer[],
  typed: string,
  predictedId: string | null,
): StatsRosterPlayer[] {
  const predicted = predictedId ? roster.find((player) => player.playerId === predictedId) : undefined;
  const side = predicted?.side ?? "away";
  const order = (a: StatsRosterPlayer, b: StatsRosterPlayer) =>
    (a.side === b.side ? 0 : a.side === side ? -1 : 1) ||
    Number(a.jersey?.replace(/^#/, "") ?? 999) - Number(b.jersey?.replace(/^#/, "") ?? 999) ||
    a.last.localeCompare(b.last);

  const untouched = typed.trim() === "" || (predicted !== undefined && typed.trim() === playerLabel(predicted.playerId, predicted));
  if (untouched) {
    const rest = roster.filter((player) => player !== predicted).sort(order);
    return (predicted ? [predicted, ...rest] : rest).slice(0, PLAYERS_OFFERED);
  }

  const terms = words(typed);
  const scored: { player: StatsRosterPlayer; score: number }[] = [];
  for (const player of roster) {
    const jersey = player.jersey?.replace(/^#/, "") ?? "";
    const last = bare(player.last);
    const first = bare(player.first ?? "");
    let score = 0;
    let all = true;
    for (const term of terms) {
      if (/^\d+$/.test(term)) {
        if (term === jersey) score += 3;
        else all = false;
        continue;
      }
      const word = bare(term);
      if (word === "") continue;
      if (last === word) score += 4;
      else if (last.startsWith(word)) score += 3;
      else if (first.startsWith(word)) score += 2;
      else if (last.includes(word)) score += 1;
      else all = false;
    }
    if (all && score > 0) scored.push({ player, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || order(a.player, b.player))
    .map((entry) => entry.player)
    .slice(0, PLAYERS_OFFERED);
}

/** Every stat a correction can be, as the box lists them: the strip's order, no games played. */
const STATS: readonly FootballStatKey[] = FOOTBALL_STAT_KEYS.filter((key) => key !== "gp");

/**
 * The stats a stat box offers for what is typed in it. Untouched, the
 * predicted stat first and then every other. Typed, those whose label, key or
 * spoken words start with it first ("car", "tack"), then those that contain it.
 */
export function suggestStats(typed: string, predicted: FootballStatKey | null): FootballStatKey[] {
  const term = typed.trim().toLowerCase();
  const untouched = term === "" || (predicted !== null && term === STRIP_LABELS[predicted].toLowerCase());
  if (untouched) return predicted ? [predicted, ...STATS.filter((key) => key !== predicted)] : [...STATS];

  const plain = term.replace(/[_\s]+/g, " ");
  const names = (key: FootballStatKey) => [STRIP_LABELS[key].toLowerCase(), key.replace(/_/g, " "), ...(STAT_WORDS[key] ?? [])];
  const starts = STATS.filter((key) => names(key).some((name) => name === plain))
    .concat(STATS.filter((key) => names(key).some((name) => name !== plain && name.startsWith(plain))))
    .concat(STATS.filter((key) => names(key).some((name) => !name.startsWith(plain) && name.includes(plain))));
  return [...new Set(starts)];
}

/**
 * A typed number: what the number box saves. Blank or "?" is "not known";
 * anything else that is not a number is nothing, and the box stays open.
 */
export function typedAmount(typed: string): { ok: true; amount: number | null } | { ok: false } {
  const trimmed = typed.trim().replace(/^\+/, "").replace(/^~/, "");
  if (trimmed === "" || trimmed === "?") return { ok: true, amount: null };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, amount: value } : { ok: false };
}
