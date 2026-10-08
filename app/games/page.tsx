import { PastGames } from "@/components/games/PastGames";
import { pageUser } from "@/lib/server/pageUser";
import { listPastGames } from "@/lib/server/repo/games";

/** Every game this account has called, newest first. docs/V3_DEFINITION.md 3 and 9.1. */
export default async function Games() {
  const result = await listPastGames((await pageUser()).id);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <PastGames games={result.ok ? result.games : null} />
    </main>
  );
}
