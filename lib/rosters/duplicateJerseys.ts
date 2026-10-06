/**
 * Flags every player who shares a jersey with a teammate.
 *
 * Informational only. Real rosters do this: Campbell Hall has two number 6s.
 * It matters because the label on screen shows jerseys to tell players apart.
 *
 * Returns one boolean per player, in the order given.
 */
export function flagDuplicateJerseys(players: Array<{ jersey: string | null }>): boolean[] {
  const counts = new Map<string, number>();
  for (const player of players) {
    const jersey = normalizeJersey(player.jersey);
    if (jersey === null) continue;
    counts.set(jersey, (counts.get(jersey) ?? 0) + 1);
  }

  return players.map((player) => {
    const jersey = normalizeJersey(player.jersey);
    return jersey !== null && (counts.get(jersey) ?? 0) > 1;
  });
}

/** "07" and "7" are different jerseys, but " 7 " and "7" are the same one. */
function normalizeJersey(jersey: string | null): string | null {
  const trimmed = (jersey ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
