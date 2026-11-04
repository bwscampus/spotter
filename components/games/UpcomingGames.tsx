"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, TextLink } from "@/components/ui/Button";
import { InlineConfirm } from "@/components/ui/Confirm";
import { ErrorRow, EmptyState } from "@/components/ui/Rows";
import { TABLE, TableBox, TD, TH, TR } from "@/components/ui/Table";
import { track } from "@/lib/analytics/track";
import { deleteDraft } from "@/lib/game/draftApi";
import { canStart, datePassed, draftStatus, draftTitle, gameDay, statusText, type Draft } from "@/lib/game/drafts";
import { confirmEndingOpenGame, startDraftGame } from "@/lib/game/startGame";
import { WALKTHROUGH_PATH } from "@/lib/onboarding/about";
import type { TeamSummary } from "@/lib/rosters/types";
import { useToday } from "@/lib/ui/useToday";

/** Setup with a draft loaded: where Open and Finish setup go. */
export const draftHref = (draft: Pick<Draft, "id">) => `/games/new?draft=${encodeURIComponent(draft.id)}`;

/**
 * Upcoming (Nov 3): the account's draft games, soonest first, above Past
 * games. Each says where it stands in plain words (Ready, Needs the away
 * team, Stats 3 weeks old), worked out from what the page already has, with
 * no paid call. Start goes straight to the live screen the way setup's Start
 * does; Open goes to setup with the draft loaded. A draft whose date has
 * passed is grayed and says so, with Start anyway.
 */
export function UpcomingGames({ drafts, teams, canListen }: { drafts: Draft[] | null; teams: TeamSummary[]; canListen: boolean }) {
  const router = useRouter();
  const today = useToday() ?? "";
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (drafts === null) return <ErrorRow className="px-0" text="Could not load your upcoming games. Check the connection and reload." />;
  const shown = drafts.filter((draft) => !deleted.has(draft.id));
  if (shown.length === 0) {
    return (
      <EmptyState className="px-0">
        No upcoming games. <TextLink href={WALKTHROUGH_PATH}>Set up your next game</TextLink>, or use Save as draft on New game.
      </EmptyState>
    );
  }

  const start = async (draft: Draft) => {
    if (!confirmEndingOpenGame()) return;
    setBusy(draft.id);
    setError(null);
    const started = await startDraftGame(draft, "games", today);
    if (!started.ok) {
      setBusy(null);
      setError(started.error);
      return;
    }
    router.push("/live");
  };

  const remove = async (draft: Draft) => {
    setBusy(draft.id);
    setError(null);
    if (!(await deleteDraft(draft.id))) {
      setBusy(null);
      setError("Could not delete that draft. Check the connection and try again.");
      return;
    }
    track("game.draft_deleted", { date_passed: today !== "" && datePassed(draft, today) });
    setBusy(null);
    setAsking(null);
    setDeleted((before) => new Set(before).add(draft.id));
  };

  return (
    <div className="flex flex-col gap-2">
      <TableBox>
        <table className={TABLE} data-testid="upcoming-games">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Matchup</th>
              <th className={TH}>Status</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((draft) => {
              const status = draftStatus(draft, teams, today);
              const passed = today !== "" && datePassed(draft, today);
              const startable = canStart(status) && canListen;
              return (
                <tr key={draft.id} className={`${TR} ${passed ? "text-muted" : ""}`} data-draft={draft.id}>
                  <td className={`${TD} whitespace-nowrap font-num`}>{gameDay(draft.gameDate)}</td>
                  <td className={`${TD} font-semibold`}>{draftTitle(draft)}</td>
                  <td className={TD}>{passed ? "Date passed" : statusText(status)}</td>
                  <td className={`${TD} py-1`}>
                    {asking === draft.id ? (
                      <InlineConfirm
                        question="Delete this draft?"
                        confirmLabel="Delete"
                        busy={busy === draft.id}
                        onConfirm={() => void remove(draft)}
                        onCancel={() => setAsking(null)}
                      />
                    ) : (
                      <span className="flex flex-wrap justify-end gap-2">
                        {(!passed || !startable) && <ButtonLink href={draftHref(draft)}>Open</ButtonLink>}
                        {startable && (
                          <Button disabled={busy !== null} onClick={() => void start(draft)}>
                            {busy === draft.id ? "Starting..." : passed ? "Start anyway" : "Start"}
                          </Button>
                        )}
                        <Button variant="destructive" disabled={busy !== null} onClick={() => setAsking(draft.id)}>
                          Delete
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableBox>
      {!canListen && <p className="text-[14px] text-muted">Confirm your email to set up or start a game: open the link StatCast sent you.</p>}
      {error && <ErrorRow className="px-0" text={error} />}
    </div>
  );
}
