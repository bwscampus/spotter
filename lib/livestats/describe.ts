import type { FootballStatKey, FootballStats } from "@/lib/cards/statKeys";
import { isYardKey, type StatChange } from "@/lib/cards/tonight";
import type { LoggedDrop } from "@/lib/log/statsLog";
import type { AppliedPlay, DroppedEvent, PlayerDelta } from "./apply";
import type { StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// A play's changes in words, the way the change strip shows them
// (docs/V3_DEFINITION.md 8.6):
//
//   Q2 3rd & 4 · LANGAN #22 +1 CAR +8 YDS · OSSUETTA #17 +1 TKL
//
// Worked-out yards are "~8 YDS", unknown yards are "YDS ?", and a play that
// lost an event says "! R3". Pure, so the replay harness prints exactly what
// the strip will show.
// =============================================================================

// =============================================================================
// TUNING: how the strip reads.
// =============================================================================

/** Between the play's header and each player. */
export const STRIP_SEPARATOR = " · ";

/** When a player had an action with yards and none were known (rule R8). */
export const YARDS_UNKNOWN = "YDS ?";

/** Marks a play that lost an event to a rule. */
export const DROPPED_MARK = "!";

// =============================================================================

/** "Q2 3rd & 4 · LANGAN #22 +1 CAR +8 YDS · OSSUETTA #17 +1 TKL ! R3". */
export function describePlay(applied: AppliedPlay, roster: readonly StatsRosterPlayer[]): string {
  const players = new Map(roster.map((player) => [player.playerId, player]));
  const parts = [header(applied.play), ...applied.deltas.map((delta) => describeDelta(delta, players.get(delta.playerId)))];
  let line = parts.filter((part) => part.length > 0).join(STRIP_SEPARATOR);
  const rules = [...new Set(applied.dropped.map((drop) => drop.rule))];
  if (rules.length > 0) line = `${line} ${DROPPED_MARK} ${rules.join(" ")}`.trim();
  return line;
}

/** "Q2 3rd & 4", as much of it as the announcer said. Empty when he said none of it. */
export function header(play: Pick<StatsPlay, "quarter" | "down" | "distance">): string {
  const parts: string[] = [];
  if (play.quarter !== null) parts.push(play.quarter > 4 ? "OT" : `Q${play.quarter}`);
  if (play.down !== null) parts.push(play.distance !== null ? `${ordinal(play.down)} & ${play.distance}` : `${ordinal(play.down)} down`);
  return parts.join(" ");
}

/** "LANGAN #22", or the playerId for somebody the roster does not have, or UNKNOWN for nobody. */
export function playerLabel(playerId: string, player: StatsRosterPlayer | undefined): string {
  if (playerId === "") return "UNKNOWN";
  if (!player) return playerId;
  const surname = player.last.toUpperCase();
  return player.jersey ? `${surname} #${player.jersey.replace(/^#/, "")}` : surname;
}

/** "LANGAN #22 +1 CAR +8 YDS". */
export function describeDelta(delta: PlayerDelta, player: StatsRosterPlayer | undefined): string {
  const s = delta.stats;
  const estimated = new Set(delta.estimated);
  const yards = (key: FootballStatKey) => (s[key] === undefined ? "" : ` ${signedYards(s[key]!, estimated.has(key))}`);
  const parts: string[] = [];
  const count = (key: FootballStatKey, label: string, yardsKey?: FootballStatKey) => {
    if (!s[key]) return;
    parts.push(`+${num(s[key]!)} ${label}${yardsKey ? yards(yardsKey) : ""}`);
  };

  count("rush_att", "CAR", "rush_yds");
  if (s.pass_cmp) count("pass_cmp", "CMP", "pass_yds");
  else count("pass_att", "ATT");
  count("pass_int", "INT");
  count("rec", "REC", "rec_yds");
  count("tkl", "TKL");
  count("sacks", "SACK", "sack_yds");
  count("pbu", "PBU");
  count("def_int", "INT", "int_ret_yds");
  count("ff", "FF");
  if (s.fum) parts.push(`+${num(s.fum)} ${s.fum_lost ? "FUM LOST" : "FUM"}`);
  count("fr", "FR", "fr_ret_yds");
  count("kr", "KR", "kr_yds");
  count("pr", "PR", "pr_yds");
  if (s.fgm) parts.push(`+${num(s.fgm)} FG${s.fg_long ? ` ${estimated.has("fg_long") ? "~" : ""}${num(s.fg_long)} YDS` : ""}`);
  else count("fga", "FG MISSED");
  if (s.xpm) parts.push(`+${num(s.xpm)} XP`);
  else count("xpa", "XP MISSED");
  count("punts", "PUNT", "punt_yds");
  const tds = touchdowns(s);
  if (tds > 0) parts.push(`+${num(tds)} TD`);
  if (delta.yardsUnknown) parts.push(YARDS_UNKNOWN);

  return [playerLabel(delta.playerId, player), ...parts].join(" ");
}

/** "tackle by OSSUETTA #17: R2, nobody to tackle on an incomplete pass or a breakup". */
export function describeDrop(drop: DroppedEvent, roster: readonly StatsRosterPlayer[]): string {
  const player = roster.find((entry) => entry.playerId === drop.event.playerId);
  return `${drop.event.action} by ${playerLabel(drop.event.playerId, player)}: ${drop.rule}, ${drop.reason}`;
}

/**
 * A logged drop or fill in words: "pass incomplete by SPIVEY #24: R14,
 * filled in for LANGAN #7, not a quarterback and not said to have thrown it;
 * the quarterback on the field". What the recorded replay prints and the
 * strip's tooltip says. Logs from before Oct 6 also carry moves.
 */
export function describeLoggedDrop(drop: LoggedDrop, roster: readonly StatsRosterPlayer[]): string {
  const players = new Map(roster.map((player) => [player.playerId, player]));
  const who = drop.playerId === "" ? "nobody" : playerLabel(drop.playerId, players.get(drop.playerId));
  const action = drop.action.replace(/_/g, " ");
  const to = drop.to ? `${drop.kind === "filled" ? "filled in for" : "moved to"} ${playerLabel(drop.to, players.get(drop.to))}, ` : "";
  return `${action} by ${who}: ${drop.rule}, ${to}${drop.reason}`;
}

function touchdowns(s: FootballStats): number {
  return (["rush_td", "pass_td", "rec_td", "kr_td", "pr_td", "int_td", "fr_td"] as const).reduce(
    (sum, key) => sum + (s[key] ?? 0),
    0,
  );
}

/** "+8 YDS", "-3 YDS", or "~8 YDS" when the 8 was worked out. */
function signedYards(value: number, estimated: boolean): string {
  if (estimated) return `~${num(value)} YDS`;
  return `${value >= 0 ? "+" : ""}${num(value)} YDS`;
}

function ordinal(n: number): string {
  return ({ 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" } as Record<number, string>)[n] ?? `${n}th`;
}

/** Half a sack as "0.5". */
function num(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// -----------------------------------------------------------------------------
// The strip as Jed set it on Oct 2: one comma-separated item per change, each
// item exactly one name, one stat and one amount, so a click lands on one
// thing. "LANGAN #22 +1 CAR, LANGAN #22 +8 RUSH YDS, OSSUETTA #17 +1 TKL".
// -----------------------------------------------------------------------------

/** What each stat is called in the strip. Short, and never ambiguous about which yards. */
export const STRIP_LABELS: Record<FootballStatKey, string> = {
  gp: "GP",
  rush_att: "CAR",
  rush_yds: "RUSH YDS",
  rush_td: "RUSH TD",
  pass_cmp: "CMP",
  pass_att: "ATT",
  pass_yds: "PASS YDS",
  pass_td: "PASS TD",
  pass_int: "INT THROWN",
  rec: "REC",
  rec_yds: "REC YDS",
  rec_td: "REC TD",
  tkl: "TKL",
  sacks: "SACK",
  sack_yds: "SACK YDS",
  def_int: "INT",
  int_ret_yds: "INT YDS",
  int_td: "INT TD",
  pbu: "PBU",
  ff: "FF",
  fr: "FR",
  fr_ret_yds: "FR YDS",
  fr_td: "FR TD",
  fum: "FUM",
  fum_lost: "FUM LOST",
  kr: "KR",
  kr_yds: "KR YDS",
  kr_td: "KR TD",
  pr: "PR",
  pr_yds: "PR YDS",
  pr_td: "PR TD",
  fgm: "FG",
  fga: "FGA",
  fg_long: "FG LONG",
  xpm: "XP",
  xpa: "XPA",
  punts: "PUNT",
  punt_yds: "PUNT YDS",
};

/**
 * One change's amount as the strip shows it: "+1", "-3", "~8" for worked-out
 * yards, "?" for yards nobody said. A long field goal is a length, not an
 * addition, so it has no sign.
 */
export function amountText(change: Pick<StatChange, "key" | "amount" | "estimated">): string {
  if (change.amount === null) return "?";
  const value = num(change.amount);
  if (change.estimated) return `~${value}`;
  if (change.key === "fg_long") return value;
  return change.amount >= 0 ? `+${value}` : value;
}

/** "LANGAN #22 +1 CAR +8 RUSH YDS · OSSUETTA #17 +1 TKL": one play's changes, each player named once. */
export function playText(changes: readonly StatChange[], players: ReadonlyMap<string, StatsRosterPlayer>): string {
  const byPlayer = new Map<string, string[]>();
  for (const change of changes) {
    const parts = byPlayer.get(change.playerId) ?? [];
    parts.push(`${amountText(change)} ${STRIP_LABELS[change.key]}`);
    byPlayer.set(change.playerId, parts);
  }
  return [...byPlayer]
    .map(([playerId, parts]) => `${playerLabel(playerId, players.get(playerId))} ${parts.join(" ")}`)
    .join(STRIP_SEPARATOR);
}

/** "LANGAN #22 +8 RUSH YDS". */
export function changeText(change: StatChange, player: StatsRosterPlayer | undefined): string {
  return `${playerLabel(change.playerId, player)} ${amountText(change)} ${STRIP_LABELS[change.key]}`;
}

/** The whole play as one line of items. */
export function changesText(changes: readonly StatChange[], roster: readonly StatsRosterPlayer[]): string {
  const players = new Map(roster.map((player) => [player.playerId, player]));
  return changes.map((change) => changeText(change, players.get(change.playerId))).join(", ");
}

/**
 * The chip on a card already up when a play is OK'd: that player's part of
 * it, short. "+1 CAR +8", with ~ for worked-out yards.
 */
export function chipText(changes: readonly StatChange[]): string {
  return changes
    .filter((change) => change.amount !== null)
    .map((change) => {
      const amount = amountText(change);
      // Yards read as a number on the chip: "+1 CAR +8" rather than "+8 RUSH YDS".
      return isYardKey(change.key) && change.key !== "fg_long" ? amount : `${amount} ${STRIP_LABELS[change.key]}`;
    })
    .join(" ");
}
