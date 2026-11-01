import type { Metadata } from "next";
import { CurrentGame } from "@/components/game/CurrentGame";
import { HomeTeams } from "@/components/game/HomeTeams";
import { ButtonLink, TextLink } from "@/components/ui/Button";
import { Toolbar } from "@/components/ui/Toolbar";
import { loadRosters } from "@/lib/rosters/loadRosters";
import { pageUser } from "@/lib/server/pageUser";
import { listPastGames } from "@/lib/server/repo/games";
import { plural } from "@/lib/ui/format";
import { checklistSteps, showChecklist } from "./checklist";
import { GettingStarted } from "./GettingStarted";

export const metadata: Metadata = { title: "Home" };

/**
 * Home, the signed-in dashboard ("/" is the public landing page), made simpler
 * on Nov 1 for the first outside announcer: one column with the game still
 * open in this browser (only when there is one), the first-run steps until the
 * first game, every saved team, and a link to Past games. New game is the
 * toolbar's one primary button. The build's commit is in the page's x-commit
 * meta tag (app/layout.tsx), not on screen.
 */
export default async function Home() {
  const [past, teams] = await Promise.all([pageUser().then((user) => listPastGames(user.id)), loadRosters()]);
  const games = past.ok ? past.games : [];
  // When each game started, for the one open in this browser.
  const startedAt = Object.fromEntries(games.map((game) => [game.id, game.startedAt]));

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] flex-col bg-surface">
      <Toolbar
        title="Home"
        actions={
          <ButtonLink variant="primary" href="/games/new">
            New game
          </ButtonLink>
        }
      />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 p-4">
        <CurrentGame startedAt={startedAt} />
        {past.ok && showChecklist({ teams, games: games.length }) && (
          <GettingStarted steps={checklistSteps({ teams, games: games.length })} />
        )}
        <HomeTeams teams={teams} />
        <p className="px-1">
          {!past.ok ? (
            <span className="text-muted">
              Could not load your past games. <TextLink href="/games">Try Past games</TextLink>
            </span>
          ) : (
            <TextLink href="/games">
              Past games{games.length > 0 ? ` (${plural(games.length, "game")})` : ""} →
            </TextLink>
          )}
        </p>
      </div>
    </main>
  );
}
