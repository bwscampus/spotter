import type { Metadata } from "next";
import { CurrentGame } from "@/components/game/CurrentGame";
import { HomeTeams } from "@/components/game/HomeTeams";
import { ButtonLink, TextLink } from "@/components/ui/Button";
import { LocalDate } from "@/components/ui/LocalDate";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/Rows";
import { TABLE, TD, TD_NUM, TH, TH_NUM, TR } from "@/components/ui/Table";
import { Toolbar } from "@/components/ui/Toolbar";
import { matchupOf } from "@/lib/game/pastGames";
import { loadRosters } from "@/lib/rosters/loadRosters";
import { pageUser } from "@/lib/server/pageUser";
import { listPastGames } from "@/lib/server/repo/games";
import { checklistSteps, showChecklist } from "./checklist";
import { GettingStarted } from "./GettingStarted";

export const metadata: Metadata = { title: "Home" };

/** Games in Home's own list. Past games has the rest. */
const RECENT_GAMES = 5;

/**
 * Home, the signed-in dashboard ("/" is the public landing page). The
 * first-run checklist while the account is new, the game still open in this
 * browser, the last few games, and the teams. The build's commit is in the
 * page's x-commit meta tag (app/layout.tsx), not on screen.
 */
export default async function Home() {
  const [past, teams] = await Promise.all([pageUser().then((user) => listPastGames(user.id)), loadRosters()]);
  const games = past.ok ? past.games : [];
  const recent = games.slice(0, RECENT_GAMES);
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
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3 lg:items-start">
        {past.ok && showChecklist({ teams, games: games.length }) && (
          <GettingStarted steps={checklistSteps({ teams, games: games.length })} />
        )}
        <CurrentGame startedAt={startedAt} />

        <Panel heading="Last 5 games" link={<TextLink href="/games">All past games</TextLink>}>
          {!past.ok ? (
            <EmptyState>Could not load your past games. Reload to try again.</EmptyState>
          ) : recent.length === 0 ? (
            <EmptyState>
              No games yet. <TextLink href="/games/new">Set up a new game</TextLink>
            </EmptyState>
          ) : (
            <div className="max-lg:overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Matchup</th>
                    <th className={TH_NUM}>Min</th>
                    <th className={TH_NUM}>Cards</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((game) => (
                    <tr key={game.id} className={`${TR} last:border-b-0`}>
                      <td className={`${TD} whitespace-nowrap`}>
                        <LocalDate iso={game.startedAt} />
                      </td>
                      <td className={TD}>{matchupOf(game)}</td>
                      <td className={`${TD_NUM} whitespace-nowrap`}>{Math.round(Math.max(0, game.micSeconds) / 60)}</td>
                      <td className={TD_NUM}>{game.cardsShown}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <HomeTeams teams={teams} />
      </div>
    </main>
  );
}
