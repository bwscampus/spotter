import type { Metadata } from "next";
import { CurrentGame } from "@/components/game/CurrentGame";
import { HomeTeams } from "@/components/game/HomeTeams";
import { NextGame } from "@/components/game/NextGame";
import { ButtonLink, TextLink } from "@/components/ui/Button";
import { Toolbar, PAGE_COLUMN } from "@/components/ui/Toolbar";
import { loadRosters } from "@/lib/rosters/loadRosters";
import { pageUser } from "@/lib/server/pageUser";
import { listDrafts, listPastGames } from "@/lib/server/repo/games";
import { plural } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Home" };

/**
 * Home, the signed-in dashboard ("/" is the public landing page), made simpler
 * on Nov 1 for the first outside announcer: one column with the game still
 * open in this browser (only when there is one), every saved team, and a link
 * to Past games. Since Nov 3 the top is the next draft game, large ("Tonight:
 * Serra at St. John Bosco", Start), or, for an account with no draft to come
 * and no game called yet, one big "Set up your next game", in place of the
 * Getting started checklist. The build's commit is in the page's x-commit
 * meta tag (app/layout.tsx), not on screen.
 */
export default async function Home() {
  const user = await pageUser();
  const [past, drafts, teams] = await Promise.all([listPastGames(user.id), listDrafts(user.id), loadRosters()]);
  const games = past.ok ? past.games : [];
  // When each game started, for the one open in this browser.
  const startedAt = Object.fromEntries(games.map((game) => [game.id, game.startedAt]));
  const upcoming = drafts.ok ? drafts.drafts : [];
  // One primary button a screen: the next game's, when there is one to show.
  const newGameIsPrimary = upcoming.length === 0 && games.length > 0;

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] flex-col bg-surface">
      <Toolbar
        title="Home"
        actions={
          <ButtonLink variant={newGameIsPrimary ? "primary" : "outlined"} href="/games/new">
            New game
          </ButtonLink>
        }
      />
      <div className={`${PAGE_COLUMN} flex flex-col gap-4 py-4`}>
        <CurrentGame startedAt={startedAt} />
        {past.ok && <NextGame drafts={upcoming} teams={teams} calledAny={games.length > 0} canListen={user.emailVerified} />}
        <HomeTeams teams={teams} />
        <p className="px-1">
          {!past.ok ? (
            <span className="text-muted">
              Could not load your past games. <TextLink href="/games">Try Past games</TextLink>
            </span>
          ) : (
            <TextLink href="/games">
              {upcoming.length > 0 ? `Upcoming (${upcoming.length}) and past games` : "Past games"}
              {upcoming.length === 0 && games.length > 0 ? ` (${plural(games.length, "game")})` : ""} →
            </TextLink>
          )}
        </p>
      </div>
    </main>
  );
}
