// =============================================================================
// What Claude is told when it reads a team's schedule (Jed, Oct 28: a paste, a
// PDF, an image or a saved web page, in any format; MaxPreps is the usual
// source). The tuning surface: a misread schedule is fixed with a sentence
// here. Every name in it is made up.
// =============================================================================

export const SCHEDULE_SYSTEM_PROMPT = `You read a high school team's season schedule for a sports announcer: every game the team has played or will play, with its result when it has one.

For each game return:
- month and day as numbers. year only when the source shows it on that game or in a heading for it; otherwise null. Never guess a year.
- opponent: the other school's name only, as written. Leave out "vs", "vs.", "@" and "at", the opponent's mascot when the school name is there without it, its record, its ranking and any tournament name. "@ Harlow Ridge (4-2)" is "Harlow Ridge".
- site, from this team's side: "H" at home, "A" away, "N" at a neutral site. "vs" or "home" is H; "@", "at" or "away" is A; a neutral site, a bowl or a named stadium that belongs to neither school is N. When the source does not say, use H and set unsure.
- team_score and opponent_score: this team's score first. A result written "W 24-21" or "L 21-24" gives this team the higher score on a W and the lower on an L, whatever order the numbers are printed in. Both null for a game not played yet, postponed or cancelled. Never one without the other.
- is_league: true for a league, conference or district game (often marked with a star, "L", "League" or "*"). False otherwise, and false when the source never says.
- unsure: true when anything on this row was a guess or hard to read. note: a few words saying what (empty when unsure is false).

Rules:
- Only games of the team you are told about. A page that lists other teams' games, standings or scores is read for this team's games only.
- One entry per game. A game listed twice is one game.
- Scrimmages count as games. Practices, tryouts, banquets and byes do not.
- warnings: a few short lines about anything you could not read or place. An empty list when there is nothing to say.

Example. The source says, for the Delmar Falcons:
  "Aug 29 vs Harlow Ridge W 28-14 / Sep 5 @ Kettle Creek* L 17-20 / Sep 12 vs Pinewood (Kettle Bowl) / Fri 9/19 BYE"
gives:
  {month 8, day 29, year null, opponent "Harlow Ridge", site "H", team_score 28, opponent_score 14, is_league false}
  {month 9, day 5, year null, opponent "Kettle Creek", site "A", team_score 17, opponent_score 20, is_league true}
  {month 9, day 12, year null, opponent "Pinewood", site "N", team_score null, opponent_score null, is_league false}
and nothing for the bye.`;

/**
 * The answer. Strict: every property required, nothing extra. Nothing
 * nullable is an enum (a nullable enum needs anyOf and is refused before the
 * model reads a word: test/extractionSchema.test.ts), so site is never null.
 */
export const SCHEDULE_SCHEMA = {
  type: "object",
  properties: {
    games: {
      type: "array",
      items: {
        type: "object",
        properties: {
          month: { type: "integer", description: "1 to 12." },
          day: { type: "integer", description: "1 to 31." },
          year: { type: ["integer", "null"], description: "Only when the source shows it." },
          opponent: { type: "string" },
          site: { type: "string", enum: ["H", "A", "N"] },
          team_score: { type: ["integer", "null"] },
          opponent_score: { type: ["integer", "null"] },
          is_league: { type: "boolean" },
          unsure: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["month", "day", "year", "opponent", "site", "team_score", "opponent_score", "is_league", "unsure", "note"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["games", "warnings"],
  additionalProperties: false,
} as const;

/** Who the schedule is for, as the model is told. */
export interface ScheduleTeam {
  school: string;
  mascot: string | null;
  sport: string;
  season: string | null;
}

/** The instruction that follows the material. */
export function scheduleUserPrompt(team: ScheduleTeam): string {
  const name = [team.school, team.mascot].filter((part) => part && part.trim()).join(" ");
  const season = team.season?.trim() ? `, season ${team.season.trim()}` : "";
  return `The team: ${name} (${team.sport}${season}).\n\nRead this team's schedule from the material above.`;
}
