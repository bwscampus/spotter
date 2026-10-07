import Link from "next/link";
import { GameSetup } from "@/components/game/GameSetup";
import { SiteHeader } from "@/components/SiteHeader";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";
import { pageUser } from "@/lib/server/pageUser";
import { listRosters } from "@/lib/server/repo/rosters";

type NewGameProps = { searchParams: Promise<SearchParams> };

/**
 * Pick the away and home rosters, read the warnings, start. docs/V3_DEFINITION.md 7.1.
 * `?away=…&home=…` opens with those teams picked, which is how adding a team
 * or updating its stats comes back here.
 */
export default async function NewGame({ searchParams }: NewGameProps) {
  const [rosters, picks] = await Promise.all([pageUser().then((user) => listRosters(user.id)), searchParams.then(readSetupPicks)]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-black">New game</h1>
        {/* Keyed on the picks, so coming back with a new team opens fresh rather than keeping the last screen. */}
        <GameSetup key={`${picks.away ?? ""}-${picks.home ?? ""}`} rosters={rosters} initialPicks={picks} />
      </main>
    </div>
  );
}
