import { asOfLabel } from "@/lib/cards/cardPlayer";
import type { LoadedGame } from "@/lib/game/buildGame";
import { stepHref, type SetupSide } from "@/lib/game/setupReturn";
import { staleStats } from "@/lib/game/staleStats";

// =============================================================================
// What game setup warns about, as rows (docs/UI_STYLE.md, A6): each team's own
// under its panel, the ones about both teams in one list under the two. Pure,
// so what the announcer is told, and where, is tested. None of them stops a
// game from starting.
// =============================================================================

export interface SetupWarning {
  /** Whose panel it sits under, or "both" for the list under the two. */
  side: SetupSide | "both";
  text: string;
  /** The fix, as a link at the row's right. */
  fix?: { label: string; href: string };
}

export function setupWarnings(loaded: LoadedGame, today: string, namesPage: string): SetupWarning[] {
  const warnings: SetupWarning[] = [];

  for (const team of staleStats(loaded, today)) {
    warnings.push({
      side: team.side,
      text: `${team.school}'s season stats are ${asOfLabel(team.asOf)}, ${team.days} days old. The cards will read those numbers on air.`,
      fix: {
        label: "Import stats",
        href: stepHref(`/teams/${team.rosterId}/stats`, { side: team.side, away: loaded.away.id, home: loaded.home.id }),
      },
    });
  }

  for (const side of ["away", "home"] as const) {
    const bench = loaded.benchExactOnly.filter((entry) => entry.side === (side === "home" ? "H" : "A"));
    if (bench.length === 0) continue;
    warnings.push({
      side,
      text: `Bench names heard exactly: ${bench.map((entry) => entry.name).join(", ")}. No season stats, and the surname is an everyday word, so tonight these go up only when the name is heard exactly.`,
    });
  }

  if (loaded.teamSounds.length > 0) {
    const firing = loaded.teamSounds.filter((warning) => warning.verdict === "would_fire").length;
    const count = loaded.teamSounds.length;
    warnings.push({
      side: "both",
      text: `${count} ${count === 1 ? "name sounds" : "names sound"} like a team${firing > 0 ? `, ${firing} of them enough to go up when a team is named` : ""}. Consider a pronunciation note or exact-only spotting.`,
      fix: { label: "See names", href: namesPage },
    });
  }
  if (loaded.colorNote) warnings.push({ side: "both", text: loaded.colorNote });
  if (loaded.sportMismatch) {
    warnings.push({ side: "both", text: "These rosters are saved as different sports. The game uses the home team's." });
  }
  if (loaded.keyterm.kind === "too_many") {
    warnings.push({
      side: "both",
      text: [
        "Too many names for the name boost.",
        "Spotter can still listen for every name. Only the boost is lost, so unusual surnames may be heard less accurately.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  if (loaded.keyterm.kind === "unchecked") warnings.push({ side: "both", text: loaded.keyterm.message });
  return warnings;
}

/** What the Names link says beside it: "96 names, 4 pairs sound alike". */
export function namesSummary(loaded: Pick<LoadedGame, "watchlist" | "collisions" | "home" | "away">): string {
  const names = loaded.watchlist.entries.length;
  const pairs = loaded.collisions.length;
  const off = loaded.home.offCount + loaded.away.offCount;
  const parts = [`${names} ${names === 1 ? "name" : "names"}`, `${pairs} ${pairs === 1 ? "pair sounds" : "pairs sound"} alike`];
  if (off > 0) parts.push(`${off} ${off === 1 ? "player" : "players"} with spotting off left out`);
  return parts.join(", ");
}
