"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { draftHref } from "@/components/games/UpcomingGames";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorRow } from "@/components/ui/Rows";
import { canStart, draftStatus, draftTitle, gameDay, isTonight, nextDraft, statusText, type Draft } from "@/lib/game/drafts";
import { confirmEndingOpenGame, startDraftGame } from "@/lib/game/startGame";
import { WALKTHROUGH_PATH } from "@/lib/onboarding/about";
import type { TeamSummary } from "@/lib/rosters/types";
import { useToday } from "@/lib/ui/useToday";

/**
 * The top of Home (Nov 3, replacing the Getting started checklist): the
 * soonest draft game as one large row. On its date it reads "Tonight: Serra at
 * St. John Bosco" with Start; a draft missing a team says Finish setup. With
 * no draft to come and no game ever called, one big "Set up your next game"
 * opens the walkthrough.
 */
export function NextGame({
  drafts,
  teams,
  calledAny,
  canListen,
}: {
  drafts: Draft[];
  teams: TeamSummary[];
  /** The account has called a game before. */
  calledAny: boolean;
  /** An email account that has not confirmed its address cannot listen, so it gets Open instead of Start. */
  canListen: boolean;
}) {
  const router = useRouter();
  const today = useToday();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The date is the browser's to say; the server renders nothing date-bound.
  if (today === null) return null;
  const next = nextDraft(drafts, today);

  if (!next) {
    if (calledAny) return null;
    return (
      <ButtonLink variant="primary" href={WALKTHROUGH_PATH} className="h-16 self-start px-8 text-[20px]">
        Set up your next game
      </ButtonLink>
    );
  }

  const status = draftStatus(next, teams, today);
  const tonight = isTonight(next, today);
  const start = async () => {
    if (!confirmEndingOpenGame()) return;
    setStarting(true);
    setError(null);
    const started = await startDraftGame(next, "home", today);
    if (!started.ok) {
      setStarting(false);
      setError(started.error);
      return;
    }
    router.push("/live");
  };

  return (
    <section className="flex flex-col gap-2 rounded-[3px] border border-line-strong bg-surface p-4" data-testid="next-game">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] font-semibold uppercase tracking-[0.04em] text-ink-2">{tonight ? "Tonight" : "Next game"}</span>
          <span className="flex flex-wrap items-baseline gap-x-4 text-[24px] font-semibold leading-tight text-ink">
            {tonight ? (
              `Tonight: ${draftTitle(next)}`
            ) : (
              <>
                <span className="font-num text-[20px] font-medium text-ink-2">{gameDay(next.gameDate)}</span>
                <span>{draftTitle(next)}</span>
              </>
            )}
          </span>
          <span className={status.kind === "ready" ? "text-muted" : "text-amber-text"}>{statusText(status)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!canStart(status) ? (
            <ButtonLink variant="primary" href={draftHref(next)} className="h-12 px-6 text-[18px]">
              Finish setup
            </ButtonLink>
          ) : tonight && canListen ? (
            <>
              <ButtonLink href={draftHref(next)}>Open</ButtonLink>
              <Button variant="primary" className="h-12 px-6 text-[18px]" disabled={starting} onClick={() => void start()}>
                {starting ? "Starting..." : "Start"}
              </Button>
            </>
          ) : (
            <ButtonLink href={draftHref(next)} className="h-12 px-6 text-[18px]">
              Open
            </ButtonLink>
          )}
        </div>
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </section>
  );
}
