import { notFound } from "next/navigation";
import { StatsImport } from "@/components/stats/StatsImport";
import { TextLink } from "@/components/ui/Button";
import { readSetupReturn, setupHref, type SearchParams } from "@/lib/game/setupReturn";
import { loadRoster } from "@/lib/rosters/loadRosters";
import { statsKindFor } from "@/lib/stats/types";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

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
  const football = statsKindFor(roster.team.sport) === "numbers";
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
        intro={`${
          football
            ? "Import the team's season stats sheet. StatCast reads the numbers onto each player by jersey, and the card builds its season lines from them."
            : "Import the team's season stats sheet. StatCast writes up to three short lines per player for the card."
        } A new import replaces the old stats.`}
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
