// =============================================================================
// The first-run steps on Home (audit M15). Pure, so it can be tested without a
// page. Shown until the account's first game (Nov 1: three steps, made simpler
// for the first outside announcer; four from Oct 8).
// =============================================================================

export interface ChecklistStep {
  label: string;
  /** Why, in one short line. */
  detail: string;
  href: string;
  linkText: string;
  /** Known done. A step StatCast cannot see (the sound check) is never marked. */
  done: boolean;
}

export interface ChecklistInput {
  teams: Array<{ playerCount: number }>;
  games: number;
}

export function showChecklist({ games }: ChecklistInput): boolean {
  return games === 0;
}

export function checklistSteps({ teams, games }: ChecklistInput): ChecklistStep[] {
  const withPlayers = teams.filter((team) => team.playerCount > 0).length;
  return [
    {
      label: "Add both teams",
      detail: "Drop in each roster: a PDF, a photo, a spreadsheet or a copied web page. Season stats are optional.",
      href: "/teams/new",
      linkText: "Add a team",
      done: withPlayers >= 2,
    },
    {
      label: "Set up the game and run a sound check",
      detail: "Pick the two teams, then say the names out loud once so StatCast learns how they sound. About two minutes.",
      href: "/games/new",
      linkText: "Set up a game",
      done: false,
    },
    {
      label: "Call the game",
      detail: "In Chrome on a laptop, with the microphone near you. Say a name, or \"number 22\", and the card goes up.",
      href: "/games/new",
      linkText: "New game",
      done: games > 0,
    },
  ];
}
