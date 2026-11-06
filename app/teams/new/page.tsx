import { RosterEditor } from "@/components/rosters/RosterEditor";
import { readSetupReturn, type SearchParams } from "@/lib/game/setupReturn";
import { EMPTY_TEAM } from "@/lib/rosters/editor";
import { startingSport } from "@/lib/rosters/sportOptions";
import { pageUser } from "@/lib/server/pageUser";
import { getAbout } from "@/lib/server/repo/account";

type NewTeamProps = { searchParams: Promise<SearchParams> };

/**
 * A new team. Reached from game setup's Add a team (`?for=game&side=…`), Save
 * team goes back towards the game, offering season stats on the way
 * (lib/game/setupReturn.ts). The announcer's own sports ("About you") come
 * first on the Sport list, and one sport starts picked (Nov 3).
 */
export default async function NewTeam({ searchParams }: NewTeamProps) {
  const user = await pageUser();
  const [back, about] = await Promise.all([searchParams.then(readSetupReturn), getAbout(user.id).catch(() => null)]);
  const mySports = about?.sports ?? [];

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <RosterEditor initial={{ id: null, team: { ...EMPTY_TEAM, sport: startingSport(mySports) }, players: [] }} then={back} mySports={mySports} myOtherSports={about?.otherSports ?? []} />
    </main>
  );
}
