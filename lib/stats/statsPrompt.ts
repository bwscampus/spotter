import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "@/lib/cards/limits";
import { FOOTBALL_STAT_KEYS } from "@/lib/cards/statKeys";
import type { NumberSport, StatKey } from "@/lib/cards/sportStats";

// =============================================================================
// What Claude is told about a season stats sheet, and the shape it must return.
// Two readings, by sport (docs/V3_DEFINITION.md 6.4):
//
// Football: numbers on the stat keys in section 9.2, because tonight's plays
// add to them live and the card builds its lines from them (lib/cards/lines.ts).
//
// Every other sport: the two or three phrases an announcer would actually say
// when a player's name comes up, already written out, because that is what
// fits on the card and what gets read on air.
//
// Both keep the same rules: columns have to line up, team-total rows are not
// players, a number is never invented, and a row that matches nobody on the
// roster is a warning naming the jersey.
// =============================================================================

// The card's limits live with the card, and the prompts ask for what fits them.
export { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH };

export const STATS_SYSTEM_PROMPT = `You read a sports team's season statistics sheet and write, for each player, the short lines a live broadcaster would say about them.

WHAT YOU ARE LOOKING AT
- One team's season stats, usually split into sections such as Passing, Rushing, Receiving, Tackles, Scoring, or for other sports Kills, Digs, Assists, Saves.
- The same player appears in several sections. Gather everything about one player into one entry.
- Rows named "Season Totals", "Team", or "Opponents" are the team's totals, not a player. Never return them.

MATCHING PLAYERS
- You are given the team's roster. Return only players on it, and return each one at most once.
- The stats sheet usually prints an initial and a surname ("8 B. Mikail (Sr)"). The jersey number is the reliable link to the roster. Use it first, and the surname to confirm.
- Return the jersey and surname exactly as the roster spells them, not as the stats sheet abbreviates them.
- If a stats row cannot be matched to anyone on the roster, skip it and add a warning naming the jersey.

READING THE NUMBERS
- Columns matter. A row often leaves cells empty, so count across the header carefully and line each value up with its own column. Read the page as it is laid out, not as a run of numbers.
- Never invent, round, or estimate a number. If you are not certain which column a value belongs to, leave that statistic out.
- Take numbers only from this sheet. Do not add anything you happen to know about a player.

WRITING THE LINES
- Between 1 and ${MAX_STAT_LINES} lines per player, best first. Under ${MAX_STAT_LINE_LENGTH} characters each.
- Each line is a phrase, not a sentence: no player name, no leading bullet, no trailing period.
- Group related numbers the way they are said out loud: "826 pass yds, 10 TD, 1 INT" rather than three separate lines.
- Use the abbreviations a broadcaster says: yds, TD, INT, rec, car, tackles, TFL, ppg, ast, kills, digs, saves.
- Lead with what makes the player worth mentioning. A quarterback's passing, a receiver's catches, a linebacker's tackles.
- Include the rate stat when the sheet gives one and it flatters the player: "31.4 yds per return", "8.5 tackles per game".
- Say games played only when it explains a small total, for example a player who has appeared in 2 of 4 games.

WHO TO LEAVE OUT
- Skip a player whose every statistic is zero or blank. A card with "0 yds, 0 TD" on it is worse than a card with nothing.
- Skip a statistic that is zero unless its absence is the point, as in a quarterback's "0 INT".

WARNINGS
- Use warnings for problems with the sheet as a whole: a stats row that matched nobody, a section you could not read, more than one team in the file. Short plain sentences.`;

/**
 * Structured outputs schema. Nullable fields are type arrays; enums would need
 * anyOf, as lib/rosters/extractionPrompt.ts explains, but there are none here.
 */
