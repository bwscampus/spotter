import { extractFailure } from "./extractErrors";

/** How much of Claude's own reason to repeat. Its warnings are short sentences; this keeps a long one from filling the screen. */
export const MAX_NO_PLAYERS_REASON = 300;

/**
 * What the announcer reads when Claude found nobody on an import (L10).
 * Claude is told to return an empty list with a warning when the file is not a
 * roster ("This looks like a game schedule."), and that warning says more than
 * the stock sentence, so it is shown when there is one. Only the browser sees
 * it: the route logs the code alone, and analytics carry the code alone.
 *
 * POST /api/rosters/extract passes it as the detail of its no_players failure.
 */
export function noPlayersMessage(warnings: readonly string[]): string {
  const stock = extractFailure("no_players").message;
  const said = warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0)
    .join(" ");
  if (said.length === 0) return stock;
  const reason = said.length > MAX_NO_PLAYERS_REASON ? `${said.slice(0, MAX_NO_PLAYERS_REASON - 3).trimEnd()}...` : said;
  return `StatCast found no players in this. The reader said: ${reason}`;
}
