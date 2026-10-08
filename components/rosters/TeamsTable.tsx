"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ButtonLink, TextLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { INPUT } from "@/components/ui/Field";
import { LocalDate } from "@/components/ui/LocalDate";
import { EmptyState } from "@/components/ui/Rows";
import { SortHeader, TABLE, TableBox, TD, TD_NUM, TR, type SortDirection } from "@/components/ui/Table";
import { Toolbar } from "@/components/ui/Toolbar";
import { statsAge } from "@/lib/rosters/teamStats";
import { levelLabel, sportLabel, type TeamSummary } from "@/lib/rosters/types";
import { ageLabel, dayLabel, plural } from "@/lib/ui/format";
import { useToday } from "@/lib/ui/useToday";
import { DeleteTeamButton } from "./DeleteTeamButton";

type Column = "school" | "mascot" | "sport" | "level" | "season" | "players" | "stats" | "updated";

/** The sort for one column. Text by locale, numbers and dates as they compare; blanks last. */
function compare(column: Column, a: TeamSummary, b: TeamSummary): number {
  const text = (x: string | null | undefined, y: string | null | undefined) => {
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
  };
  switch (column) {
    case "school":
      return text(a.school, b.school);
    case "mascot":
      return text(a.mascot, b.mascot);
    case "sport":
      return text(sportLabel(a.sport), sportLabel(b.sport));
    case "level":
      return text(levelLabel(a.level), levelLabel(b.level));
    case "season":
      return text(a.season, b.season);
    case "players":
      return a.playerCount - b.playerCount;
    case "stats":
      return text(a.statsAsOf, b.statsAsOf);
    case "updated":
      return text(a.updated_at, b.updated_at);
  }
}

/** Teams whose school or mascot has the search in it, without case. */
export function filterTeams(teams: TeamSummary[], search: string): TeamSummary[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return teams;
  return teams.filter((team) => `${team.school} ${team.mascot ?? ""}`.toLowerCase().includes(needle));
}

/** Every saved team in one table, searchable by school or mascot, sorted by school to start. */
export function TeamsTable({ teams }: { teams: TeamSummary[] }) {
  const router = useRouter();
  const today = useToday();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: Column; direction: SortDirection }>({ column: "school", direction: "asc" });

  const shown = useMemo(() => {
    const list = [...filterTeams(teams, search)].sort((a, b) => compare(sort.column, a, b));
    return sort.direction === "asc" ? list : list.reverse();
  }, [teams, search, sort]);

  const header = (column: Column, label: string, numeric = false) => (
    <SortHeader
      label={label}
      numeric={numeric}
      sorted={sort.column === column ? sort.direction : null}
      onSort={() =>
        setSort((current) =>
          current.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" },
        )
      }
    />
  );

  return (
    <>
      <Toolbar
        title="Teams"
        actions={
          <>
            <label className="flex items-center">
              <span className="sr-only">Search by school or mascot</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search school or mascot"
                className={`${INPUT} w-[260px] max-w-full`}
              />
            </label>
            <ButtonLink variant="primary" href="/teams/new">
              New team
            </ButtonLink>
          </>
        }
      >
        <span className="font-num text-[12px] text-muted">{teams.length}</span>
      </Toolbar>

      <div className="flex flex-col gap-2 p-4">
        {teams.length === 0 ? (
          <EmptyState className="px-0">
            No teams yet. <TextLink href="/teams/new">Create one</TextLink>, then import its roster or type it in.
          </EmptyState>
        ) : (
          <>
            <TableBox>
              <table className={TABLE}>
                <thead>
                  <tr>
                    {header("school", "School")}
                    {header("mascot", "Mascot")}
                    {header("sport", "Sport")}
                    {header("level", "Level")}
                    {header("season", "Season")}
                    {header("players", "Players", true)}
                    {header("stats", "Stats as of")}
                    {header("updated", "Updated")}
                    <th className="sticky top-0 z-10 h-8 border-b border-line-strong bg-surface px-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((team) => {
                    const age = today ? statsAge(team.statsAsOf, today) : null;
                    return (
                      <tr key={team.id} className={`${TR} cursor-pointer`} onClick={() => router.push(`/teams/${team.id}`)}>
                        <td className={TD}>
                          <Link href={`/teams/${team.id}`} className="font-medium text-accent hover:underline" onClick={(event) => event.stopPropagation()}>
                            {team.school}
                          </Link>
                        </td>
                        <td className={TD}>{team.mascot}</td>
                        <td className={TD}>{sportLabel(team.sport)}</td>
                        <td className={TD}>{levelLabel(team.level)}</td>
                        <td className={TD}>{team.season}</td>
                        <td className={TD_NUM}>{team.playerCount}</td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {team.statsAsOf ? (
                            <span className="inline-flex items-center gap-2">
                              <span className={`font-num text-[12px] ${age?.stale ? "text-amber-text" : ""}`}>{dayLabel(team.statsAsOf)}</span>
                              {age?.stale && <Badge tone="amber" reason={`These stats are ${age.days} days old.`}>{ageLabel(age.days)}</Badge>}
                            </span>
                          ) : (
                            <span className="text-muted">No stats</span>
                          )}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          <LocalDate iso={team.updated_at} />
                        </td>
                        <td className={`${TD} whitespace-nowrap text-right`} onClick={(event) => event.stopPropagation()}>
                          <DeleteTeamButton id={team.id} name={[team.school, team.mascot].filter(Boolean).join(" ")} players={team.playerCount} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableBox>
            <p className="text-muted">
              {search.trim() ? `${shown.length} of ${plural(teams.length, "team")}` : plural(teams.length, "team")}
            </p>
          </>
        )}
      </div>
    </>
  );
}
