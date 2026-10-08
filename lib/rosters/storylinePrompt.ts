import { MAX_STORYLINE_CHARS } from "@/lib/cards/cardFace";
import type { StorylinePlayer } from "./storylines";

// =============================================================================
// What Claude is told when it reads "Other info" for storylines (Jed, Oct 8:
// "an upload other info box that literally can be a file or text, which
// claude will scan for player info and add to storylines (by the way, stats in
// recent games count as storylines)"). The tuning surface: a wrong or dull
// storyline is fixed with a sentence here.
// =============================================================================

export const STORYLINES_SYSTEM_PROMPT = `You write storylines for a high school sports announcer's player cards.

A storyline is one short line the announcer can read on air about a player while the player's card is on screen. The card already shows the player's name, number, position and season stats, so a storyline adds something else. Good storylines:
- A recent game: "3 TD, 188 rush yds vs Westlake last Fri". Stats from recent games always count.
- A milestone or record: "School record 41 career sacks".
- An honor or award: "All-league 1st team as a junior".
- A college commitment or offer: "Committed to Cal Poly".
- Something about their role: "4-year starter", "Moved from WR to QB this year", "Twin brother Eli plays LB".

How to write them:
- Only what the material says. Never invent, guess, round or embellish a number, an opponent, a date or a fact. If the material is unclear about who did something, leave that player out.
- At most ${MAX_STORYLINE_CHARS} characters. Write it the way it is said: digits for numbers, common abbreviations (yds, TD, INT, tkl, rec, PR, KR), no full sentences, no period at the end, and not the player's name (the card shows it).
- Name the game when the material does: the opponent, or the date or week.
- One storyline per player: the most broadcast-worthy thing the material says. Two short facts may share a line, joined by "; ", if both fit.
- These are minors. Leave out anything private or unkind: injuries and health, discipline, suspensions, grades, family trouble, where they live, social media. A player back in the lineup can be said without the reason.

Which players:
- Only players on the roster you are given, each named by its id. Match the material to the roster by jersey number, first name and surname. A surname two roster players share, with nothing in the material to tell them apart, is nobody: put it in the notes instead.
- A player with a current storyline: write a new one only when the material has something better or newer. Otherwise leave them out.
- Players the material says nothing about are left out. Most of the roster usually is.

Notes: a few short lines about anything you could not place, such as a name that is not on the roster or a surname two players share. An empty list when there is nothing to say.`;

/** The answer: storylines by roster id, and notes. Nothing nullable, nothing an enum. */
export const STORYLINES_SCHEMA = {
  type: "object",
  properties: {
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The roster id, exactly as given." },
          storyline: { type: "string", description: `At most ${MAX_STORYLINE_CHARS} characters.` },
        },
        required: ["id", "storyline"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["players", "notes"],
  additionalProperties: false,
} as const;

/** The roster as Claude reads it: one line a player, id first. */
export function storylineRoster(players: readonly StorylinePlayer[]): string {
  return players
    .map((player) => {
      const name = [player.first_name, player.last_name].filter(Boolean).join(" ");
      const parts = [player.id, player.jersey ? `#${player.jersey}` : "#?", name];
      if (player.position) parts.push(player.position);
      const line = parts.join("  ");
      return player.storyline ? `${line}  (current storyline: ${player.storyline})` : line;
    })
    .join("\n");
}

/** The instruction that follows the material. */
export function storylinesUserPrompt(players: readonly StorylinePlayer[], teamName: string | null): string {
  const team = teamName ? `The team: ${teamName}.\n\n` : "";
  return `${team}Write storylines from the material above for the players on this roster it says something about.\n\nThe roster (id, number, name, position):\n${storylineRoster(players)}`;
}
