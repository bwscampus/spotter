import { notFound } from "next/navigation";
import { StatsImport } from "@/components/stats/StatsImport";
import { TextLink } from "@/components/ui/Button";
import { readSetupReturn, setupHref, type SearchParams } from "@/lib/game/setupReturn";
import { loadRoster } from "@/lib/rosters/loadRosters";
import { statsKindFor } from "@/lib/stats/types";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

/** What each kind of import does, said once above it. */
const INTRO = {
  numbers:
    "Import the team's season stats sheet. StatCast reads the numbers onto each player by jersey, and the card builds its season lines from them.",
  values:
    "Import the team's season stats sheet. StatCast copies every stat column onto each player by jersey, as printed, and the card leads with the ones that matter for each position.",
  lines: "Import the team's season stats sheet. StatCast writes up to three short lines per player for the card.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One team's season stats import. docs/V3_DEFINITION.md 6.4.
 *
 * Reached from game setup (`?for=game&side=…`: step 2 of adding a team, or a
 * stale-stats warning's "Import stats"), Save and Skip both go back to the
 * game with this team picked (lib/game/setupReturn.ts).
 */
export default async function TeamStats({ params, searchParams }: TeamProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const roster = UUID.test(id) ? await loadRoster(id) : null;
  if (!roster) notFound();

  const back = readSetupReturn(query);
  const backToGame = back ? setupHref(back, roster.id) : null;
  const kind = statsKindFor(roster.team.sport);
  const name = [roster.team.school, roster.team.mascot].filter((part) => part.trim()).join(" ");
  // A team just added has no stats yet; one with stats came from a stale-stats warning.
  const hasStats = roster.players.some((player) => player.season !== null);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <StatsImport
        rosterId={roster.id}
        playerCount={roster.players.length}
        afterSave={backToGame}
        crumbs={[
          { label: "Teams", href: "/teams" },
          { label: name || "Team", href: `/teams/${roster.id}` },
        ]}
        intro={`${INTRO[kind]} A new import replaces the old stats.`}
        note={
          backToGame && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">
                {hasStats ? "This week's stats for the game." : "Step 2 of 2: the season stats."} Save takes you back to the
                game with {roster.team.school} picked.
              </span>
              <TextLink href={backToGame}>Skip, back to the game</TextLink>
            </p>
          )
        }
      />
    </main>
  );
}
