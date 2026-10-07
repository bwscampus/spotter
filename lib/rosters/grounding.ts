import type { PlayerFlag, RosterPlayer } from "./types";

// A surname Claude returned that does not appear in the text it was given was
// invented or misread. The announcer still decides what to do about it, but the
// row is flagged rather than trusted.

/**
 * Folds the differences that are not worth flagging: accents, curly quotes,
 * and runs of whitespace or line breaks the PDF happens to contain.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Adds not_in_source to any player whose surname is missing from the source text. */
export function groundPlayers(players: RosterPlayer[], sourceText: string): RosterPlayer[] {
  const haystack = fold(sourceText);
  return players.map((player) => {
    const needle = fold(player.last_name).trim();
    if (needle.length > 0 && haystack.includes(needle)) return player;
    return { ...player, flags: addFlag(player.flags, "not_in_source") };
  });
}

function addFlag(flags: PlayerFlag[], flag: PlayerFlag): PlayerFlag[] {
  return flags.includes(flag) ? flags : [...flags, flag];
}
