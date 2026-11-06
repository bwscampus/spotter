import { PastGames } from "@/components/games/PastGames";
import { UpcomingGames } from "@/components/games/UpcomingGames";
import { otherLabel } from "@/lib/rosters/sportOptions";
import { pageUser } from "@/lib/server/pageUser";
import { getAbout } from "@/lib/server/repo/account";
import { listDrafts, listPastGames } from "@/lib/server/repo/games";
import { listRosters } from "@/lib/server/repo/rosters";

/**
 * Every game this account has set up or called (docs/V3_DEFINITION.md 3 and
 * 9.1): Upcoming, the draft games soonest first (Nov 3), then Past games,
 * newest first. Drafts are never counted as games called.
 */
export default async function Games() {
  const user = await pageUser();
  const [past, drafts, teams, about] = await Promise.all([
    listPastGames(user.id),
    listDrafts(user.id),
    listRosters(user.id).catch(() => []),
    getAbout(user.id).catch(() => null),
  ]);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <PastGames
        games={past.ok ? past.games : null}
        otherSport={otherLabel(about?.otherSports)}
        upcoming={<UpcomingGames drafts={drafts.ok ? drafts.drafts : null} teams={teams} canListen={user.emailVerified} />}
      />
    </main>
  );
}
