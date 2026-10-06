import { PastGames } from "@/components/games/PastGames";
import { SiteHeader } from "@/components/SiteHeader";
import { pageUser } from "@/lib/server/pageUser";
import { listPastGames } from "@/lib/server/repo/games";

/** Every game this account has called, newest first. docs/V3_DEFINITION.md 3 and 9.1. */
export default async function Games() {
  const result = await listPastGames((await pageUser()).id);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-black">Past games</h1>
        <PastGames games={result.ok ? result.games : null} />
      </main>
    </div>
  );
}
