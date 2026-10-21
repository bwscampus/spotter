import type { StatItem, StatLine } from "./lines";

// =============================================================================
// Volleyball: what a card says about a player (Jed, Oct 21). Volleyball is
// prep and spot only: the season stats the announcer uploaded, shown as they
// were printed, and nothing that changes during the match.
//
// A player's stats are a list of labelled values, saved as the sheet printed
// them (roster_players.season_values), so a column nobody planned for is kept
// rather than dropped. The labels the card knows are the abbreviations in
// VOLLEYBALL_STATS; anything else keeps the sheet's own header, stays on the
// team page, and is left off the card.
//
// Pure, and shared: the roster import, the stats import and the card all use
// these rules, and this file imports nothing from either side.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The most values kept per player, and how long a label or a value may be. */
export const MAX_STAT_VALUES = 40;
export const MAX_STAT_LABEL_CHARS = 24;
export const MAX_STAT_VALUE_CHARS = 16;

/**
 * The stats a card leads with, by position, in the order they are said (Jed,
 * Oct 21). Each starts the card's first column; the player's other stats
 * follow in VOLLEYBALL_STATS order.
 */
export const POSITION_PRIORITY: Record<VolleyballPosition, readonly VolleyballStatKey[]> = {
  OH: ["K", "PCT", "K/S", "SA", "DIG"],
  OPP: ["K", "PCT", "K/S", "SA", "DIG"],
  MB: ["K", "PCT", "BLK", "BLK/S"],
  S: ["A", "A/S", "SA", "DIG", "BLK"],
  L: ["DIG", "DIG/S", "R%", "SA"],
  DS: ["DIG", "DIG/S", "R%", "SA"],
};

/** With no position, these lead instead, the biggest first: the counts that say what a player does. */
export const HEADLINE_STATS: readonly VolleyballStatKey[] = ["PTS", "K", "A", "DIG", "R", "SA", "BLK", "BS", "BA"];

// =============================================================================

export const VOLLEYBALL_POSITIONS = ["OH", "MB", "S", "OPP", "L", "DS"] as const;
export type VolleyballPosition = (typeof VOLLEYBALL_POSITIONS)[number];

/**
 * Every stat the card knows, in the order the rest of a card lists them:
 * hitting, setting, serving, defense, blocking, reception, points, then how
 * much they played, each the headline number first.
 * `card` is how the card says it, after the value ("245 kills"); `name` is
 * what the review tables call it.
 */
export const VOLLEYBALL_STATS = [
  { key: "K", name: "Kills", card: "kills" },
  { key: "PCT", name: "Hitting %", card: "hit%" },
  { key: "K/S", name: "Kills per set", card: "kills/set" },
  { key: "E", name: "Attack errors", card: "att err" },
  { key: "TA", name: "Total attacks", card: "attacks" },
  { key: "A", name: "Assists", card: "assists" },
  { key: "A/S", name: "Assists per set", card: "ast/set" },
  { key: "SA", name: "Aces", card: "aces" },
  { key: "SA/S", name: "Aces per set", card: "aces/set" },
  { key: "SE", name: "Service errors", card: "serve err" },
  { key: "DIG", name: "Digs", card: "digs" },
  { key: "DIG/S", name: "Digs per set", card: "digs/set" },
  { key: "BLK", name: "Total blocks", card: "blocks" },
  { key: "BLK/S", name: "Blocks per set", card: "blk/set" },
  { key: "BS", name: "Solo blocks", card: "solo blk" },
  { key: "BA", name: "Block assists", card: "blk ast" },
  { key: "R", name: "Receptions", card: "rec" },
  { key: "R%", name: "Reception %", card: "rec%" },
  { key: "RE", name: "Reception errors", card: "rec err" },
  { key: "PTS", name: "Points", card: "pts" },
  { key: "MP", name: "Matches played", card: "matches" },
  { key: "SP", name: "Sets played", card: "sets" },
] as const;

export type VolleyballStatKey = (typeof VOLLEYBALL_STATS)[number]["key"];
export const VOLLEYBALL_STAT_KEYS: readonly VolleyballStatKey[] = VOLLEYBALL_STATS.map((stat) => stat.key);

/** One stat as the sheet printed it: "K" and "245", or a header nobody planned for and its cell. */
export interface StatValue {
  label: string;
  value: string;
}

