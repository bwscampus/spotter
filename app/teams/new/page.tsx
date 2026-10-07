import Link from "next/link";
import { RosterEditor } from "@/components/rosters/RosterEditor";
import { SiteHeader } from "@/components/SiteHeader";
import { readSetupReturn, setupHref, type SearchParams } from "@/lib/game/setupReturn";
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
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
        {back && (
          <Link href={setupHref(back)} className="text-sm text-neutral-600 hover:text-neutral-900">
            Back to the game
          </Link>
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        {back ? (
          <div>
            <h1 className="text-2xl font-black">Add the {back.side} team</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Step 1 of 2: the roster. Import it, check it, and Save. Then you import the team&apos;s season stats, and
              come back to the game with this team picked.
            </p>
          </div>
        ) : (
          <h1 className="text-2xl font-black">New team</h1>
        )}
        <RosterEditor initial={{ id: null, team: EMPTY_TEAM, players: [] }} then={back} />
      </main>
    </div>
  );
}
