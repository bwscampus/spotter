"use client";

import { useEffect, type ComponentProps, type FormEvent } from "react";
import { afterPaint } from "@/lib/afterPaint";
import { clearBrowserDataWithin, pruneOldLogsOnce } from "@/lib/game/browserData";
import { announceViewer, rememberViewer } from "@/lib/game/viewer";

// =============================================================================
// This browser's game data on a shared laptop (pre-launch audit M3).
// =============================================================================

/**
 * Tells the browser's game data who is signed in. Rendered by the root layout
 * before any page, from the account the server already read, so the open
 * game is read for the right account on the first render without asking the
 * network. Renders nothing.
 */
export function ViewerStamp({ userId }: { userId: string | null }) {
  // Written while rendering on purpose: the pages below read it as they
  // render. The browser only; on the server this module is shared by every
  // request. Anyone already reading is told after the render.
  if (typeof window !== "undefined") rememberViewer(userId);
  useEffect(() => {
    announceViewer();
  }, [userId]);
  return null;
}

/**
 * Sign out, clearing this browser's game data first: the open game, its
 * counts, and every game's log. Waits at most a couple of seconds, then
 * posts to /auth/signout whatever happened.
 */
export function SignOutForm(props: Omit<ComponentProps<"form">, "method" | "action" | "onSubmit">) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void clearBrowserDataWithin().finally(() => form.submit());
  };
  return <form {...props} method="post" action="/auth/signout" onSubmit={onSubmit} />;
}

/** Deletes browser logs past their keep, once per page load, after paint. Drawn in the dashboard header, never on the live screen. */
export function PruneOldLogs() {
  useEffect(() => {
    afterPaint(() => pruneOldLogsOnce());
  }, []);
  return null;
}
