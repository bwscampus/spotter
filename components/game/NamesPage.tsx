"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { NamesTables } from "@/components/game/NamesTables";
import { TextLink } from "@/components/ui/Button";
import { EmptyState, ErrorRow } from "@/components/ui/Rows";
import { Toolbar, ToolbarMeta } from "@/components/ui/Toolbar";
import { loadAssembled, type AssembledResult } from "@/lib/game/buildGame";
import { setupHref } from "@/lib/game/setupReturn";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";

/**
 * Setup's Names page: every name the two picked teams are listened for, and
 * the ones that sound alike, read from the same assembled game Start builds.
 * Nothing here asks Deepgram anything.
 *
 * It only exists until the game is started: once a game for these two teams
 * is open in this browser, the page sends you to setup instead.
 */
export function NamesPage({ away, home }: { away: string | null; home: string | null }) {
  const router = useRouter();
  const open = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  const started = open !== null && open.home.id === home && open.away.id === away;
  const [result, setResult] = useState<AssembledResult | null>(null);
  const back = setupHref({ side: "away", away, home });

  useEffect(() => {
    if (started) {
      router.replace("/games/new");
      return;
    }
    if (!away || !home) return;
    let current = true;
    void loadAssembled(home, away).then((next) => {
      if (current) setResult(next);
    });
    return () => {
      current = false;
    };
  }, [started, away, home, router]);

  const game = result?.ok ? result.assembled : null;

  if (started) return null;

  return (
    <>
      <Toolbar crumbs={[{ label: "New game", href: back }]} title="Names" actions={<TextLink href={back}>Back to setup</TextLink>}>
        {game && (
          <ToolbarMeta>
            {game.away.school} at {game.home.school}
          </ToolbarMeta>
        )}
      </Toolbar>
      <div className="flex flex-col gap-4 p-4">
        {!away || !home ? (
          <EmptyState className="px-0">
            Pick both teams first. <TextLink href={back}>Back to setup</TextLink>
          </EmptyState>
        ) : result === null ? (
          <p className="text-muted">Reading both rosters...</p>
        ) : !result.ok ? (
          <ErrorRow className="px-0" text={result.error} />
        ) : (
          game && <NamesTables game={game} />
        )}
      </div>
    </>
  );
}
