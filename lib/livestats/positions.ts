import type { Action, Side } from "./types";

// =============================================================================
// What a roster position means for a stat (the check in ./check.ts): who can
// throw, who can carry, who tackles, who kicks. Positions are free text as the
// roster printed them ("QB", "Wide Receiver", "OL/DL", "ATH"), so they are read
// into groups here and nowhere else.
//
// A position nobody wrote passes every position check: silence is not
// evidence. A position that names two groups passes a check either one would.
// =============================================================================

export type PositionGroup = "qb" | "skill" | "ol" | "dl" | "lb" | "db" | "k" | "p" | "ls" | "unknown";

/** Which side of the ball a group plays on. */
export type Unit = "offense" | "defense" | "special";

const CODES: Record<string, PositionGroup> = {
  QB: "qb",
  RB: "skill", FB: "skill", HB: "skill", TB: "skill", AB: "skill", WR: "skill", TE: "skill", SB: "skill", SE: "skill",
  FL: "skill", WB: "skill", H: "skill", X: "skill", Y: "skill", Z: "skill", REC: "skill",
  OL: "ol", OT: "ol", OG: "ol", C: "ol", T: "ol", G: "ol", LT: "ol", RT: "ol", LG: "ol", RG: "ol",
  DL: "dl", DE: "dl", DT: "dl", NT: "dl", NG: "dl", EDGE: "dl", DI: "dl",
  LB: "lb", ILB: "lb", OLB: "lb", MLB: "lb", WLB: "lb", SLB: "lb", MIKE: "lb", WILL: "lb", SAM: "lb", RUSH: "lb",
  DB: "db", CB: "db", S: "db", FS: "db", SS: "db", NB: "db", NCB: "db", SAF: "db", STAR: "db", HUSKY: "db",
  K: "k", PK: "k", KO: "k",
  P: "p",
  LS: "ls",
};

/** Spelled-out positions, most specific first, so "Defensive Tackle" is DT before "Tackle" alone is T. */
const SPELLED_OUT: Array<[RegExp, string]> = [
  [/\bQUARTER\s*BACKS?\b/g, "QB"],
  [/\bRUNNING\s*BACKS?\b/g, "RB"],
  [/\bFULL\s*BACKS?\b/g, "FB"],
  [/\bHALF\s*BACKS?\b/g, "HB"],
  [/\bTAIL\s*BACKS?\b/g, "TB"],
  [/\bWIDE\s*RECEIVERS?\b/g, "WR"],
  [/\bTIGHT\s*ENDS?\b/g, "TE"],
  [/\bOFFENSIVE\s+LINE(MAN|MEN)?\b/g, "OL"],
  [/\bDEFENSIVE\s+LINE(MAN|MEN)?\b/g, "DL"],
  [/\bNOSE\s+TACKLE\b/g, "NT"],
  [/\bNOSE\s+GUARD\b/g, "NG"],
  [/\bDEFENSIVE\s+TACKLE\b/g, "DT"],
  [/\bDEFENSIVE\s+END\b/g, "DE"],
  [/\bDEFENSIVE\s+BACKS?\b/g, "DB"],
  [/\bOFFENSIVE\s+TACKLE\b/g, "OT"],
  [/\bOFFENSIVE\s+GUARD\b/g, "OG"],
  [/\bLINE\s*BACKERS?\b/g, "LB"],
  [/\bCORNER\s*BACKS?\b/g, "CB"],
  [/\bFREE\s+SAFETY\b/g, "FS"],
  [/\bSTRONG\s+SAFETY\b/g, "SS"],
  [/\bSAFETY\b/g, "S"],
  [/\bLONG\s+SNAPPER\b/g, "LS"],
  [/\bPLACE\s*KICKER\b/g, "K"],
  [/\bKICKER\b/g, "K"],
  [/\bPUNTER\b/g, "P"],
  [/\bTACKLE\b/g, "T"],
  [/\bGUARD\b/g, "G"],
  [/\bCENTER\b/g, "C"],
];

