import { PastGames } from "@/components/games/PastGames";
import { UpcomingGames } from "@/components/games/UpcomingGames";
import { pageUser } from "@/lib/server/pageUser";
import { listDrafts, listPastGames } from "@/lib/server/repo/games";
import { listRosters } from "@/lib/server/repo/rosters";

/**
 * Every game this account has set up or called (docs/V3_DEFINITION.md 3 and
 * 9.1): Upcoming, the draft games soonest first (Nov 3), then Past games,
 * newest first. Drafts are never counted as games called.
 */
export default async function Games() {
  const user = await pageUser();
  const [past, drafts, teams] = await Promise.all([listPastGames(user.id), listDrafts(user.id), listRosters(user.id).catch(() => [])]);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <PastGames
        games={past.ok ? past.games : null}
        upcoming={<UpcomingGames drafts={drafts.ok ? drafts.drafts : null} teams={teams} canListen={user.emailVerified} />}
      />
    </main>
  );
}
