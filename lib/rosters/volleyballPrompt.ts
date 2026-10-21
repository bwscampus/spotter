import { VOLLEYBALL_STATS } from "@/lib/cards/volleyball";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA } from "./extractionPrompt";

// =============================================================================
// What the model is told about a volleyball file (Jed, Oct 21), and the shape
// it returns. Volleyball is prep and spot only: the roster and its season
// stats, read once, shown on the card all match.
//
// Two readings, one vocabulary:
//
//   the roster import   the roster prompt every sport uses, word for word,
//                       plus the stats section below, so one call reads the
//                       players and every stat column printed for them
//   the stats import    the stats section on its own, matched to the saved
//                       roster the way every sport's stats sheet is
//
// Stats come back as { label, value } pairs: the abbreviations in
// lib/cards/volleyball.ts for the stats the card knows, and any other column
// under its own header, so a sheet with a column nobody planned for loses
// nothing. Values are copied as printed and never worked out.
// Football never comes here: its prompt and schema are unchanged.
// =============================================================================

/** "K kills; E attack errors; ...": the label for each known column, from the card's own list. */
const LABELS = VOLLEYBALL_STATS.map((stat) => `${stat.key} ${stat.name.toLowerCase()}`).join("; ");

/** How to read the stat columns. Shared by the roster import and the stats import. */
export const VOLLEYBALL_STATS_RULES = `READING THE STATS
- Season statistics may be printed on the roster itself or in tables such as Attacking, Serving, Serve Receiving, Blocking, Digging and Ball Handling, often on later pages. The same player appears in several tables. Gather every stat for one player into that player's stats.
- Rows named "Totals", "Season Totals", "Team" or "Opponents" are the team's totals, not a player. Never return them.
- Stats tables often print an initial and a surname ("8 B. Mikail (Sr)"). The jersey number is the reliable link to the player. Use it first, and the surname to confirm.

LABELS
- Return each stat as a label and a value.
- Use exactly these labels for these stats: ${LABELS}.
- The section decides what a short header means. "Err" under Attacking is E, under Serving SE, under Serve Receiving RE. "Att" under Attacking is TA. "Assists" under Blocking is BA, under Ball Handling or Setting A. "Total" under Blocking is BLK. "Pct" or "Hit %" under Attacking is PCT, under Serve Receiving R%.
- A column that is none of these keeps its header exactly as printed. When the same header appears in more than one section, put the section's name in front: "Serving Att", "Ball Handling Err", "Kill %".

VALUES
- Copy each value exactly as printed, as text: ".312", "3.45", "92.5%", "1,024", "0".
- Never invent, round, estimate or compute a value, not even a total or a percentage the sheet does not print. Take values only from this file, never from anything you know about a player.
- A blank cell, a dash or "N/A" is not a value. Leave that stat out.
- Columns matter. A row often leaves cells empty, so count across the header carefully and line each value up with its own column. If you are not certain which column a value belongs to, leave that stat out.`;

// -----------------------------------------------------------------------------
// The roster import.
// -----------------------------------------------------------------------------

/** The roster prompt every sport uses, then the stats, so one call reads both. */
export const VOLLEYBALL_ROSTER_SYSTEM_PROMPT = `${EXTRACTION_SYSTEM_PROMPT}

VOLLEYBALL SEASON STATS
This is a volleyball roster. As well as the players, return every season statistic the file prints for each of them.
- A player with no stats in the file still counts: return them with an empty stats list.
- Return only the stats of players on the roster.

${VOLLEYBALL_STATS_RULES}`;

/** One stat as the schema takes it: a label and its value, both text. Nothing nullable. */
const STAT_PAIRS = {
  type: "array",
  description: "Every season stat the file prints for this player, as label and value. Empty when it prints none.",
  items: {
    type: "object",
    properties: {
      label: { type: "string", description: "The stat's label: one of the listed abbreviations, else the header as printed" },
      value: { type: "string", description: "The value exactly as printed" },
    },
    required: ["label", "value"],
    additionalProperties: false,
  },
} as const;

/**
 * The roster schema with each player's stats added. No new nullable field,
 * so it stays at the roster schema's 12, under the API's 16.
 */
export const VOLLEYBALL_ROSTER_SCHEMA = {
  ...ROSTER_SCHEMA,
  properties: {
    ...ROSTER_SCHEMA.properties,
    players: {
      ...ROSTER_SCHEMA.properties.players,
      items: {
        ...ROSTER_SCHEMA.properties.players.items,
        properties: { ...ROSTER_SCHEMA.properties.players.items.properties, stats: STAT_PAIRS },
        required: [...ROSTER_SCHEMA.properties.players.items.required, "stats"],
      },
    },
  },
} as const;

// -----------------------------------------------------------------------------
// The stats import (/teams/[id]/stats), against a saved roster.
// -----------------------------------------------------------------------------

export const VOLLEYBALL_STATS_SYSTEM_PROMPT = `You read a volleyball team's season statistics sheet and copy every player's stats, as labelled values, onto the team's roster.

MATCHING PLAYERS
- You are given the team's roster. Return only players on it, and return each one at most once.
- Return the jersey and surname exactly as the roster spells them, not as the stats sheet abbreviates them.
- If a stats row cannot be matched to anyone on the roster, skip it and add a warning naming the jersey, for example "#12 J. Smith is not on the roster."
- A roster player the sheet says nothing about is left out.

${VOLLEYBALL_STATS_RULES}

WARNINGS
- Use warnings for rows that matched nobody (naming the jersey), a section you could not read, or more than one team in the file. Short plain sentences.`;

export const VOLLEYBALL_STATS_SCHEMA = {
  type: "object",
  properties: {
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          jersey: { type: ["string", "null"], description: "Jersey number as the roster prints it" },
          last_name: { type: "string", description: "Surname exactly as the roster spells it" },
          stats: STAT_PAIRS,
        },
        required: ["jersey", "last_name", "stats"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["players", "warnings"],
  additionalProperties: false,
} as const;

export const VOLLEYBALL_STATS_USER_PROMPT = "Here is the stats sheet. Copy every stat for each player on the roster below.";