/**
 * Lowercase, "per set" and "/Set" as "/s", and nothing but letters, digits,
 * "/" and "%", so "Hit %" and "hit%" are one header, and "Kills per set",
 * "Kills/Set" and "K/S" are written alike.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*(?:\bper\b|\/)\s*sets?\b/g, "/s")
    .replace(/[^a-z0-9/%]/g, "");
}

/** Headers the model or a sheet may use for a known stat, folded. Only ones that cannot mean two things. */
const SYNONYMS: Record<string, VolleyballStatKey> = {};
for (const [key, names] of Object.entries({
  K: ["k", "kills", "kill"],
  E: ["e", "attackerrors", "attackerror", "atterr", "attackerr", "hittingerrors"],
  TA: ["ta", "totalattacks", "totalattempts", "attackattempts"],
  PCT: ["pct", "hit%", "hitpct", "hitting%", "hittingpct", "hittingpercentage", "attack%", "attackpct", "eff"],
  "K/S": ["k/s", "kills/s", "kill/s", "kps"],
  A: ["a", "ast", "assists", "setassists", "settingassists"],
  "A/S": ["a/s", "ast/s", "assists/s", "aps"],
  SA: ["sa", "ace", "aces", "serviceaces"],
  SE: ["se", "serviceerrors", "serveerrors", "serviceerror", "serveerror"],
  "SA/S": ["sa/s", "aces/s", "ace/s"],
  DIG: ["dig", "digs", "d"],
  "DIG/S": ["dig/s", "digs/s", "d/s"],
  BS: ["bs", "solo", "soloblocks", "blocksolo", "blocksolos"],
  BA: ["ba", "blockassists", "blockassist"],
  BLK: ["blk", "tb", "totalblocks", "blocks"],
  "BLK/S": ["blk/s", "b/s", "tb/s", "blocks/s"],
  R: ["r", "rec", "receptions", "servereceptions", "serverec"],
  RE: ["re", "receptionerrors", "receptionerror", "recerr", "rerr", "receiveerrors"],
  "R%": ["r%", "rec%", "receptionpct", "reception%", "receptionpercentage"],
  SP: ["sp", "setsplayed"],
  MP: ["mp", "matchesplayed"],
  PTS: ["pts", "points", "totalpoints"],
} satisfies Record<VolleyballStatKey, string[]>)) {
  for (const name of names) SYNONYMS[fold(name)] = key as VolleyballStatKey;
}

/** The known stat a header names, or null when it is one the card does not know. */
export function volleyballStatKey(label: string): VolleyballStatKey | null {
  return SYNONYMS[fold(label)] ?? null;
}

/** A blank cell, or a dash or "N/A" standing in for one. */
function isBlank(value: string): boolean {
  return /^(?:|[-–—]+|n\/?a)$/i.test(value);
}

/**
 * Trusts nothing about the shape: each entry needs a label and a value (a
 * number is kept as written), a known header becomes its key, a blank cell is
 * dropped, the first value for a label wins, and the list is capped. Values
 * are never changed beyond trimming: they are what the sheet printed.
 */
export function cleanStatValues(raw: unknown): StatValue[] {
  if (!Array.isArray(raw)) return [];
  const kept: StatValue[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, value } = entry as { label?: unknown; value?: unknown };
    if (typeof label !== "string") continue;
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : null;
    if (text === null || isBlank(text) || [...text].length > MAX_STAT_VALUE_CHARS) continue;
    const header = label.replace(/\s+/g, " ").trim();
    if (header.length === 0) continue;
    const name = volleyballStatKey(header) ?? [...header].slice(0, MAX_STAT_LABEL_CHARS).join("");
    const key = fold(name) || name;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ label: name, value: text });
    if (kept.length === MAX_STAT_VALUES) break;
  }
  return kept;
}

/**
 * A position as the card shows it: OH, MB, S, OPP, L or DS. Variants are
 * folded ("Outside", "Middle Hitter", "Right Side", "Libero/DS"), and when a
 * player has two the first is theirs ("MB, RS" is MB). Null when it is none
 * of these, and the card keeps whatever the roster says.
 */
