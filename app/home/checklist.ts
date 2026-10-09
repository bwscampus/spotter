// =============================================================================
// The first-run checklist on Home (audit M15). Pure, so it can be tested
// without a page. Shown to an account with fewer than two teams or no games.
// =============================================================================

export interface ChecklistStep {
  label: string;
  /** Why, in one short line. */
  detail: string;
  href: string;
  linkText: string;
  /** Known done. A step Spotter cannot see (the sound check) is never marked. */
  done: boolean;
}

export interface ChecklistInput {
  teams: Array<{ playerCount: number; statsAsOf: string | null }>;
  games: number;
}

export function showChecklist({ teams, games }: ChecklistInput): boolean {
  return teams.length < 2 || games === 0;
}

export function checklistSteps({ teams, games }: ChecklistInput): ChecklistStep[] {
  const withPlayers = teams.filter((team) => team.playerCount > 0).length;
  return [
    {
      label: "Add both teams' rosters",
      detail: "From a PDF, a photo, a spreadsheet or pasted text.",
      href: "/teams/new",
      linkText: "Add a team",
      done: withPlayers >= 2,
    },
    {
      label: "Import season stats (optional)",
      detail: "Puts each player's season numbers on their card.",
      href: "/teams",
      linkText: "Open teams",
      done: teams.some((team) => team.statsAsOf !== null),
    },
    {
      label: "Run a sound check",
      detail: "Say the names out loud and see which ones StatCast hears. It is linked from game setup.",
      href: "/games/new",
      linkText: "Set up a game",
      done: false,
    },
    {
      label: "Call a game in Chrome on a laptop",
      detail: "With a microphone near you or the speaker.",
      href: "/games/new",
      linkText: "New game",
      done: games > 0,
    },
  ];
}
