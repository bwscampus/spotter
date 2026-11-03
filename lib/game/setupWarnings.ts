import { asOfLabel } from "@/lib/cards/cardPlayer";
import { playerKey } from "@/lib/cards/playerKey";
import type { LoadedGame } from "@/lib/game/buildGame";
import type { LookAlikeDrop } from "@/lib/game/crossLookAlikes";
import { stepHref, type SetupReturn, type SetupSide } from "@/lib/game/setupReturn";
import { staleStats } from "@/lib/game/staleStats";
import { phraseSource } from "@/lib/game/teamSounds";

// =============================================================================
// What game setup warns about, as rows: each team's own under its panel, the
// ones about both teams in one list under the two. Pure, so what the announcer
// is told, and where, is tested. None of them stops a game from starting.
//
// Plain words (Jed, Nov 3): announcers don't know what a "name boost", a
// "heard-as form" or "exact-only spotting" is, and the old rows ran past 40
// words. Each warning is now a short headline and at most one fix, with the
// longer explanation behind a "Why?" under it.
// =============================================================================

/** A fix at the row's right: a link to another page, or hiding a player for this game only. */
export type SetupFix = { kind: "link"; label: string; href: string } | { kind: "hide"; label: string; playerId: string };

export interface SetupWarning {
  /** Unique within the list, for React. */
  key: string;
  /** Whose panel it sits under, or "both" for the list under the two. */
  side: SetupSide | "both";
  headline: string;
  /** The longer explanation, shown by the row's "Why?". */
  why?: string;
  /** One fix, or one per player when a warning names several (a hide button each). */
  fixes: SetupFix[];
}

/** At most this many names that sound like a team get a row each; more is one row. */
export const TEAM_SOUND_ROWS = 3;

/** "1 week old" for 7 to 13 days, then whole weeks. */
export function staleAge(days: number): string {
  const weeks = Math.max(1, Math.floor(days / 7));
  return weeks === 1 ? "1 week old" : `${weeks} weeks old`;
}

const times = (n: number) => (n === 1 ? "time" : "times");

/**
 * A bench name that sounds like a star's (lib/game/crossLookAlikes.ts): "Hill
 * might pull up Hall's card", with a hide-tonight button for each of its
 * players. Hiding is for this game only; the saved team does not change.
 */
export function lookAlikeWarning(drop: LookAlikeDrop): SetupWarning {
  const several = drop.players.length > 1;
  return {
    key: `lookalike-${drop.low}`,
    side: "both",
    headline: `${drop.low} might pull up ${drop.high}'s card.`,
    why:
      `${drop.low} and ${drop.high} sound alike. ${drop.high} is called about ${drop.highRate} ${times(drop.highRate)} a game` +
      `${drop.lowRate > 0 ? ` and ${drop.low} about ${drop.lowRate}` : ` and ${drop.low} hardly ever`}, so StatCast listens harder for ${drop.high} tonight. ` +
      `If ${drop.low} won't play, hide ${several ? "them" : "the player"} for this game and the card can't go up by mistake. Your saved team doesn't change.`,
    fixes: drop.players.map((player) => ({
      kind: "hide",
      label: `Hide ${drop.low} tonight${several ? ` #${player.jersey ?? "?"}` : ""}`,
      playerId: playerKey(player),
    })),
  };
}