export function volleyballPosition(raw: string | null | undefined): VolleyballPosition | null {
  const first = (raw ?? "").split(/[/,;&|]|\band\b/i)[0]?.trim().toLowerCase().replace(/[.\s-]+/g, " ").trim() ?? "";
  if (first.length === 0) return null;
  const word = first.replace(/ /g, "");
  if (["oh", "lh", "outside", "outsidehitter", "lefthitter", "leftside", "leftsidehitter", "outsidehitters"].includes(word)) return "OH";
  if (["mb", "mh", "m", "middle", "middleblocker", "middlehitter", "middleblockers"].includes(word)) return "MB";
  if (["s", "set", "setter", "setters"].includes(word)) return "S";
  if (["opp", "op", "o", "rs", "rh", "opposite", "oppositehitter", "rightside", "rightsidehitter", "righthitter", "oppositeside"].includes(word)) return "OPP";
  if (["l", "lib", "libero", "liberos"].includes(word)) return "L";
  if (["ds", "def", "defensivespecialist", "defensivespecialists", "defense"].includes(word)) return "DS";
  return null;
}

/** A printed value as a number: "1,024" is 1024, ".312" is 0.312, "92.5%" is 92.5. Null when it is not one. */
export function statNumber(value: string): number | null {
  const text = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * (K - E) / TA as volleyball writes it, ".312" or "-.050", only when the
 * player has all three and some attacks, and only when the sheet did not
 * print a hitting percentage of its own. The one stat the card ever works out.
 */
export function hittingPct(values: readonly StatValue[]): string | null {
  const known = knownValues(values);
  if (known.has("PCT")) return null;
  const kills = numberOf(known, "K");
  const errors = numberOf(known, "E");
  const attacks = numberOf(known, "TA");
  if (kills === null || errors === null || attacks === null || attacks <= 0) return null;
  const pct = (kills - errors) / attacks;
  const fixed = Math.abs(pct).toFixed(3);
  const text = fixed.startsWith("0") ? fixed.slice(1) : fixed;
  return pct < 0 && Number(fixed) !== 0 ? `-${text}` : text;
}

/** Known stats by key, the first of each. */
function knownValues(values: readonly StatValue[]): Map<VolleyballStatKey, string> {
  const known = new Map<VolleyballStatKey, string>();
  for (const { label, value } of values) {
    const key = volleyballStatKey(label);
    if (key && !known.has(key)) known.set(key, value);
  }
  return known;
}

function numberOf(known: Map<VolleyballStatKey, string>, key: VolleyballStatKey): number | null {
  const value = known.get(key);
  return value === undefined ? null : statNumber(value);
}

const CARD_LABEL = new Map<string, string>(VOLLEYBALL_STATS.map((stat) => [stat.key, stat.card]));

/** One stat as the card says it: "245 kills", ".312 hit%"; "92% rec" when the value already carries its %. */
function item(key: VolleyballStatKey, value: string, group: number): StatItem {
  const card = CARD_LABEL.get(key)!;
  const label = card.endsWith("%") && value.endsWith("%") ? card.slice(0, -1) : card;
  return { value, label, estimated: false, group };
}

/**
 * A volleyball card's season line (Jed, Oct 21): the position's priority
 * stats first, as one group (the card's first column), then every other
 * known stat the player has, in VOLLEYBALL_STATS order, as the next. With no
 * position recognised, the headline counts lead, biggest first. A value of
 * zero is left off, as football's are, so a libero's card shows what a
 * libero does rather than a column of noughts; so is a header the card does
 * not know. Empty when the player has nothing to show.
 */
export function volleyballLine(values: readonly StatValue[], position: string | null | undefined): StatLine {
  const known = knownValues(values);
  const pct = hittingPct(values);
  if (pct !== null) known.set("PCT", pct);
  for (const [key, value] of known) {
    if (statNumber(value) === 0) known.delete(key);
  }
  if (known.size === 0) return [];

  const role = volleyballPosition(position);
  const lead = role
    ? POSITION_PRIORITY[role].filter((key) => known.has(key))
    : HEADLINE_STATS.filter((key) => known.has(key))
        .map((key, order) => ({ key, order, size: statNumber(known.get(key)!) ?? 0 }))
        .sort((a, b) => b.size - a.size || a.order - b.order)
        .map(({ key }) => key);
  const rest = VOLLEYBALL_STAT_KEYS.filter((key) => known.has(key) && !lead.includes(key));

  const groups = [lead, rest].filter((group) => group.length > 0);
  return groups.flatMap((group, index) => group.map((key) => item(key, known.get(key)!, index)));
}
