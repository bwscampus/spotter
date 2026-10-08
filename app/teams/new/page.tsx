import { RosterEditor } from "@/components/rosters/RosterEditor";
import { readSetupReturn, type SearchParams } from "@/lib/game/setupReturn";
import { EMPTY_TEAM } from "@/lib/rosters/editor";

type NewTeamProps = { searchParams: Promise<SearchParams> };

/**
 * A new team. Reached from game setup's Add a team (`?for=game&side=…`), it is
 * step 1 of 2: Save goes on to the team's season stats, then back to the game
 * (lib/game/setupReturn.ts).
 */
export default async function NewTeam({ searchParams }: NewTeamProps) {
  const back = readSetupReturn(await searchParams);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <RosterEditor initial={{ id: null, team: EMPTY_TEAM, players: [] }} then={back} />
    </main>
  );
}