export const STATS_SCHEMA = {
  type: "object",
  properties: {
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          jersey: { type: ["string", "null"], description: "Jersey number as the roster prints it" },
          last_name: { type: "string", description: "Surname exactly as the roster spells it" },
          lines: {
            type: "array",
            description: `Between 1 and ${MAX_STAT_LINES} short phrases, best first`,
            items: { type: "string" },
          },
        },
        required: ["jersey", "last_name", "lines"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["players", "warnings"],
  additionalProperties: false,
} as const;

/** The roster Claude matches against, one player per line: "#8 Mikail, Bennett". */
export function rosterForPrompt(players: Array<{ jersey: string | null; first_name: string | null; last_name: string }>): string {
  return players
    .map((player) => {
      const jersey = player.jersey?.trim() ? `#${player.jersey.trim()}` : "#?";
      const first = player.first_name?.trim();
      return first ? `${jersey} ${player.last_name}, ${first}` : `${jersey} ${player.last_name}`;
    })
    .join("\n");
}

export const STATS_USER_PROMPT = "Here is the stats sheet. Write the lines for each player on the roster below.";

// =============================================================================
// Football: numbers, not lines.
// =============================================================================

export const FOOTBALL_STATS_SYSTEM_PROMPT = `You read a high school football team's season statistics sheet and copy each player's numbers onto a fixed set of stat keys. You are asked for one group of keys at a time, and read only the sections that hold them.

WHAT YOU ARE LOOKING AT
- One team's season stats, usually split into sections: Passing, Rushing, Receiving, Defense or Tackles, Fumbles, Kick Returns, Punt Returns, Kicking, Punting, Scoring.
- The same player appears in several sections. Gather everything about one player into one entry.
- Rows named "Season Totals", "Totals", "Team", or "Opponents" are the team's totals, not a player. Never return them.
- Skip these sections entirely: All Purpose Yards, Total Yards, Scoring, Points, Touchdowns, Conversions, Pancake Blocks. They repeat numbers from other sections or have no key.

MATCHING PLAYERS
- You are given the team's roster. Return only players on it, and return each one at most once.
- The stats sheet usually prints an initial and a surname ("8 B. Mikail (Sr)"). The jersey number is the reliable link to the roster. Use it first, and the surname to confirm.
- Return the jersey and surname exactly as the roster spells them, not as the stats sheet abbreviates them.
- If a stats row cannot be matched to anyone on the roster, skip it and add a warning naming the jersey, for example "#12 J. Smith is not on the roster."

READING THE NUMBERS
- Columns matter. A row often leaves cells empty, so count across the header carefully and line each value up with its own column. Read the page as it is laid out, not as a run of numbers.
- Never invent, round, or estimate a number. Copy each number exactly as printed. Never compute one the sheet does not print, not even a sum. If you are not certain which column a value belongs to, leave that stat out.
- Take numbers only from this sheet. Do not add anything you happen to know about a player.
- Leave out any stat that is 0 or blank. Return only numbers that are not zero. A player with no non-zero numbers in your sections is left out entirely.
- Ignore rates and averages (yards per carry, completion percentage, per game). They have no key.

WHICH KEY EACH COLUMN GOES ON
- gp: games played.
- Passing: completions pass_cmp, attempts pass_att, yards pass_yds, touchdowns pass_td, interceptions thrown pass_int. A "C/Att" or "Comp-Att" column holds two numbers: completions first, attempts second.
- Rushing: carries or attempts rush_att, yards rush_yds, touchdowns rush_td.
- Receiving: receptions rec, yards rec_yds, touchdowns rec_td.
- Defense: total tackles tkl (the "Tot" or "Total" column, not solo or assisted), sacks sacks, sack yards sack_yds, interceptions made def_int, interception return yards int_ret_yds, interception return touchdowns int_td, passes broken up or defended pbu, forced fumbles ff, fumble recoveries fr, fumble return yards fr_ret_yds, fumble return touchdowns fr_td.
- An interception in the Passing section is one thrown (pass_int). An interception in the Defense section is one made (def_int). Never put one on the other.
- Fumbles by a ball carrier: fumbles fum, fumbles lost fum_lost.
- Kick returns: returns kr, yards kr_yds, touchdowns kr_td. Punt returns: returns pr, yards pr_yds, touchdowns pr_td.
- Kicking: field goals made fgm, attempted fga, longest fg_long; extra points (PAT) made xpm, attempted xpa. An "FGM-FGA" or "PAT" column holding "8-11" is made first, attempted second.
- Punting: punts punts, punt yards punt_yds.
- Yards can be negative, most often a quarterback's rushing. Keep the minus sign.
- Half sacks are real: 4.5 is 4.5.

WARNINGS
- Use warnings for rows that matched nobody (naming the jersey), a section you could not read, or more than one team in the file. Short plain sentences. Only warn about the sections you were asked to read.`;

/**
 * Structured outputs schema for football. Stats are a list of { key, value }
 * pairs rather than an object with a nullable field per key: a key the sheet
 * does not give is simply absent, nothing in the schema is nullable, and the
 * key enum is a plain enum, which is safe (a nullable enum is the trap
 * test/extractionSchema.test.ts guards).
 */
export function numberStatsSchema(keys: readonly StatKey[]) {
  return {
    type: "object",
    properties: {
      players: {
        type: "array",
        items: {
          type: "object",
          properties: {
            jersey: { type: ["string", "null"], description: "Jersey number as the roster prints it" },
            last_name: { type: "string", description: "Surname exactly as the roster spells it" },
            stats: {
              type: "array",
              description: "One entry per non-zero stat the sheet gives this player in these sections",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", enum: [...keys] },
                  value: { type: "number" },
                },
                required: ["key", "value"],
                additionalProperties: false,
              },
            },
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
}

/** Football's name for the same schema: every sport's numbers are { key, value } pairs on its own keys. */
export const footballStatsSchema = numberStatsSchema;

/** The schema over every key, for reference and tests. The calls use one group each. */
export const FOOTBALL_STATS_SCHEMA = footballStatsSchema(FOOTBALL_STAT_KEYS);

/** The instruction for one group's call: which sections to read and which keys they fill. */
export function footballStatsUserPrompt(group: { sections: string; keys: readonly string[] }): string {
  return `Here is the stats sheet. Read only these sections: ${group.sections}. Copy each player's non-zero numbers onto these keys only: ${group.keys.join(", ")}. The roster is below.`;
}

// =============================================================================
// Basketball and volleyball: numbers too (Nov 2). The same rules as football's
// prompt (columns line up, team rows are not players, nothing is invented,
// zeros are left out), with each sport's own sections and keys. Totals only:
// the card and the panel work out the rates from them.
// =============================================================================

/** The rules every sport's numbers prompt shares, after its own first paragraph and before its keys. */
const SHARED_NUMBER_RULES = `MATCHING PLAYERS
- You are given the team's roster. Return only players on it, and return each one at most once.
- The stats sheet usually prints an initial and a surname ("8 B. Mikail (Sr)"). The jersey number is the reliable link to the roster. Use it first, and the surname to confirm.
- Return the jersey and surname exactly as the roster spells them, not as the stats sheet abbreviates them.
- If a stats row cannot be matched to anyone on the roster, skip it and add a warning naming the jersey, for example "#12 J. Smith is not on the roster."

READING THE NUMBERS
- Columns matter. A row often leaves cells empty, so count across the header carefully and line each value up with its own column. Read the page as it is laid out, not as a run of numbers.
- Never invent, round, or estimate a number. Copy each number exactly as printed. Never compute one the sheet does not print, not even a sum or a total from an average. If you are not certain which column a value belongs to, leave that stat out.
- Take numbers only from this sheet. Do not add anything you happen to know about a player.
- Leave out any stat that is 0 or blank. Return only numbers that are not zero. A player with no non-zero numbers is left out entirely.
- Copy season totals only. Ignore averages, rates and percentages (per game, per set, percentage, efficiency). They have no key. If the sheet prints only an average for a stat and no total, leave that stat out and add one warning saying which stat was only given as an average.`;

export const BASKETBALL_STATS_SYSTEM_PROMPT = `You read a high school basketball team's season statistics sheet and copy each player's season totals onto a fixed set of stat keys.

WHAT YOU ARE LOOKING AT
- One team's season stats, often split into sections: Scoring or Shooting, Rebounding, Assists, Steals, Blocks, Turnovers, Fouls. Some sheets put everything in one wide table.
- The same player appears in several sections. Gather everything about one player into one entry.
- Rows named "Season Totals", "Totals", "Team", or "Opponents" are the team's totals, not a player. Never return them.

${SHARED_NUMBER_RULES}

WHICH KEY EACH COLUMN GOES ON
- gp: games played. min: total minutes played.
- pts: total points.
- Field goals (every shot from the floor, twos and threes together): made fg_made, attempted fg_att. An "FGM-FGA" column holding "45-98" is made first, attempted second.
- Three-pointers: made three_made, attempted three_att ("3PM", "3PA", "3P").
- Free throws: made ft_made, attempted ft_att ("FTM", "FTA").
- Rebounds: offensive oreb, defensive dreb, total reb.
- Assists ast, steals stl, blocks blk, turnovers tov, personal fouls pf.

WARNINGS
- Use warnings for rows that matched nobody (naming the jersey), a section you could not read, a stat given only as an average, or more than one team in the file. Short plain sentences.`;

export const VOLLEYBALL_STATS_SYSTEM_PROMPT = `You read a high school volleyball team's season statistics sheet and copy each player's season totals onto a fixed set of stat keys.

WHAT YOU ARE LOOKING AT
- One team's season stats, often split into sections: Attacking or Hitting, Serving, Setting or Assists, Serve Receive, Digging or Defense, Blocking. Some sheets put everything in one wide table.
- The same player appears in several sections. Gather everything about one player into one entry.
- Rows named "Season Totals", "Totals", "Team", or "Opponents" are the team's totals, not a player. Never return them.

${SHARED_NUMBER_RULES}

WHICH KEY EACH COLUMN GOES ON
- gp: matches played ("MP"). sets: sets played ("SP" or "S").
- Attacking: kills kills ("K"), attack errors attack_err ("E"), total attack attempts attack_att ("TA" or "Att").
- Setting: assists assists ("A" or "Ast").
- Serving: aces aces ("SA" or "Ace"), serve errors serve_err ("SE").
- Serve receive: reception errors recv_err ("RE").
- Defense: digs digs ("D" or "Digs").
- Blocking: solo blocks solo_blocks ("BS"), block assists block_assists ("BA"), total blocks blocks ("Blk" or "TB").
- Hitting percentage, kills per set and every other rate have no key: leave them out.

WARNINGS
- Use warnings for rows that matched nobody (naming the jersey), a section you could not read, a stat given only as an average, or more than one team in the file. Short plain sentences.`;

/** The system prompt for a sport whose stats are numbers. */
export function numberStatsPrompt(sport: NumberSport): string {
  if (sport === "basketball") return BASKETBALL_STATS_SYSTEM_PROMPT;
  if (sport === "volleyball") return VOLLEYBALL_STATS_SYSTEM_PROMPT;
  return FOOTBALL_STATS_SYSTEM_PROMPT;
}
