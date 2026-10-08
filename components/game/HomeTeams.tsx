"use client";

import { Panel, PanelRow } from "@/components/ui/Panel";
import { EmptyState, WarningRow } from "@/components/ui/Rows";
import { TextLink } from "@/components/ui/Button";
import { statsAge } from "@/lib/rosters/teamStats";
import { useToday } from "@/lib/ui/useToday";

/** Home's Teams panel: how many teams and players, and how many teams' stats are a week old. */
export function HomeTeams({ teams }: { teams: Array<{ playerCount: number; statsAsOf: string | null }> }) {
  const today = useToday();
  if (teams.length === 0) {
    return (
      <Panel heading="Teams">
        <EmptyState>
          No teams yet. A game needs both teams&apos; rosters. <TextLink href="/teams/new">Add a team</TextLink>
        </EmptyState>
      </Panel>
    );
  }
  const players = teams.reduce((total, team) => total + team.playerCount, 0);
  const stale = today ? teams.filter((team) => statsAge(team.statsAsOf, today)?.stale).length : 0;
  return (
    <Panel heading="Teams" link={<TextLink href="/teams">Open teams</TextLink>}>
      <PanelRow label="Teams">
        <span className="font-num text-[15px] font-semibold">{teams.length}</span>
      </PanelRow>
      <PanelRow label="Players">
        <span className="font-num text-[15px] font-semibold">{players}</span>
      </PanelRow>
      {stale > 0 && (
        <WarningRow
          className="border-t border-line"
          text={`${stale} ${stale === 1 ? "team has" : "teams have"} stats 7 or more days old.`}
          fix={<TextLink href="/teams">Review</TextLink>}
        />
      )}
    </Panel>
  );
}
