import { GENDERS, LEVELS, SPORTS } from "./types";

// =============================================================================
// What Claude is told about a roster, and the exact shape it must return. The
// same system prompt and schema read every format (a PDF's text, page images,
// a photo, pasted text, spreadsheet rows); only the short instruction that
// rides with the roster says which it is.
// Change the prompt when a real roster comes back wrong; change the schema only
// alongside lib/rosters/types.ts, which mirrors it.
// =============================================================================

export const EXTRACTION_SYSTEM_PROMPT = `You read a single sports team roster and return the players on it. It may arrive as text from a PDF, as page images or photos, as text pasted from a website, or as spreadsheet rows.

WHO COUNTS AS A PLAYER
- Return only players on the roster.
- Never return coaches, assistant coaches, staff, managers, trainers, athletic directors, or support personnel.
- Rosters often print a second table of coaches or staff further down, or on a later page. Skip it entirely, even when it looks like the player table and has the same columns.
- A person listed without a jersey number is usually staff. Include them only when the layout makes it clear they are a player, and add the missing_jersey flag.

NAMES
- Copy every name exactly as printed, including capitalization, hyphens, apostrophes, accents, and spacing.
- Never invent a name, never correct a spelling that looks wrong, and never expand or shorten a name.
- Split each name into first_name and last_name as printed. When a name has three or more words and no hyphen, the surname may be one word or two ("Marli Richardson Barnes"). Make your best split, and add the ambiguous_last_name flag so a person can check it.
- When you cannot read a name with confidence, return your best reading and add the unreadable flag.

OTHER FIELDS
- Keep jersey numbers exactly as printed. They are text, not numbers: "0" and "00" are different, and leading zeros matter.
- Return positions exactly as printed, abbreviations and all. Do not expand "OH" to "Outside Hitter".
- Return grade, height, and weight as printed. Use null for any field the roster does not show.
- Weight is often a bare number in a Wt column. Return it as printed, without adding units.

TEAM INFO
- Read school, mascot, sport, gender, level, and season from the page header or title when they are shown.
- Use null for anything not shown. Do not guess a school from a logo, a mascot from a nickname, or a season from today's date.
- sport must be one of: ${SPORTS.join(", ")}.
- gender must be one of: ${GENDERS.join(", ")}.
- level must be one of: ${LEVELS.join(", ")}.

SPREADSHEETS AND PASTED TEXT
- Rows from a spreadsheet arrive one per line with cells separated by " | ". Work out which column is which from the header row or from the values themselves.
- Pasted text may include menus, ads or other teams from the page it came from. Return only the players of the one team the roster is for, and add a warning if there is more than one team.

FLAGS AND WARNINGS
- Flag rather than guess. A flagged player is reviewed by a person; a wrong guess is not.
- Use warnings for problems with the file as a whole, such as "more than one team in this file" or "this does not look like a roster". Write them as short plain sentences.
- Return an empty players array and a warning when the file is not a roster at all.`;

/**
 * "One of these values, or null."
 *
 * Not `{ type: ["string", "null"], enum: [...values, null] }`. The API
 * validates each enum value against the declared type and rejects the whole
 * schema before it ever reads the PDF: "Enum value 'volleyball' does not match
 * declared type '['string','null']'". That failed identically for every sport,
 * so no upload has ever worked.
 *
 * anyOf is the documented way to write it, and keeps the values a hard
 * constraint on the answer rather than a request in the prompt.
 */
function nullableEnum(values: readonly string[]) {
  return { anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] };
}

/**
 * Structured outputs schema. Every object sets additionalProperties: false and
 * lists every property as required, which is what the API requires. Nullable
 * fields are type arrays or anyOf with null; there are 12, under the API's limit of 16.
 */
export const ROSTER_SCHEMA = {
  type: "object",
  properties: {
    team: {
      type: "object",
      properties: {
        school: { type: ["string", "null"], description: "School name as printed, or null" },
        mascot: { type: ["string", "null"], description: "Team nickname as printed, or null" },
        sport: nullableEnum(SPORTS),
        gender: nullableEnum(GENDERS),
        level: nullableEnum(LEVELS),
        season: { type: ["string", "null"], description: "Season as printed, for example 26-27" },
      },
      required: ["school", "mascot", "sport", "gender", "level", "season"],
      additionalProperties: false,
    },
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          jersey: { type: ["string", "null"], description: "Jersey number exactly as printed" },
          first_name: { type: ["string", "null"] },
          last_name: { type: "string", description: "Full surname exactly as printed" },
          position: { type: ["string", "null"], description: "Position exactly as printed" },
          grade: { type: ["string", "null"] },
          height: { type: ["string", "null"] },
          weight: { type: ["string", "null"], description: "Weight exactly as printed, or null" },
          flags: {
            type: "array",
            items: { type: "string", enum: ["ambiguous_last_name", "unreadable", "missing_jersey"] },
          },
        },
        required: ["jersey", "first_name", "last_name", "position", "grade", "height", "weight", "flags"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["team", "players", "warnings"],
  additionalProperties: false,
} as const;

/** The instruction that rides with the roster itself, one per kind of source. */
export const USER_PROMPTS = {
  pdf_text: "Here is the text of a roster PDF. Return the players on it.",
  pdf: "Here is the roster PDF. It has no usable text layer, so read it from the page images. Return the players on it.",
  image: "Here is the roster, as one or more screenshots or photos. Read every image. Return the players on it.",
  text: "Here is roster text pasted from a website or document. Return the players on it.",
  table: "Here are the rows of a roster spreadsheet. Return the players on it.",
} as const;
