import { notFound } from "next/navigation";
import { CardsPreview } from "@/components/cards/CardsPreview";
import { LoadError } from "@/components/rosters/LoadError";
import { TextLink } from "@/components/ui/Button";
import { Toolbar } from "@/components/ui/Toolbar";
import { byJersey, toCardPlayer } from "@/lib/cards/cardPlayer";
import { loadRosterState, TEAM_LOAD_ERROR } from "@/lib/rosters/loadRosters";
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
  if (!UUID.test(id)) notFound();
  const load = await loadRosterState(id);
  if (load.status === "missing") notFound();
  if (load.status === "error") {
    return (
      <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
        <LoadError title="Cards preview" crumbs={[{ label: "Teams", href: "/teams" }]} message={TEAM_LOAD_ERROR} />
      </main>
    );
  }
  const { roster } = load;

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

  const name = [roster.team.school, roster.team.mascot].filter((part) => part.trim()).join(" ");

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar
        crumbs={[
          { label: "Teams", href: "/teams" },
          { label: name || describeTeam({ ...roster.team, sport: roster.team.sport || "" }), href: `/teams/${roster.id}` },
        ]}
        title="Cards preview"
      >
        <TextLink href={`/teams/${roster.id}/stats`}>Import season stats</TextLink>
      </Toolbar>
      <div className="p-4">
        <CardsPreview cards={cards} color={roster.team.color || null} school={roster.team.school} />
      </div>
    </main>
  );
}
