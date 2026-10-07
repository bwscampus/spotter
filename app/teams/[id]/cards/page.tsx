import Link from "next/link";
import { notFound } from "next/navigation";
import { CardsPreview } from "@/components/cards/CardsPreview";
import { SiteHeader } from "@/components/SiteHeader";
import { byJersey, toCardPlayer } from "@/lib/cards/cardPlayer";
import { pageUser } from "@/lib/server/pageUser";
import { getRoster } from "@/lib/server/repo/rosters";
import { describeTeam } from "@/lib/rosters/types";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every player's card, exactly as the live screen will draw it, in jersey
 * order. docs/V3_DEFINITION.md 6.5. The cards are built by the same
 * toCardPlayer the live screen uses, so what is checked here is what goes up.
 */
export default async function TeamCards({ params }: TeamProps) {
  const { id } = await params;
  const roster = UUID.test(id) ? await getRoster((await pageUser()).id, id) : null;
  if (!roster) notFound();

  const sport = roster.team.sport || null;
  const cards = roster.players
    .map(({ player, season }) => ({
      card: toCardPlayer(
        {
          ...player,
          season_stats: season?.season_stats ?? null,
          season_lines: season?.season_lines ?? [],
          stats_as_of: season?.stats_as_of ?? null,
        },
        sport,
        "H",
      ),
      spotMode: player.spot_mode,
    }))
    .sort((a, b) => byJersey(a.card, b.card));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
        <Link href={`/teams/${roster.id}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          Roster
        </Link>
        <Link href={`/teams/${roster.id}/stats`} className="text-sm text-neutral-600 hover:text-neutral-900">
          Import season stats
        </Link>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-black">
          Cards: {describeTeam({ ...roster.team, sport: roster.team.sport || "" })}
        </h1>
        <CardsPreview cards={cards} />
      </main>
    </div>
  );
}