/** Words that only qualify a position, so they must not count as one. */
const MODIFIERS = new Set(["OFFENSIVE", "DEFENSIVE", "LEFT", "RIGHT", "STRONG", "WEAK", "INSIDE", "OUTSIDE", "SLOT", "BACKUP"]);

/**
 * Every group a position names, in order. ["unknown"] when the roster said
 * nothing readable ("", "ATH", a code nobody knows).
 */
export function positionGroups(position: string | null | undefined): PositionGroup[] {
  let text = (position ?? "").toUpperCase();
  if (text.trim().length === 0) return ["unknown"];
  for (const [pattern, code] of SPELLED_OUT) text = text.replace(pattern, code);
  const groups: PositionGroup[] = [];
  for (const raw of text.split(/[,/\\|&+\s-]+/)) {
    const token = raw.replace(/[^A-Z]/g, "");
    if (token.length === 0 || MODIFIERS.has(token)) continue;
    const group = CODES[token];
    if (group && !groups.includes(group)) groups.push(group);
  }
  return groups.length > 0 ? groups : ["unknown"];
}

export function unitOf(group: PositionGroup): Unit | null {
  switch (group) {
    case "qb":
    case "skill":
    case "ol":
      return "offense";
    case "dl":
    case "lb":
    case "db":
      return "defense";
    case "k":
    case "p":
    case "ls":
      return "special";
    default:
      return null;
  }
}

/** True when the position is unknown or names at least one of the allowed groups. */
export function positionAllows(position: string | null | undefined, allowed: ReadonlySet<PositionGroup>): boolean {
  const groups = positionGroups(position);
  if (groups.includes("unknown")) return true;
  return groups.some((group) => allowed.has(group));
}

export function hasGroup(position: string | null | undefined, group: PositionGroup): boolean {
  return positionGroups(position).includes(group);
}

// -----------------------------------------------------------------------------
// Which actions each group may be credited with, and on which side of the ball.
// -----------------------------------------------------------------------------

const ALL: ReadonlySet<PositionGroup> = new Set(["qb", "skill", "ol", "dl", "lb", "db", "k", "p", "ls"]);
const PASSERS: ReadonlySet<PositionGroup> = new Set(["qb"]);
const CARRIERS: ReadonlySet<PositionGroup> = new Set(["qb", "skill"]);
/** On the defense, anyone but a quarterback, kicker or punter. */
const DEFENDERS: ReadonlySet<PositionGroup> = new Set(["skill", "ol", "dl", "lb", "db", "ls"]);
const KICKERS: ReadonlySet<PositionGroup> = new Set(["k", "p"]);

/** The groups that may be credited with an action. */
export function allowedGroups(action: Action): ReadonlySet<PositionGroup> {
  switch (action) {
    case "pass_complete":
    case "pass_incomplete":
    case "pass_intercepted":
    case "sacked":
      return PASSERS;
    case "rush":
    case "reception":
    case "fumble":
      return CARRIERS;
    case "tackle":
    case "sack":
    case "pass_breakup":
    case "interception":
    case "forced_fumble":
      return DEFENDERS;
    case "punt":
    case "field_goal":
    case "extra_point":
      return KICKERS;
    default:
      return ALL;
  }
}

/**
 * Which side of the play an action belongs to: the offense (the side with the
 * ball when it was snapped or kicked), the defense, or either.
 */
export function sideOfAction(action: Action): "offense" | "defense" | "either" {
  switch (action) {
    case "pass_complete":
    case "pass_incomplete":
    case "pass_intercepted":
    case "rush":
    case "reception":
    case "sacked":
    case "fumble":
    case "punt":
    case "field_goal":
    case "extra_point":
      return "offense";
    case "tackle":
    case "sack":
    case "pass_breakup":
    case "interception":
    case "forced_fumble":
    case "punt_return":
    case "kick_return":
      return "defense";
    default:
      return "either";
  }
}

/** The side a player must be on for an action, given who has the ball. Null when either side will do. */
export function requiredSide(action: Action, offense: Side): Side | null {
  const side = sideOfAction(action);
  if (side === "either") return null;
  if (side === "offense") return offense;
  return offense === "home" ? "away" : "home";
}
