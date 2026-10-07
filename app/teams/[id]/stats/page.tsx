import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { StatsImport } from "@/components/stats/StatsImport";
import { readSetupReturn, setupHref, type SearchParams } from "@/lib/game/setupReturn";
import { pageUser } from "@/lib/server/pageUser";
import { getRoster } from "@/lib/server/repo/rosters";
import { describeTeam } from "@/lib/rosters/types";
import { statsKindFor } from "@/lib/stats/types";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One team's season stats import. docs/V3_DEFINITION.md 6.4.
 *
 * Reached from game setup (`?for=game&side=…`: step 2 of adding a team, or a
 * stale-stats warning's "Import this week's stats"), Save and Skip both go back
 * to the game with this team picked (lib/game/setupReturn.ts).
 */
export default async function TeamStats({ params, searchParams }: TeamProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const roster = UUID.test(id) ? await getRoster((await pageUser()).id, id) : null;
  if (!roster) notFound();

  const back = readSetupReturn(query);
  const backToGame = back ? setupHref(back, roster.id) : null;
  const football = statsKindFor(roster.team.sport) === "numbers";
  const team = describeTeam({ ...roster.team, sport: roster.team.sport || "" });
  // A team just added has no stats yet; one with stats came from a stale-stats warning.
  const hasStats = roster.players.some((player) => player.season !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
        <Link href={`/teams/${roster.id}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          Roster
        </Link>
        <Link href={`/teams/${roster.id}/cards`} className="text-sm text-neutral-600 hover:text-neutral-900">
          Cards preview
        </Link>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-black">Season stats: {team}</h1>
        {backToGame && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
            <span className="font-semibold text-neutral-900">
              {hasStats ? "This week's stats for the game." : "Step 2 of 2: the season stats."} Save takes you back
              to the game with {roster.team.school} picked.
            </span>
            <Link href={backToGame} className="font-semibold text-neutral-700 underline hover:text-neutral-900">
              Skip, back to the game
            </Link>
          </div>
        )}
        <p className="text-sm text-neutral-600">
          {football
            ? "Import the team's stats page, usually MaxPreps. Spotter reads the numbers onto each player by jersey, and the card builds its SEASON lines from them."
            : "Import the team's stats page, usually MaxPreps. Spotter writes up to three short lines per player for the card."}{" "}
          A new import replaces the old stats.
        </p>
        <StatsImport rosterId={roster.id} playerCount={roster.players.length} afterSave={backToGame} />
      </main>
    </div>
  );
}
