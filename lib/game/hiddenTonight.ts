// =============================================================================
// Hide tonight (Nov 3), kept for this tab while the announcer is setting up:
// setup's sound check, its Names page, Add a team and Update stats all leave
// the page, and coming back must not quietly bring a hidden player back.
// sessionStorage, keyed by the pair of teams, so it is this tab's and this
// matchup's only; it never leaves the browser and never reaches the server.
// =============================================================================

const keyFor = (away: string, home: string) => `spotter.v3.hidden-tonight.${away}.${home}`;

export function readHiddenTonight(away: string, home: string): string[] {
  if (!away || !home || typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(keyFor(away, home)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function writeHiddenTonight(away: string, home: string, ids: readonly string[]): void {
  if (!away || !home) return;
  try {
    if (ids.length === 0) sessionStorage.removeItem(keyFor(away, home));
    else sessionStorage.setItem(keyFor(away, home), JSON.stringify(ids));
  } catch {
    // Storage blocked: Hide tonight still holds while this screen is open.
  }
}