export function setupWarnings(
  loaded: LoadedGame,
  today: string,
  namesPage: string,
  back: Pick<SetupReturn, "draft"> = { draft: null },
): SetupWarning[] {
  const warnings: SetupWarning[] = [];

  for (const team of staleStats(loaded, today)) {
    warnings.push({
      key: `stale-${team.side}`,
      side: team.side,
      headline: `${team.school}'s stats are ${staleAge(team.days)}.`,
      why: `The season stats are ${asOfLabel(team.asOf)}, ${team.days} days ago. The cards read those numbers on air.`,
      fixes: [
        {
          kind: "link",
          label: "Update stats",
          href: stepHref(`/teams/${team.rosterId}/stats`, { side: team.side, away: loaded.away.id, home: loaded.home.id, draft: back.draft }),
        },
      ],
    });
  }

  for (const side of ["away", "home"] as const) {
    const bench = loaded.benchExactOnly.filter((entry) => entry.side === (side === "home" ? "H" : "A"));
    if (bench.length === 0) continue;
    const one = bench.length === 1;
    warnings.push({
      key: `bench-${side}`,
      side,
      headline: `${bench.map((entry) => entry.name).join(", ")} only ${one ? "goes" : "go"} up when said clearly.`,
      why: `${one ? "This player has" : "These players have"} no season stats, and the last name is also an everyday word, so tonight the card goes up only when the name is heard exactly.`,
      fixes: [],
    });
  }

  if (loaded.teamSounds.length > 0) {
    const teams = [
      { school: loaded.away.school, mascot: loaded.away.mascot },
      { school: loaded.home.school, mascot: loaded.home.mascot },
    ];
    const review = { kind: "link" as const, label: "Review", href: namesPage };
    const fix = "If it happens, add a note on how the name is said on the team page, or set the player to go up only when said clearly.";
    if (loaded.teamSounds.length <= TEAM_SOUND_ROWS) {
      for (const sound of loaded.teamSounds) {
        const phrase = sound.hits[0]?.word ?? "";
        const source = phraseSource(phrase, teams);
        const like = source?.kind === "mascot" ? "the mascot" : source ? source.school : `"${phrase}"`;
        warnings.push({
          key: `team-${sound.name}`,
          side: "both",
          headline: `"${sound.name}" sounds like ${like}.`,
          why:
            `${sound.verdict === "would_fire" ? `When someone says "${phrase}", the ${sound.name} card can go up.` : `"${phrase}" comes close to ${sound.name}, so a team call could put the card up.`} ${fix}`,
          fixes: [review],
        });
      }
    } else {
      const count = loaded.teamSounds.length;
      const firing = loaded.teamSounds.filter((sound) => sound.verdict === "would_fire").length;
      warnings.push({
        key: "team-sounds",
        side: "both",
        headline: `${count} names sound like a team.`,
        why: `${loaded.teamSounds.map((sound) => sound.name).join(", ")} sound like a school or mascot${firing > 0 ? `, and ${firing} of them can put a card up when a team is named` : ""}. ${fix}`,
        fixes: [review],
      });
    }
  }

  if (loaded.colorNote) {
    warnings.push({ key: "colors", side: "both", headline: "Both teams' colors look alike on the cards.", why: loaded.colorNote, fixes: [] });
  }
  if (loaded.sportMismatch) {
    warnings.push({
      key: "sport",
      side: "both",
      headline: "These teams are saved as different sports.",
      why: "The game uses the home team's sport. Check the Sport on each team's page.",
      fixes: [],
    });
  }
  if (loaded.keyterm.kind === "too_many") {
    warnings.push({
      key: "too-many",
      side: "both",
      headline: "Lots of names on these rosters. Unusual names may be missed more often.",
      why: "Speech recognition takes only so many names for extra listening, and these rosters are over that. StatCast still listens for every name; unusual ones may just be heard less accurately.",
      fixes: [],
    });
  }
  if (loaded.keyterm.kind === "unchecked") {
    warnings.push({ key: "unchecked", side: "both", headline: "Couldn't check the names just now. You can still start.", why: loaded.keyterm.message, fixes: [] });
  }
  for (const drop of loaded.lookAlikeDrops) warnings.push(lookAlikeWarning(drop));
  return warnings;
}

/** What the Names link says beside it: "96 names, 4 pairs sound alike". */
export function namesSummary(loaded: Pick<LoadedGame, "watchlist" | "collisions" | "home" | "away">): string {
  const names = loaded.watchlist.entries.length;
  const pairs = loaded.collisions.length;
  const off = loaded.home.offCount + loaded.away.offCount;
  const parts = [`${names} ${names === 1 ? "name" : "names"}`, `${pairs} ${pairs === 1 ? "pair sounds" : "pairs sound"} alike`];
  if (off > 0) parts.push(`${off} hidden ${off === 1 ? "player" : "players"} left out`);
  return parts.join(", ");
}
