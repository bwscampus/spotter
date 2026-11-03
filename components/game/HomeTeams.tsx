import Link from "next/link";
import { TextLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/Rows";
import { genderLabel, levelLabel, sportLabel, type TeamSummary } from "@/lib/rosters/types";
import { plural } from "@/lib/ui/format";

type HomeTeam = Pick<TeamSummary, "id" | "school" | "mascot" | "sport" | "gender" | "level" | "season" | "playerCount" | "hasStats">;

/** "Varsity Football 2026": what tells two teams from one school apart. */
function teamKind(team: HomeTeam): string {
  return [genderLabel(team.gender), levelLabel(team.level), sportLabel(team.sport), team.season].filter(Boolean).join(" ");
}

/** Home's Teams panel (Nov 1): every saved team by name, how many players, whether it has stats, and Add a team. */
export function HomeTeams({ teams }: { teams: HomeTeam[] }) {
  return (
    <Panel heading="Your teams" link={<TextLink href="/teams/new">Add a team</TextLink>}>
      {teams.length === 0 ? (
        <EmptyState>
          No teams yet. A game needs both teams&apos; rosters. <TextLink href="/teams/new">Add a team</TextLink>
        </EmptyState>
      ) : (
        <ul>
          {teams.map((team) => (
            <li key={team.id} className="border-b border-line last:border-b-0">
              <Link href={`/teams/${team.id}`} className="flex min-h-11 items-center gap-3 px-3 py-1 hover:bg-press">
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate font-semibold text-accent">{[team.school, team.mascot].filter(Boolean).join(" ")}</span>
                  <span className="hidden truncate text-[14px] text-muted sm:inline">{teamKind(team)}</span>
                </span>
                <span className="shrink-0 text-[14px] text-muted">{plural(team.playerCount, "player")}</span>
                <span className="w-[72px] shrink-0 text-right text-[14px] text-muted">Stats: {team.hasStats ? "Yes" : "No"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
